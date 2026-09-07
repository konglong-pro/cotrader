#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeExtractionRequest } from "../lib/extraction_request.mjs";
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  MAX_FETCH_BYTES,
  safeFetchBuffer
} from "../lib/safe_fetch.mjs";

const DEFAULT_USER_AGENT =
  "cotrader-web-extractor/0.1 (+https://local.cotrader; research extraction)";
const MAX_OCR_IMAGE_BYTES = 5_000_000;
const MAX_PROCESS_OUTPUT_CHARS = 1_000_000;

const FIELD_KEYWORDS = [
  "涨停",
  "跌停",
  "炸板",
  "连板",
  "成交额",
  "上涨",
  "下跌",
  "A50",
  "恒指",
  "人民币",
  "离岸",
  "在岸",
  "美债",
  "原油",
  "黄金",
  "铜",
  "铝",
  "锂",
  "铁矿",
  "煤炭",
  "美股",
  "纳指",
  "标普",
  "道指",
  "中概股",
  "港股",
  "商品期货"
];

const ANNOUNCEMENT_KEYWORDS = [
  "公告",
  "减持",
  "增持",
  "回购",
  "重组",
  "停牌",
  "复牌",
  "监管函",
  "异动公告",
  "风险提示",
  "业绩",
  "解禁",
  "新股"
];

const RESEARCH_BUCKET_RULES = [
  {
    key: "market_structure",
    title: "市场结构与情绪",
    keywords: FIELD_KEYWORDS,
    source_level: "B required for confirmation",
    status: "lead_requires_structured_data_verification"
  },
  {
    key: "policy_regulation",
    title: "政策与监管",
    keywords: ["政策", "监管", "证监会", "交易所", "国务院", "央行", "发改委", "工信部", "财政部", "商务部"],
    source_level: "S required for confirmation",
    status: "lead_requires_official_source_verification"
  },
  {
    key: "company_announcements",
    title: "公司公告与资本事件",
    keywords: ANNOUNCEMENT_KEYWORDS,
    source_level: "A required for confirmation",
    status: "lead_requires_announcement_verification"
  },
  {
    key: "themes_and_catalysts",
    title: "题材催化与产业线索",
    keywords: ["题材", "催化", "概念", "产业", "事件", "AI", "芯片", "半导体", "算力", "机器人", "低空", "商业航天", "新能源", "医药"],
    source_level: "C or better; cross-check when material",
    status: "lead_requires_catalyst_freshness_check"
  },
  {
    key: "stock_logic",
    title: "个股逻辑与映射",
    keywords: ["主营", "客户", "订单", "供应商", "产能", "产品", "技术路线", "产业链", "受益", "龙头", "正宗", "核心标的"],
    source_level: "A required for business confirmation",
    status: "lead_requires_company_fact_verification"
  },
  {
    key: "risk_alerts",
    title: "风险与负反馈",
    keywords: ["风险", "退潮", "兑现", "高开低走", "炸板", "跌停", "减持", "解禁", "问询函", "监管函", "ST", "亏损", "商誉"],
    source_level: "A/B preferred depending on risk type",
    status: "risk_lead_requires_verification"
  },
  {
    key: "calendar_events",
    title: "事件日历",
    keywords: ["会议", "大会", "发布会", "财报", "业绩说明会", "数据公布", "交割", "调仓", "申购", "上市", "解禁日"],
    source_level: "S/A/B preferred",
    status: "calendar_lead_requires_date_verification"
  },
  {
    key: "opinions",
    title: "观点与推演",
    keywords: ["有望", "可能", "预计", "预期", "看好", "判断", "观点", "情绪", "博弈", "分歧", "预期差"],
    source_level: "opinion only",
    status: "opinion_or_inference_not_fact"
  }
];

