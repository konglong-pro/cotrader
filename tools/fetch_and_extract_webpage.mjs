#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_USER_AGENT =
  "cotrader-web-extractor/0.1 (+https://local.cotrader; research extraction)";

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

export async function fetchAndExtractWebpage(url, options = {}) {
  const startedAt = new Date().toISOString();
  const normalizedUrl = validateHttpUrl(url);
  const maxBytes = Number(options.maxBytes ?? 8_000_000);
  const maxTextChars = Number(options.maxTextChars ?? 30_000);
  const maxImages = Number(options.maxImages ?? 30);
  const timeoutMs = Number(options.timeoutMs ?? 20_000);
  const ocrImages = Boolean(options.ocrImages);
  const maxOcrImages = Number(options.maxOcrImages ?? 3);

  const response = await fetchWithTimeout(normalizedUrl, timeoutMs);
  const finalUrl = response.url || normalizedUrl;
  const contentType = response.headers.get("content-type") || "";
  const bytes = new Uint8Array(await response.arrayBuffer());
  const truncated = bytes.byteLength > maxBytes;
  const limitedBytes = truncated ? bytes.slice(0, maxBytes) : bytes;
  const html = decodeBytes(limitedBytes, contentType);

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
  const ocr = await maybeOcrImages(images, { enabled: ocrImages, maxOcrImages, timeoutMs });
  const cleanText = truncateText(textSource.text, maxTextChars);
  const sections = buildSections(cleanText);
  const fieldCandidates = extractFieldCandidates(cleanText);
  const stocks = extractStocks(html, metadata);
  const snapshot = buildWebpageSnapshot(cleanText);

  return {
    tool: "fetch_and_extract_webpage",
    fetched_at: startedAt,
    source: {
      url: normalizedUrl,
      final_url: finalUrl,
      status: response.status,
      ok: response.ok,
      content_type: contentType,
      byte_length: bytes.byteLength,
      truncated
    },
    metadata: {
      ...metadata,
      published_at: metadata.published_at || inferPublishedAt(visibleText) || inferPublishedAt(cleanText),
      webpage_source_level: classifySourceLevel(finalUrl)
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
    field_candidates: fieldCandidates,
    stocks,
    images: images.map((image, index) => ({
      ...image,
      ocr_status: ocr.byIndex[index]?.status ?? (ocrImages ? "not_attempted" : "not_requested"),
      ocr_text: ocr.byIndex[index]?.text ?? ""
    })),
    verification_policy: {
      numeric_fields:
        "网页中的涨停家数、跌停家数、炸板率、连板高度、成交额、板块涨跌幅等数值默认是网页摘录，除非网页提供原始权威来源，否则状态为待核验。",
      opinions:
        "网页中的题材判断、个股逻辑和作者观点归类为观点/推演，不得直接写入事实。"
    }
  };
}

function validateHttpUrl(value) {
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are supported.");
  }
  parsed.hash = "";
  return parsed.toString();
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

function decodeBytes(bytes, contentType) {
  const charsetMatch = contentType.match(/charset=([^;\s]+)/i);
  const charset = (charsetMatch?.[1] || "utf-8").toLowerCase();
  const label = charset.includes("gb") ? "gb18030" : charset;
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function extractMetadata(html, baseUrl) {
  const title = htmlDecode(matchFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => parseAttrs(m[0]));
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => parseAttrs(m[0]));
  const metaByName = (name) => {
    const found = metas.find(
      (m) =>
        (m.name && m.name.toLowerCase() === name.toLowerCase()) ||
        (m.property && m.property.toLowerCase() === name.toLowerCase())
    );
    return htmlDecode(found?.content ?? "");
  };
  const canonical = links.find((l) => (l.rel || "").toLowerCase() === "canonical")?.href;
  return {
    title: normalizeInline(title),
    description: normalizeInline(metaByName("description") || metaByName("og:description")),
    keywords: normalizeInline(metaByName("keywords")),
    author: normalizeInline(metaByName("author")),
    published_at: normalizeInline(metaByName("article:published_time")),
    canonical_url: canonical ? normalizeUrl(canonical, baseUrl) : ""
  };
}

function parseAttrs(tag) {
  const attrs = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attrs[match[1].toLowerCase()] = htmlDecode(match[3] ?? match[4] ?? match[5] ?? "");
  }
  return attrs;
}