export async function fetchAndExtractWebpage(url, options = {}, runtime = {}) {
  const startedAt = new Date().toISOString();
  const request = normalizeExtractionRequest({ ...options, url });
  const { url: normalizedUrl, maxTextChars, maxImages, ocrImages } = request;
  const fetchPage = runtime.safeFetch ?? safeFetchBuffer;
  const fetchRuntime = {
    signal: runtime.signal,
    lookup: runtime.lookup,
    request: runtime.request
  };
  const response = await fetchPage(
    normalizedUrl,
    {
      maxBytes: MAX_FETCH_BYTES,
      timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
      userAgent: DEFAULT_USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5"
    },
    fetchRuntime
  );
  const finalUrl = response.url || normalizedUrl;
  const contentType = response.headers.get("content-type") || "";
  const bytes = response.bytes;
  const truncated = response.truncated;
  const html = decodeBytes(bytes, contentType);

  const metadata = extractMetadata(html, finalUrl);
  const embeddedCandidates = extractEmbeddedContentCandidates(html);
  const bestEmbedded = embeddedCandidates[0] ?? null;
  const visibleText = stripHtmlToText(html);
  const embeddedText = bestEmbedded ? stripHtmlToText(bestEmbedded.html) : "";
  const metaText = [metadata.description, metadata.keywords].filter(Boolean).join("\n");

  const textSource = chooseTextSource([
    { method: "embedded_content_field", text: embeddedText, rawHtml: bestEmbedded?.html ?? "" },
    { method: "visible_html", text: visibleText, rawHtml: html },
    { method: "meta_description", text: normalizeText(metaText), rawHtml: "" }
  ]);

  const images = extractImages([html, bestEmbedded?.html ?? ""], finalUrl, maxImages);
  const ocr = await maybeOcrImages(images, {
    enabled: ocrImages,
    maxOcrImages: 3,
    timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
    fetchPage,
    fetchRuntime,
    runProcess: runtime.runProcess
  });
  const cleanText = truncateText(textSource.text, maxTextChars);
  const publishedAt =
    normalizePublishedAt(metadata.published_at) || inferPublishedAt(visibleText) || inferPublishedAt(cleanText);
  const webpageSourceLevel = classifySourceLevel(finalUrl);
  const sections = buildSections(cleanText);
  const fieldCandidates = extractFieldCandidates(cleanText);
  const stocks = extractStocks(html);
  const snapshot = buildWebpageSnapshot(cleanText);
  const researchWorkflowSnapshot = buildResearchWorkflowSnapshot(cleanText, {
    metadata,
    finalUrl,
    publishedAt,
    webpageSourceLevel,
    cleanTextStatus: textSource.text
      ? textSource.method === "embedded_content_field"
        ? "complete_or_partial_from_embedded_content"
        : "partial_from_" + textSource.method
      : "unavailable"
  });
  const relatedLinks = extractRelatedLinks([html, bestEmbedded?.html ?? ""], finalUrl, 80);
  const verificationQueue = buildVerificationQueue({
    fieldCandidates,
    researchWorkflowSnapshot,
    stocks,
    relatedLinks
  });

  return {
    tool: "fetch_and_extract_webpage",
    fetched_at: startedAt,
    source: {
      url: normalizedUrl,
      final_url: finalUrl,
      status: response.status,
      ok: response.ok,
      content_type: contentType,
      byte_length: response.byteLength,
      truncated
    },
    metadata: {
      ...metadata,
      published_at: publishedAt,
      webpage_source_level: webpageSourceLevel
    },
    extraction: {
      method: textSource.method,
      clean_text_status: textSource.text
        ? textSource.method === "embedded_content_field"
          ? "complete_or_partial_from_embedded_content"
          : "partial_from_" + textSource.method
        : "unavailable",
      embedded_content_candidates: embeddedCandidates.length,
      warnings: buildWarnings({ response, truncated, textSource, ocr })
    },
    clean_text: cleanText,
    sections,
    webpage_excerpt_snapshot: snapshot,
    research_workflow_snapshot: researchWorkflowSnapshot,
    verification_queue: verificationQueue,
    related_links: relatedLinks,
    field_candidates: fieldCandidates,
    stocks,
    images: images.map((image, index) => ({
      ...image,
      ocr_status: ocr.byIndex[index]?.status ?? (ocrImages ? "not_attempted" : "not_requested"),
      ocr_text: ocr.byIndex[index]?.text ?? ""
    })),
    verification_policy: {
      numeric_fields:
        "网页中的涨停家数、跌停家数、炸板率、连板高度、成交额、板块涨跌幅等数值均为待核验的网页摘录；附有原始权威链接或来源等级不代表已核验，须实际读取原始来源并匹配声明、日期、单位和统计范围后才能确认。",
      opinions:
        "网页中的题材判断、个股逻辑和作者观点归类为观点/推演，不得直接写入事实。",
      workflow:
        "research_workflow_snapshot 只做研究线索分桶；verification_queue 列出最需要回到 S/A/B 级来源或结构化数据核验的项目。"
    }
  };
}

function decodeBytes(bytes, contentType) {
  const bomCharset =
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      ? "utf-8"
      : bytes[0] === 0xff && bytes[1] === 0xfe
        ? "utf-16le"
        : bytes[0] === 0xfe && bytes[1] === 0xff
          ? "utf-16be"
          : "";
  const headerCharset = contentType.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1];
  const prefix = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 1024)).toString("latin1");
  const metaCharset =
    prefix.match(/<meta\b[^>]*\bcharset\s*=\s*(?:"\s*([^"]+)|'\s*([^']+)|([^\s"'/>;]+))/i)
      ?.slice(1)
      .find(Boolean)
      ?.split(/[;\s]/, 1)[0] ||
    prefix.match(/<meta\b[^>]*\bcontent\s*=\s*["'][^"']*charset\s*=\s*([^;\s"']+)/i)?.[1];
  const candidates = [bomCharset, headerCharset, metaCharset, "utf-8"].filter(Boolean);
  for (const candidate of new Set(candidates)) {
    const charset = candidate.toLowerCase();
    const label = /^(?:gbk|gb2312|gb_2312-80|x-gbk|gb18030)$/i.test(charset)
      ? "gb18030"
      : charset;
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // Try the next authoritative charset candidate before falling back to UTF-8.
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

function extractMetadata(html, baseUrl) {
  const wantedMetaNames = new Set([
    "description",
    "og:description",
    "keywords",
    "author",
    "article:published_time"
  ]);
  const metaValues = new Map();
  const titleParts = [];
  let collectingTitle = false;
  let title = "";
  let canonical = "";

  scanHtml(html, {
    onStartTag(tag) {
      if (tag.name === "title" && !title && !collectingTitle) {
        collectingTitle = true;
        titleParts.length = 0;
        return;
      }
      if (tag.name === "meta") {
        const attrs = parseAttrs(tag.raw);
        const name = (attrs.name || attrs.property || "").toLowerCase();
        if (wantedMetaNames.has(name) && !metaValues.has(name)) {
          metaValues.set(name, attrs.content || "");
        }
        return;
      }
      if (tag.name === "link" && !canonical) {
        const attrs = parseAttrs(tag.raw);
        if ((attrs.rel || "").toLowerCase() === "canonical") canonical = attrs.href || "";
      }
    },
    onEndTag(tag) {
      if (tag.name === "title" && collectingTitle) {
        title = htmlDecode(titleParts.join(""));
        collectingTitle = false;
      }
    },
    onText(text) {
      if (collectingTitle) titleParts.push(text);
    }
  });

  return {
    title: normalizeInline(title),
    description: normalizeInline(metaValues.get("description") || metaValues.get("og:description") || ""),
    keywords: normalizeInline(metaValues.get("keywords") || ""),
    author: normalizeInline(metaValues.get("author") || ""),
    published_at: normalizeInline(metaValues.get("article:published_time") || ""),
    canonical_url: canonical ? normalizeUrl(canonical, baseUrl) : ""
  };
}

function parseAttrs(tag) {
  const attrs = {};
  let cursor = 1;
  if (tag[cursor] === "/") cursor += 1;
  while (cursor < tag.length && isHtmlWhitespace(tag[cursor])) cursor += 1;
  while (cursor < tag.length && isTagNameChar(tag[cursor])) cursor += 1;

  while (cursor < tag.length - 1) {
    while (cursor < tag.length && (isHtmlWhitespace(tag[cursor]) || tag[cursor] === "/")) cursor += 1;
    if (cursor >= tag.length - 1 || tag[cursor] === ">") break;

    const nameStart = cursor;
    while (
      cursor < tag.length &&
      !isHtmlWhitespace(tag[cursor]) &&
      tag[cursor] !== "=" &&
      tag[cursor] !== ">" &&
      tag[cursor] !== "/"
    ) {
      cursor += 1;
    }
    if (cursor === nameStart) {
      cursor += 1;
      continue;
    }
    const name = tag.slice(nameStart, cursor).toLowerCase();
    while (cursor < tag.length && isHtmlWhitespace(tag[cursor])) cursor += 1;
    if (tag[cursor] !== "=") {
      attrs[name] = "";
      continue;
    }

    cursor += 1;
    while (cursor < tag.length && isHtmlWhitespace(tag[cursor])) cursor += 1;
    let value = "";
    const quote = tag[cursor] === '"' || tag[cursor] === "'" ? tag[cursor] : "";
    if (quote) {
      cursor += 1;
      const valueStart = cursor;
      while (cursor < tag.length && tag[cursor] !== quote) cursor += 1;
      value = tag.slice(valueStart, cursor);
      if (tag[cursor] === quote) cursor += 1;
    } else {
      const valueStart = cursor;
      while (cursor < tag.length && !isHtmlWhitespace(tag[cursor]) && tag[cursor] !== ">") cursor += 1;
      value = tag.slice(valueStart, cursor);
    }
    attrs[name] = htmlDecode(value);
  }
  return attrs;
}

function scanHtml(html, visitor) {
  let cursor = 0;
  while (cursor < html.length) {
    const tagStart = html.indexOf("<", cursor);
    if (tagStart < 0) {
      if (cursor < html.length && visitor.onText?.(html.slice(cursor)) === false) return false;
      return true;
    }
    if (tagStart > cursor && visitor.onText?.(html.slice(cursor, tagStart)) === false) return false;

    if (html.startsWith("<!--", tagStart)) {
      const commentEnd = html.indexOf("-->", tagStart + 4);
      if (commentEnd < 0) return true;
      if (visitor.onMarkup?.(html.slice(tagStart, commentEnd + 3)) === false) return false;
      cursor = commentEnd + 3;
      continue;
    }
    if (!looksLikeTagStart(html, tagStart)) {
      if (visitor.onText?.("<") === false) return false;
      cursor = tagStart + 1;
      continue;
    }

    const tagEnd = findTagEnd(html, tagStart + 1);
    if (tagEnd < 0) return true;
    const tag = parseTag(html.slice(tagStart, tagEnd + 1));
    cursor = tagEnd + 1;
    if (!tag.name) {
      if (visitor.onMarkup?.(tag.raw) === false) return false;
      continue;
    }

    const callback = tag.closing ? visitor.onEndTag : visitor.onStartTag;
    if (callback?.(tag) === false) return false;
    if (tag.closing || tag.selfClosing || (tag.name !== "script" && tag.name !== "style")) continue;

    const closingTag = findClosingTag(html, tag.name, cursor);
    if (!closingTag) return true;
    const rawClosingTag = html.slice(closingTag.start, closingTag.end + 1);
    if (visitor.onEndTag?.({
      name: tag.name,
      raw: rawClosingTag,
      closing: true,
      selfClosing: false
    }) === false) {
      return false;
    }
    cursor = closingTag.end + 1;
  }
  return true;
}

function looksLikeTagStart(html, tagStart) {
  const next = html[tagStart + 1];
  if (isAsciiLetter(next) || next === "!" || next === "?") return true;
  return next === "/" && isAsciiLetter(html[tagStart + 2]);
}

function findTagEnd(html, fromIndex) {
  let quote = "";
  for (let index = fromIndex; index < html.length; index += 1) {
    const char = html[index];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return index;
    }
  }
  return -1;
}

function parseTag(raw) {
  let cursor = 1;
  let closing = false;
  if (raw[cursor] === "/") {
    closing = true;
    cursor += 1;
  }
  while (cursor < raw.length && isHtmlWhitespace(raw[cursor])) cursor += 1;
  const nameStart = cursor;
  while (cursor < raw.length && isTagNameChar(raw[cursor])) cursor += 1;
  const name = raw.slice(nameStart, cursor).toLowerCase();
  let tail = raw.length - 2;
  while (tail > cursor && isHtmlWhitespace(raw[tail])) tail -= 1;
  return {
    name,
    raw,
    closing,
    selfClosing: !closing && raw[tail] === "/"
  };
}

function findClosingTag(html, name, fromIndex) {
  const needle = `</${name}`;
  let cursor = fromIndex;
  while (cursor < html.length) {
    const start = indexOfAsciiCaseInsensitive(html, needle, cursor);
    if (start < 0) return null;
    const afterName = start + needle.length;
    if (!isTagNameChar(html[afterName])) {
      const end = findTagEnd(html, afterName);
      return end < 0 ? null : { start, end };
    }
    cursor = afterName;
  }
  return null;
}

function indexOfAsciiCaseInsensitive(text, needle, fromIndex) {
  const finalStart = text.length - needle.length;
  for (let start = fromIndex; start <= finalStart; start += 1) {
    let matched = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (asciiLowerCode(text.charCodeAt(start + offset)) !== asciiLowerCode(needle.charCodeAt(offset))) {
        matched = false;
        break;
      }
    }
    if (matched) return start;
  }
  return -1;
}