function extractEmbeddedContentCandidates(html) {
  const candidates = [];
  const patterns = [
    /\bcontent\s*:\s*"((?:\\.|[^"\\])*)"/g,
    /\bcontent\s*:\s*'((?:\\.|[^'\\])*)'/g,
    /"content"\s*:\s*"((?:\\.|[^"\\])*)"/g
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const decoded = decodeJsString(match[1]);
      const text = stripHtmlToText(decoded);
      const score =
        text.length +
        (/<p|<div|<span|<img/i.test(decoded) ? 500 : 0) +
        (/(全球市场|盘面热点|题材|公告|涨停|No\d+)/.test(text) ? 500 : 0);
      if (text.length >= 80) {
        candidates.push({ html: decoded, textLength: text.length, score });
      }
    }
  }
  return candidates
    .sort((a, b) => b.score - a.score)
    .filter((candidate, index, array) => index === 0 || candidate.html !== array[index - 1].html)
    .slice(0, 10);
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
  return normalizeText(
    htmlDecode(
      html
        .replace(/<script\b[\s\S]*?<\/script>/gi, "\n")
        .replace(/<style\b[\s\S]*?<\/style>/gi, "\n")
        .replace(/<!--[\s\S]*?-->/g, "\n")
        .replace(/<(br|hr)\b[^>]*>/gi, "\n")
        .replace(/<\/(p|div|li|tr|h[1-6]|section|article|blockquote)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
    )
  );
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
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
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
  const seen = new Set();
  const images = [];
  for (const html of htmlParts.filter(Boolean)) {
    for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
      const attrs = parseAttrs(match[0]);
      const rawSrc = attrs.src || attrs["data-src"] || attrs["data-original"];
      if (!rawSrc) continue;
      const src = normalizeUrl(rawSrc, baseUrl);
      if (!src || seen.has(src)) continue;
      seen.add(src);
      images.push({
        src,
        alt: normalizeInline(attrs.alt || ""),
        width: attrs.width || "",
        height: attrs.height || ""
      });
      if (images.length >= maxImages) return images;
    }
  }
  return images;
}

function normalizeUrl(value, baseUrl) {
  try {
    return new URL(htmlDecode(value), baseUrl).toString();
  } catch {
    return "";
  }
}

async function maybeOcrImages(images, options) {
  const byIndex = {};
  if (!options.enabled) return { status: "not_requested", byIndex };
  const tesseract = findTesseract();
  if (!tesseract) return { status: "ocr_unavailable", byIndex };

  const dir = await mkdtemp(join(tmpdir(), "cotrader-ocr-"));
  try {
    for (let index = 0; index < Math.min(images.length, options.maxOcrImages); index += 1) {
      const image = images[index];
      try {
        const response = await fetchWithTimeout(image.src, options.timeoutMs);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const imagePath = join(dir, `image-${index}`);
        await writeFile(imagePath, bytes);
        const result = spawnSync(tesseract, [imagePath, "stdout", "-l", "chi_sim+eng"], {
          encoding: "utf8",
          timeout: options.timeoutMs
        });
        byIndex[index] = {
          status: result.status === 0 ? "ok" : "failed",
          text: normalizeText(result.stdout || ""),
          error: normalizeInline(result.stderr || "")
        };
      } catch (error) {
        byIndex[index] = { status: "failed", text: "", error: error.message };
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return { status: "attempted", byIndex };
}

function findTesseract() {
  const result = spawnSync("tesseract", ["--version"], { encoding: "utf8", timeout: 3000 });
  return result.status === 0 ? "tesseract" : "";
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

function extractStocks(html, metadata) {
  const stocks = new Map();
  const seenNames = new Set();
  for (const match of html.matchAll(/name\s*:\s*"([^"]{1,30})"\s*,\s*code\s*:\s*"((?:sh|sz|bj)\d{6})"/gi)) {
    const name = htmlDecode(match[1]);
    stocks.set(match[2], { name, code: match[2], source: "embedded_stock_list" });
    seenNames.add(name);
  }
  for (const rawName of (metadata.keywords || "").split(/[,\s，、]+/).filter(Boolean)) {
    if (!rawName || rawName.length > 12) continue;
    if (seenNames.has(rawName)) continue;
    const key = `name:${rawName}`;
    if (!stocks.has(key)) stocks.set(key, { name: rawName, code: "", source: "meta_keywords" });
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
  return (
    matchFirst(text, /20\d{2}[-/年]\d{1,2}[-/月]\d{1,2}[日\s]+(?:\d{1,2}:\d{2}(?::\d{2})?)?/) ||
    matchFirst(text, /\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2}(?::\d{2})?/)
  );
}

function classifySourceLevel(url) {
  const hostname = new URL(url).hostname;
  if (/(gov\.cn|sse\.com\.cn|szse\.cn|cninfo\.com\.cn|stats\.gov\.cn|pbc\.gov\.cn)$/i.test(hostname)) {
    return "S/A";
  }
  if (/(eastmoney|10jqka|jiuyangongshe|xueqiu|cls|stcn)/i.test(hostname)) {
    return "C/D by default; confirm facts against original sources";
  }
  return "unknown; classify by page owner and original source links";
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
  return text.length > maxChars ? text.slice(0, maxChars) + "\n...[truncated]" : text;
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