function asciiLowerCode(code) {
  return code >= 65 && code <= 90 ? code + 32 : code;
}

function isAsciiLetter(char) {
  const code = char?.charCodeAt(0) ?? -1;
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isTagNameChar(char) {
  const code = char?.charCodeAt(0) ?? -1;
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    char === ":" ||
    char === "-"
  );
}

function isJsWordChar(char) {
  const code = char?.charCodeAt(0) ?? -1;
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    char === "_"
  );
}

function isHtmlWhitespace(char) {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";
}

function isBlockTextTag(name) {
  return (
    name === "p" ||
    name === "div" ||
    name === "li" ||
    name === "tr" ||
    name === "h1" ||
    name === "h2" ||
    name === "h3" ||
    name === "h4" ||
    name === "h5" ||
    name === "h6" ||
    name === "section" ||
    name === "article" ||
    name === "blockquote"
  );
}

function extractEmbeddedContentCandidates(html) {
  const candidates = [];
  const seen = new Set();
  scanEmbeddedContentStrings(html, (value) => {
    const decoded = decodeJsString(value);
    if (seen.has(decoded)) return;
    const text = stripHtmlToText(decoded);
    const score =
      text.length +
      (/<p|<div|<span|<img/i.test(decoded) ? 500 : 0) +
      (/(全球市场|盘面热点|题材|公告|涨停|No\d+)/.test(text) ? 500 : 0);
    if (text.length >= 80) {
      seen.add(decoded);
      candidates.push({ html: decoded, textLength: text.length, score });
      candidates.sort((a, b) => b.score - a.score);
      if (candidates.length > 10) candidates.pop();
    }
  });
  return candidates;
}

function scanEmbeddedContentStrings(source, onValue) {
  const key = "content";
  let cursor = 0;
  while (cursor < source.length) {
    let afterKey = -1;
    if (
      source[cursor] === '"' &&
      source.startsWith(key, cursor + 1) &&
      source[cursor + key.length + 1] === '"'
    ) {
      afterKey = cursor + key.length + 2;
    } else if (
      source.startsWith(key, cursor) &&
      !isJsWordChar(source[cursor - 1]) &&
      !isJsWordChar(source[cursor + key.length])
    ) {
      afterKey = cursor + key.length;
    }

    if (afterKey < 0) {
      cursor += 1;
      continue;
    }
    while (isHtmlWhitespace(source[afterKey])) afterKey += 1;
    if (source[afterKey] !== ":") {
      cursor += 1;
      continue;
    }
    afterKey += 1;
    while (isHtmlWhitespace(source[afterKey])) afterKey += 1;
    const quote = source[afterKey];
    if (quote !== '"' && quote !== "'") {
      cursor += 1;
      continue;
    }

    const valueStart = afterKey + 1;
    let valueEnd = valueStart;
    while (valueEnd < source.length) {
      if (source[valueEnd] === "\\") {
        valueEnd += 2;
        continue;
      }
      if (source[valueEnd] === quote) break;
      valueEnd += 1;
    }
    if (valueEnd >= source.length) return;
    onValue(source.slice(valueStart, valueEnd));
    cursor = valueEnd + 1;
  }
}

function decodeJsString(value) {
  try {
    return JSON.parse(`"${value.replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`);
  } catch {
    return value
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\\//g, "/")
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n");
  }
}

function stripHtmlToText(html) {
  const parts = [];
  scanHtml(html, {
    onText(text) {
      parts.push(text);
    },
    onStartTag(tag) {
      const separatesLines =
        tag.name === "br" ||
        tag.name === "hr" ||
        tag.name === "script" ||
        tag.name === "style";
      parts.push(separatesLines ? "\n" : " ");
    },
    onEndTag(tag) {
      if (tag.name !== "script" && tag.name !== "style") {
        parts.push(isBlockTextTag(tag.name) ? "\n" : " ");
      }
    },
    onMarkup() {
      parts.push(" ");
    }
  });
  return normalizeText(htmlDecode(parts.join("")));
}

function normalizeText(text) {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeInline(text) {
  return normalizeText(text).replace(/\s*\n\s*/g, " ");
}

function htmlDecode(value) {
  if (!value) return "";
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " "
  };
  return value.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (full, entity) => {
    if (entity[0] === "#") {
      const isHex = entity[1]?.toLowerCase() === "x";
      const code = parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      const isScalarValue =
        Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
      return isScalarValue ? String.fromCodePoint(code) : full;
    }
    return named[entity] ?? full;
  });
}

function chooseTextSource(sources) {
  return sources
    .filter((source) => source.text)
    .sort((a, b) => scoreTextSource(b) - scoreTextSource(a))[0] ?? { method: "none", text: "", rawHtml: "" };
}

function scoreTextSource(source) {
  return (
    source.text.length +
    (source.method === "embedded_content_field" ? 2000 : 0) +
    (/(全球市场|盘面热点|题材|公告|涨停|美股|商品期货)/.test(source.text) ? 1000 : 0)
  );
}

function extractImages(htmlParts, baseUrl, maxImages) {
  if (maxImages === 0) return [];
  const seen = new Set();
  const images = [];
  for (const html of htmlParts.filter(Boolean)) {
    scanHtml(html, {
      onStartTag(tag) {
        if (tag.name !== "img") return;
        const attrs = parseAttrs(tag.raw);
        const rawSrc = attrs.src || attrs["data-src"] || attrs["data-original"];
        if (!rawSrc) return;
        const src = normalizeUrl(rawSrc, baseUrl);
        if (!src || seen.has(src)) return;
        seen.add(src);
        images.push({
          src,
          alt: normalizeInline(attrs.alt || ""),
          width: attrs.width || "",
          height: attrs.height || ""
        });
        if (images.length >= maxImages) return false;
      }
    });
    if (images.length >= maxImages) return images;
  }
  return images;
}

function extractRelatedLinks(htmlParts, baseUrl, maxLinks) {
  const links = new Map();
  let order = 0;

  const addLink = (attrs, textParts) => {
    const href = normalizeUrl(attrs.href || "", baseUrl);
    if (!href) return;
    const text = normalizeInline(htmlDecode(textParts.join("")));
    const role = classifyRelatedLink(href, text);
    if (!text && role === "context_link") return;
    const candidate = {
      text: truncateText(text, 120),
      href,
      role,
      order: order++
    };
    const existing = links.get(href);
    if (existing) {
      if (!existing.text && candidate.text) existing.text = candidate.text;
      if (relatedLinkPriority(candidate.role) > relatedLinkPriority(existing.role)) {
        existing.role = candidate.role;
      }
      return;
    }
    if (links.size < maxLinks) {
      links.set(href, candidate);
      return;
    }
    let lowest = null;
    for (const link of links.values()) {
      if (
        !lowest ||
        relatedLinkPriority(link.role) < relatedLinkPriority(lowest.role) ||
        (relatedLinkPriority(link.role) === relatedLinkPriority(lowest.role) && link.order > lowest.order)
      ) {
        lowest = link;
      }
    }
    if (lowest && relatedLinkPriority(candidate.role) > relatedLinkPriority(lowest.role)) {
      links.delete(lowest.href);
      links.set(href, candidate);
    }
  };

  for (const html of htmlParts.filter(Boolean)) {
    let activeAnchor = null;
    scanHtml(html, {
      onStartTag(tag) {
        if (tag.name === "a") {
          activeAnchor = { attrs: parseAttrs(tag.raw), textParts: [] };
        } else if (activeAnchor) {
          activeAnchor.textParts.push(
            tag.name === "br" || tag.name === "hr" || tag.name === "script" || tag.name === "style"
              ? "\n"
              : " "
          );
        }
      },
      onEndTag(tag) {
        if (tag.name === "a") {
          if (activeAnchor) addLink(activeAnchor.attrs, activeAnchor.textParts);
          activeAnchor = null;
        } else if (activeAnchor && tag.name !== "script" && tag.name !== "style") {
          activeAnchor.textParts.push(isBlockTextTag(tag.name) ? "\n" : " ");
        }
      },
      onText(text) {
        if (activeAnchor) activeAnchor.textParts.push(text);
      },
      onMarkup() {
        if (activeAnchor) activeAnchor.textParts.push(" ");
      }
    });
  }
  return [...links.values()]
    .sort((a, b) => relatedLinkPriority(b.role) - relatedLinkPriority(a.role) || a.order - b.order)
    .map(({ order: _order, ...link }) => link);
}

function classifyRelatedLink(url, text) {
  const combined = `${url} ${text}`;
  if (isOfficialHostname(new URL(url).hostname)) {
    return "possible_original_or_official_source";
  }
  if (/(公告|年报|半年报|季报|问询函|监管函|回购|减持|增持|解禁)/.test(combined)) {
    return "announcement_or_capital_event_lead";
  }
  if (/(政策|监管|会议|发布会|数据公布)/.test(combined)) {
    return "policy_or_calendar_lead";
  }
  if (/(行情|涨停|跌停|成交额|龙虎榜|板块)/.test(combined)) {
    return "market_data_lead";
  }
  return "context_link";
}

function relatedLinkPriority(role) {
  return {
    possible_original_or_official_source: 4,
    announcement_or_capital_event_lead: 3,
    policy_or_calendar_lead: 2,
    market_data_lead: 1,
    context_link: 0
  }[role] ?? 0;
}

function normalizeUrl(value, baseUrl) {
  try {
    const parsed = new URL(htmlDecode(value), baseUrl);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
      return "";
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

async function maybeOcrImages(images, options) {
  const byIndex = {};
  if (!options.enabled) return { status: "not_requested", byIndex };
  const runProcess = options.runProcess ?? runChildProcess;
  const tesseract = await findTesseract(runProcess, options);
  if (!tesseract) return { status: "ocr_unavailable", byIndex };

  const dir = await mkdtemp(join(tmpdir(), "cotrader-ocr-"));
  try {
    for (let index = 0; index < Math.min(images.length, options.maxOcrImages); index += 1) {
      const image = images[index];
      try {
        const response = await options.fetchPage(
          image.src,
          {
            maxBytes: MAX_OCR_IMAGE_BYTES,
            timeoutMs: options.timeoutMs,
            userAgent: DEFAULT_USER_AGENT,
            accept: "image/*"
          },
          options.fetchRuntime
        );
        const contentType = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
        if (!response.ok) throw new Error(`Image request returned HTTP ${response.status}.`);
        if (!contentType.startsWith("image/")) throw new Error("Image URL returned a non-image content type.");
        if (response.truncated) throw new Error("Image exceeded the OCR byte limit.");
        if (response.bytes.byteLength === 0) throw new Error("Image response was empty.");
        const imagePath = join(dir, `image-${index}`);
        await writeFile(imagePath, response.bytes);
        const result = await runProcess(tesseract, [imagePath, "stdout", "-l", "chi_sim+eng"], {
          timeoutMs: options.timeoutMs,
          signal: options.fetchRuntime.signal
        });
        byIndex[index] = {
          status: result.status === 0 ? "ok" : "failed",
          text: normalizeText(result.stdout || ""),
          error: normalizeInline(result.stderr || "")
        };
      } catch (error) {
        if (options.fetchRuntime.signal?.aborted) throw error;
        byIndex[index] = { status: "failed", text: "", error: error.message };
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return { status: "attempted", byIndex };
}

async function findTesseract(runProcess, options) {
  try {
    const result = await runProcess("tesseract", ["--version"], {
      timeoutMs: Math.min(options.timeoutMs, 3000),
      signal: options.fetchRuntime.signal
    });
    return result.status === 0 ? "tesseract" : "";
  } catch (error) {
    if (options.fetchRuntime.signal?.aborted) throw error;
    return "";
  }
}

function runChildProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(options.signal.reason ?? new Error("Process aborted."));
      return;
    }

    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
      callback(value);
    };
    const append = (target, chunk) => (target + chunk).slice(0, MAX_PROCESS_OUTPUT_CHARS);
    const onAbort = () => {
      child.kill();
      finish(reject, options.signal.reason ?? new Error("Process aborted."));
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.once("error", (error) => finish(reject, error));
    child.once("close", (status, signal) => {
      finish(resolve, {
        status,
        signal,
        stdout,
        stderr: timedOut ? `${stderr}\nProcess timed out.`.trim() : stderr
      });
    });
    options.signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function extractFieldCandidates(text) {
  const lines = text.split("\n").map(normalizeInline).filter(Boolean);
  const candidates = [];
  for (const line of lines) {
    if (line.length > 360) continue;
    const matched = FIELD_KEYWORDS.filter((keyword) => line.includes(keyword));
    if (matched.length === 0) continue;
    candidates.push({
      text: line,
      matched_keywords: matched,
      status: "webpage_excerpt_pending_verification",
      source_level: "C/D unless cross-checked with original data source"
    });
    if (candidates.length >= 80) break;
  }
  return candidates;
}

function buildResearchWorkflowSnapshot(text, context) {
  const lines = text.split("\n").map(normalizeInline).filter(Boolean);
  const evidenceBuckets = Object.fromEntries(
    RESEARCH_BUCKET_RULES.map((rule) => [
      rule.key,
      {
        title: rule.title,
        source_level: rule.source_level,
        status: rule.status,
        items: []
      }
    ])
  );

  for (const line of lines) {
    if (line.length > 420) continue;
    for (const rule of RESEARCH_BUCKET_RULES) {
      const matched = rule.keywords.filter((keyword) => line.includes(keyword));
      if (matched.length === 0) continue;
      const bucket = evidenceBuckets[rule.key];
      if (bucket.items.length >= 30) continue;
      bucket.items.push({
        text: line,
        matched_keywords: matched.slice(0, 8),
        status: rule.status
      });
    }
  }

  return {
    source_profile: {
      url: context.finalUrl,
      title: context.metadata.title,
      author: context.metadata.author,
      published_at: context.publishedAt,
      clean_text_status: context.cleanTextStatus,
      webpage_source_level: context.webpageSourceLevel
    },
    evidence_buckets: evidenceBuckets,
    desk_questions: [
      "哪些内容是可核验事实，哪些只是作者观点或市场推演？",
      "哪些行情数字必须回到结构化行情源核验？",
      "哪些公司业务、客户、订单或产能表述必须回到公告/年报/官网核验？",
      "哪些催化是新增信息，哪些可能是旧消息重复交易？",
      "哪些方向存在高开兑现、弱关联跟风或一致性过高风险？"
    ]
  };
}

function buildVerificationQueue({ fieldCandidates, researchWorkflowSnapshot, stocks, relatedLinks }) {
  const queue = [];
  const add = (item) => {
    if (!item.text && !item.target) return;
    const key = `${item.type}:${item.text || item.target}`;
    if (queue.some((existing) => `${existing.type}:${existing.text || existing.target}` === key)) return;
    queue.push({ status: "pending_verification", ...item });
  };

  for (const candidate of fieldCandidates.slice(0, 20)) {
    add({
      type: "market_numeric_field",
      text: candidate.text,
      reason: "涨跌停、成交额、连板、商品、汇率或海外市场字段需要结构化行情源核验。",
      suggested_sources: ["交易所或权威行情数据", "期货/汇率/商品官方或权威数据源"]
    });
  }

  const buckets = researchWorkflowSnapshot.evidence_buckets;
  for (const item of buckets.policy_regulation.items.slice(0, 8)) {
    add({
      type: "policy_or_regulation",
      text: item.text,
      reason: "政策和监管表述需要回到 S 级官方发布核验发布时间、适用范围和原文口径。",
      suggested_sources: ["国务院/部委/交易所/监管机构原文"]
    });
  }
  for (const item of buckets.company_announcements.items.slice(0, 10)) {
    add({
      type: "company_announcement_or_capital_event",
      text: item.text,
      reason: "公告、业绩、回购、减持、解禁、停复牌等需要回到 A 级公告源核验。",
      suggested_sources: ["巨潮资讯", "交易所公告", "上市公司公告"]
    });
  }
  for (const item of buckets.stock_logic.items.slice(0, 10)) {
    add({
      type: "company_business_claim",
      text: item.text,
      reason: "公司主营、客户、订单、产能、技术路线和产业链位置不能只依赖网页叙述。",
      suggested_sources: ["定期报告", "临时公告", "投资者关系记录", "公司官网"]
    });
  }
  for (const item of buckets.risk_alerts.items.slice(0, 8)) {
    add({
      type: "risk_signal",
      text: item.text,
      reason: "风险线索需要确认风险类型、发生日期和是否仍有效。",
      suggested_sources: ["公告/监管函/行情数据/解禁日历"]
    });
  }
  for (const stock of stocks.filter((stock) => !stock.code).slice(0, 10)) {
    add({
      type: "stock_identity",
      target: stock.name,
      reason: "只有简称没有代码，容易与同名或相近简称混淆。",
      suggested_sources: ["证券简称代码表", "交易所或行情源"]
    });
  }
  for (const link of relatedLinks.filter((link) => link.role !== "context_link").slice(0, 10)) {
    add({
      type: "related_link",
      text: link.text || link.href,
      target: link.href,
      reason: "页面内链接可能指向原始出处或二次线索，需打开核验后才能作为事实依据。",
      suggested_sources: ["链接目标页原文"]
    });
  }

  return queue.slice(0, 60);
}

function extractStocks(html) {
  const stocks = new Map();
  for (const match of html.matchAll(/name\s*:\s*"([^"]{1,30})"\s*,\s*code\s*:\s*"((?:sh|sz|bj)\d{6})"/gi)) {
    const name = htmlDecode(match[1]);
    stocks.set(match[2], { name, code: match[2], source: "embedded_stock_list" });
  }
  return [...stocks.values()];
}

function buildSections(text) {
  const lines = text.split("\n").map(normalizeInline).filter(Boolean);
  const sections = [];
  let current = null;
  const headingPattern = /^(No\d+[:：].{1,40}|[一二三四五六七八九十]{1,3}[、.．].{1,40}|【.{1,40}】)$/i;
  for (const line of lines) {
    if (headingPattern.test(line)) {
      if (current) sections.push(current);
      current = { heading: line, text: "" };
    } else if (current) {
      current.text += (current.text ? "\n" : "") + line;
    }
  }
  if (current) sections.push(current);
  return sections.slice(0, 40).map((section) => ({
    heading: section.heading,
    text: truncateText(section.text, 1200)
  }));
}

function buildWebpageSnapshot(text) {
  const lines = text.split("\n").map(normalizeInline).filter(Boolean);
  return {
    market_data: lines.filter((line) => FIELD_KEYWORDS.some((keyword) => line.includes(keyword))).slice(0, 30),
    announcements: lines
      .filter((line) => ANNOUNCEMENT_KEYWORDS.some((keyword) => line.includes(keyword)))
      .slice(0, 30),
    theme_catalysts: lines
      .filter((line) => /(题材|催化|概念|产业|事件|政策|AI|芯片|半导体|算力|商业航天)/.test(line))
      .slice(0, 30),
    opinions: lines.filter((line) => /(有望|可能|预期|看好|判断|观点|情绪|风险)/.test(line)).slice(0, 30)
  };
}

function inferPublishedAt(text) {
  const match = text.match(
    /(?<year>20\d{2})[-/年](?<month>\d{1,2})[-/月](?<day>\d{1,2})(?:日)?(?:[ T]+(?<hour>\d{1,2}):(?<minute>\d{2})(?::(?<second>\d{2}))?)?/
  );
  return match ? formatIsoDateParts(match.groups) : "";
}

function normalizePublishedAt(value) {
  if (!value) return "";
  const explicit = value.match(
    /^(?<year>\d{4})[-/年](?<month>\d{1,2})[-/月](?<day>\d{1,2})(?:日)?(?:[ T]+(?<hour>\d{1,2}):(?<minute>\d{2})(?::(?<second>\d{2}))?)?$/
  );
  if (explicit) return formatIsoDateParts(explicit.groups);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function formatIsoDateParts({ year, month, day, hour, minute, second }) {
  const values = [year, month, day, hour ?? "0", minute ?? "0", second ?? "0"].map(Number);
  const [numericYear, numericMonth, numericDay, numericHour, numericMinute, numericSecond] = values;
  const date = new Date(
    Date.UTC(numericYear, numericMonth - 1, numericDay, numericHour, numericMinute, numericSecond)
  );
  if (
    date.getUTCFullYear() !== numericYear ||
    date.getUTCMonth() !== numericMonth - 1 ||
    date.getUTCDate() !== numericDay ||
    date.getUTCHours() !== numericHour ||
    date.getUTCMinutes() !== numericMinute ||
    date.getUTCSeconds() !== numericSecond
  ) {
    return "";
  }
  const datePart = `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  if (hour === undefined) return datePart;
  return `${datePart}T${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:${(second ?? "00").padStart(2, "0")}`;
}

function classifySourceLevel(url) {
  const hostname = new URL(url).hostname.toLowerCase();
  if (isOfficialHostname(hostname)) {
    return "S/A";
  }
  if (
    ["eastmoney.com", "10jqka.com.cn", "jiuyangongshe.com", "xueqiu.com", "cls.cn", "stcn.com"].some(
      (domain) => hostnameMatches(hostname, domain)
    )
  ) {
    return "C/D by default; confirm facts against original sources";
  }
  return "unknown; classify by page owner and original source links";
}

function isOfficialHostname(hostname) {
  const normalized = hostname.toLowerCase();
  return ["gov.cn", "sse.com.cn", "szse.cn", "cninfo.com.cn"].some((domain) =>
    hostnameMatches(normalized, domain)
  );
}

function hostnameMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function buildWarnings({ response, truncated, textSource, ocr }) {
  const warnings = [];
  if (!response.ok) warnings.push(`HTTP status ${response.status}; extraction may be incomplete.`);
  if (truncated) warnings.push("HTML exceeded maxBytes and was truncated.");
  if (textSource.method !== "embedded_content_field") {
    warnings.push("No rich embedded article content was selected; clean_text may include navigation or comments.");
  }
  if (ocr.status === "ocr_unavailable") {
    warnings.push("Image OCR requested but tesseract is not available.");
  }
  return warnings;
}

function matchFirst(text, regex) {
  return text.match(regex)?.[1] ?? text.match(regex)?.[0] ?? "";
}

function truncateText(text, maxChars) {
  if (text.length <= maxChars) return text;
  const marker = "\n...[truncated]";
  if (maxChars <= marker.length) return text.slice(0, maxChars);
  return text.slice(0, maxChars - marker.length) + marker;
}

async function main() {
  const [url, rawOptions] = process.argv.slice(2);
  if (!url) {
    console.error("Usage: node tools/fetch_and_extract_webpage.mjs <url> [json-options]");
    process.exit(2);
  }
  const options = rawOptions ? JSON.parse(rawOptions) : {};
  const result = await fetchAndExtractWebpage(url, options);
  process.stdout.write(JSON.stringify(result, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
