import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Readable } from "node:stream";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { MAX_FETCH_BYTES, SafeFetchError, safeFetchBuffer } from "../lib/safe_fetch.mjs";
import { InputValidationError } from "../lib/extraction_request.mjs";
import { fetchAndExtractWebpage } from "../tools/fetch_and_extract_webpage.mjs";

test("safe fetch rejects a hostname when DNS resolves to a private address", async () => {
  let requestStarted = false;

  await assert.rejects(
    safeFetchBuffer(
      "https://example.test/article",
      {},
      {
        lookup: async () => [{ address: "127.0.0.1", family: 4 }],
        request: async () => {
          requestStarted = true;
          throw new Error("must not run");
        }
      }
    ),
    (error) => error instanceof SafeFetchError && error.code === "UNSAFE_ADDRESS"
  );

  assert.equal(requestStarted, false);
});

test("safe fetch rejects credentials and every non-public address class", async () => {
  await assert.rejects(
    safeFetchBuffer("https://user:secret@example.test/article", {}, { lookup: async () => [] }),
    (error) => error instanceof SafeFetchError && error.code === "INVALID_URL"
  );

  for (const address of [
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.99.1.2",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.0.1",
    "192.0.2.1",
    "192.88.99.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1",
    "::",
    "::1",
    "64:ff9b:1::1",
    "100::1",
    "2001:2::1",
    "2001:db8::1",
    "2002::1",
    "4000::1",
    "5f00::1",
    "fc00::1",
    "fe80::1",
    "ff00::1"
  ]) {
    await assert.rejects(
      safeFetchBuffer("https://example.test/article", {}, { lookup: async () => [{ address }] }),
      (error) => error instanceof SafeFetchError && error.code === "UNSAFE_ADDRESS",
      address
    );
  }
});

test("safe fetch rejects normalized IPv4 spellings and mapped IPv6 literals", async () => {
  for (const url of [
    "http://127.1/path",
    "http://2130706433/path",
    "http://0177.0.0.1/path",
    "http://0x7f000001/path",
    "http://[::ffff:127.0.0.1]/path"
  ]) {
    await assert.rejects(
      safeFetchBuffer(url),
      (error) => error instanceof SafeFetchError && error.code === "UNSAFE_ADDRESS",
      url
    );
  }
});

test("safe fetch pins DNS and revalidates every redirect target", async () => {
  const requests = [];
  const lookup = async (hostname) => {
    if (hostname === "start.example") return [{ address: "93.184.216.34", family: 4 }];
    if (hostname === "next.example") return [{ address: "142.250.72.14", family: 4 }];
    if (hostname === "blocked.example") return [{ address: "169.254.169.254", family: 4 }];
    throw new Error(`unexpected hostname ${hostname}`);
  };
  const request = async (target, { pinnedAddress }) => {
    requests.push({ url: target.toString(), pinnedAddress });
    if (target.hostname === "start.example") {
      return response(302, { location: "https://next.example/final" });
    }
    return response(200, { "content-type": "text/plain" }, ["done"]);
  };

  const result = await safeFetchBuffer("https://start.example/article", {}, { lookup, request });
  assert.equal(result.url, "https://next.example/final");
  assert.equal(new TextDecoder().decode(result.bytes), "done");
  assert.deepEqual(requests, [
    { url: "https://start.example/article", pinnedAddress: { address: "93.184.216.34", family: 4 } },
    { url: "https://next.example/final", pinnedAddress: { address: "142.250.72.14", family: 4 } }
  ]);

  await assert.rejects(
    safeFetchBuffer("https://start.example/article", {}, {
      lookup,
      request: async () => response(302, { location: "https://blocked.example/metadata" })
    }),
    (error) => error instanceof SafeFetchError && error.code === "UNSAFE_ADDRESS"
  );
});

test("safe fetch limits the decompressed response stream", async () => {
  const compressed = gzipSync("abcdefghijklmnopqrstuvwxyz");
  const result = await safeFetchBuffer(
    "https://example.test/article",
    { maxBytes: 10 },
    {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async () => response(200, { "content-encoding": "gzip" }, [compressed])
    }
  );

  assert.equal(new TextDecoder().decode(result.bytes), "abcdefghij");
  assert.equal(result.byteLength, 10);
  assert.equal(result.truncated, true);
});

test("safe fetch also limits encoded bytes when compressed content expands to nothing", async () => {
  const emptyMember = gzipSync(Buffer.alloc(0));
  const compressed = Buffer.concat(Array.from({ length: 4_000 }, () => emptyMember));

  await assert.rejects(
    safeFetchBuffer(
      "https://example.test/empty-members",
      { maxBytes: 10 },
      {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        request: async () => response(200, { "content-encoding": "gzip" }, [compressed])
      }
    ),
    (error) => error instanceof SafeFetchError && error.code === "BODY_TOO_LARGE"
  );
});

test("safe fetch never permits callers to raise the absolute body limit", async () => {
  const compressed = gzipSync(Buffer.alloc(MAX_FETCH_BYTES + 1, 0x61));
  const result = await safeFetchBuffer(
    "https://example.test/article",
    { maxBytes: MAX_FETCH_BYTES * 10 },
    {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async () => response(200, { "content-encoding": "gzip" }, [compressed])
    }
  );

  assert.equal(result.byteLength, MAX_FETCH_BYTES);
  assert.equal(result.truncated, true);
});

test("safe fetch timeout covers reading the response body", async () => {
  async function* slowBody() {
    yield "headers arrived";
    await new Promise((resolve) => setTimeout(resolve, 100));
    yield "too late";
  }

  await assert.rejects(
    safeFetchBuffer(
      "https://example.test/article",
      { timeoutMs: 20 },
      {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        request: async () => response(200, {}, slowBody())
      }
    ),
    (error) => error instanceof SafeFetchError && error.code === "TIMEOUT"
  );
});

test("safe fetch cancellation disposes an in-flight response body", async () => {
  const controller = new AbortController();
  const body = new Readable({ read() {} });
  body.push("started");
  const pending = safeFetchBuffer(
    "https://example.test/slow",
    {},
    {
      signal: controller.signal,
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async () => ({ statusCode: 200, headers: {}, body })
    }
  );

  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(
    pending,
    (error) => error instanceof SafeFetchError && error.code === "ABORTED"
  );
  assert.equal(body.destroyed, true);
});

test("webpage extraction honors maxImages zero", async () => {
  const result = await extractHtml(
    '<!doctype html><html><body><p>article body</p><img src="https://images.example/a.png"></body></html>',
    { maxImages: 0 }
  );

  assert.deepEqual(result.images, []);
});

test("webpage extraction rejects undeclared runtime controls before fetching", async () => {
  let fetched = false;
  await assert.rejects(
    fetchAndExtractWebpage(
      "https://article.example/story",
      { timeoutMs: 1 },
      { safeFetch: async () => (fetched = true) }
    ),
    (error) => error instanceof InputValidationError && error.code === "INVALID_INPUT"
  );
  assert.equal(fetched, false);
});

test("clean text including its truncation marker stays within maxTextChars", async () => {
  const result = await extractHtml(`<html><body><p>${"a".repeat(2_000)}</p></body></html>`, {
    maxTextChars: 1_000
  });

  assert.equal(result.clean_text.length, 1_000);
  assert.match(result.clean_text, /\.\.\.\[truncated\]$/);
});

test("malformed unclosed HTML markers scale linearly without blocking extraction", async () => {
  await extractHtml(malformedHtml(100), { maxTextChars: 1_000, maxImages: 1 });

  const smallMs = await measureExtraction(malformedHtml(500));
  const largeMs = await measureExtraction(malformedHtml(4_000));

  assert.ok(
    largeMs <= Math.max(500, smallMs * 12),
    `8x input grew from ${smallMs.toFixed(1)}ms to ${largeMs.toFixed(1)}ms`
  );
});

test("webpage extraction honors a GBK meta charset", async () => {
  const prefix = Buffer.from('<html><head><meta charset="gbk"><title>');
  const chinese = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]);
  const suffix = Buffer.from("</title></head><body><p>article body</p></body></html>");
  const result = await extractHtml(Buffer.concat([prefix, chinese, suffix]), {}, "text/html");

  assert.equal(result.metadata.title, "中文");
});

test("an unsupported HTTP charset falls through to a valid HTML meta charset", async () => {
  const prefix = Buffer.from('<html><head><meta charset="gbk"><title>');
  const chinese = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]);
  const suffix = Buffer.from("</title></head><body><p>article body</p></body></html>");
  const result = await extractHtml(
    Buffer.concat([prefix, chinese, suffix]),
    {},
    "text/html; charset=not-a-real-charset"
  );

  assert.equal(result.metadata.title, "中文");
});

test("a Unicode BOM takes precedence over conflicting HTTP and meta charsets", async () => {
  const bytes = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from('<html><head><meta charset="gbk"><title>中文</title></head><body>article body</body></html>')
  ]);
  const result = await extractHtml(bytes, {}, "text/html; charset=gbk");

  assert.equal(result.metadata.title, "中文");
});

test("webpage extraction preserves an invalid numeric entity instead of crashing", async () => {
  const result = await extractHtml(
    "<html><head><title>Article &#999999999; &#0; &#xD800;</title></head><body><p>article body</p></body></html>"
  );

  assert.equal(result.metadata.title, "Article &#999999999; &#0; &#xD800;");
});

test("webpage extraction keeps web URLs, deduplicates fragments, and prioritizes official links", async () => {
  const contextLinks = Array.from(
    { length: 80 },
    (_, index) => `<a href="/context/${index}">context ${index}</a>`
  ).join("");
  const result = await extractHtml(`
    <html><body>
      <img src="data:image/png;base64,AAAA">
      <img src="javascript:alert(1)">
      <img src="//cdn.example/image.png">
      <a href="https://evilgov.cn/notice">also not official</a>
      ${contextLinks}
      <a href="https://evil.test/?next=gov.cn">not official</a>
      <a href="https://sub.gov.cn/policy#first">official policy</a>
      <a href="https://sub.gov.cn/policy#second">duplicate official policy</a>
    </body></html>
  `);

  assert.deepEqual(result.images.map(({ src }) => src), ["https://cdn.example/image.png"]);
  const official = result.related_links.filter(({ href }) => href === "https://sub.gov.cn/policy");
  assert.equal(official.length, 1);
  assert.equal(official[0].role, "possible_original_or_official_source");
  assert.equal(result.related_links.find(({ href }) => href.startsWith("https://evilgov.cn"))?.role, "context_link");
  assert.equal(result.related_links.some(({ href }) => href.startsWith("https://evil.test")), false);
});

test("linear HTML scanning preserves separators around inline markup and removed raw text", async () => {
  const result = await extractHtml(`
    <html><body>
      <p>alpha<span>beta</span><!-- hidden -->gamma<script>ignored()</script>delta</p>
      <a href="/details">one<strong>two</strong><!-- hidden -->three<style>.x{}</style>four</a>
    </body></html>
  `);

  assert.match(result.clean_text, /alpha beta gamma\s+delta/u);
  assert.equal(
    result.related_links.find(({ href }) => href === "https://article.example/details")?.text,
    "one two three four"
  );
});

test("source classification matches hostname boundaries rather than URL substrings", async () => {
  const fake = await extractHtml("<html><body><p>article body</p></body></html>", {}, "text/html", "https://evilgov.cn/story");
  const official = await extractHtml("<html><body><p>article body</p></body></html>", {}, "text/html", "https://policy.gov.cn/story");

  assert.equal(fake.metadata.webpage_source_level, "unknown; classify by page owner and original source links");
  assert.equal(official.metadata.webpage_source_level, "S/A");
});

test("webpage extraction does not turn generic meta keywords into stocks", async () => {
  const result = await extractHtml(`
    <html><head><meta name="keywords" content="AI,机器人,新能源"></head>
    <body><script>const stock = { name: "浦发银行", code: "sh600000" };</script><p>article body</p></body></html>
  `);

  assert.deepEqual(result.stocks, [
    { name: "浦发银行", code: "sh600000", source: "embedded_stock_list" }
  ]);
});

test("webpage extraction normalizes an inferred publication date to ISO 8601", async () => {
  const result = await extractHtml(
    "<html><body><p>发布于 2026年7月9日 08:05</p><p>article body</p></body></html>"
  );

  assert.equal(result.metadata.published_at, "2026-07-09T08:05:00");
});

test("OCR downloads images through safe fetch and awaits an asynchronous process", async () => {
  const articleUrl = "https://article.example/story";
  const imageUrl = "https://cdn.example/chart.png";
  const fetchedUrls = [];
  const processCalls = [];
  const html = Buffer.from(`<html><body><p>article body</p><img src="${imageUrl}"></body></html>`);
  const safeFetch = async (url) => {
    fetchedUrls.push(url);
    if (url === articleUrl) return fetchedResponse(html, "text/html; charset=utf-8");
    if (url === imageUrl) return fetchedResponse(Buffer.from([0x89, 0x50, 0x4e, 0x47]), "image/png");
    throw new Error(`unexpected URL ${url}`);
  };
  const runProcess = async (command, args) => {
    processCalls.push({ command, args });
    await new Promise((resolve) => setImmediate(resolve));
    return args[0] === "--version"
      ? { status: 0, stdout: "tesseract 5", stderr: "" }
      : { status: 0, stdout: "图表文字", stderr: "" };
  };

  const result = await fetchAndExtractWebpage(
    articleUrl,
    { ocrImages: true, maxImages: 1 },
    { safeFetch, runProcess }
  );

  assert.deepEqual(fetchedUrls, [articleUrl, imageUrl]);
  assert.equal(processCalls.length, 2);
  assert.equal(result.images[0].ocr_status, "ok");
  assert.equal(result.images[0].ocr_text, "图表文字");
});

test("OCR rejects non-image, failed, and oversized image responses before tesseract", async () => {
  const articleUrl = "https://article.example/story";
  const imageUrls = [
    "https://cdn.example/not-image",
    "https://cdn.example/not-found.png",
    "https://cdn.example/oversized.png"
  ];
  const html = Buffer.from(
    `<html><body><p>article body</p>${imageUrls.map((url) => `<img src="${url}">`).join("")}</body></html>`
  );
  let ocrRuns = 0;
  const safeFetch = async (url, options) => {
    if (url === articleUrl) return fetchedResponse(html, "text/html; charset=utf-8");
    assert.equal(options.maxBytes, 5_000_000);
    if (url === imageUrls[0]) return fetchedResponse(Buffer.from("html"), "text/html");
    if (url === imageUrls[1]) {
      return fetchedResponse(Buffer.from("missing"), "image/png", { status: 404, ok: false });
    }
    return fetchedResponse(Buffer.alloc(5_000_000), "image/png", { truncated: true });
  };
  const runProcess = async (_command, args) => {
    if (args[0] !== "--version") ocrRuns += 1;
    return { status: 0, stdout: "tesseract 5", stderr: "" };
  };

  const result = await fetchAndExtractWebpage(
    articleUrl,
    { ocrImages: true, maxImages: 3 },
    { safeFetch, runProcess }
  );

  assert.equal(ocrRuns, 0);
  assert.deepEqual(result.images.map(({ ocr_status }) => ocr_status), ["failed", "failed", "failed"]);
});

test("cancellation during OCR aborts the extraction instead of becoming an image failure", async () => {
  const controller = new AbortController();
  const articleUrl = "https://article.example/story";
  const imageUrl = "https://cdn.example/chart.png";
  const html = Buffer.from(`<html><body><p>article body</p><img src="${imageUrl}"></body></html>`);
  const reason = new Error("caller cancelled");

  await assert.rejects(
    fetchAndExtractWebpage(
      articleUrl,
      { ocrImages: true, maxImages: 1 },
      {
        signal: controller.signal,
        safeFetch: async (url) => {
          if (url === articleUrl) return fetchedResponse(html, "text/html; charset=utf-8");
          controller.abort(reason);
          throw reason;
        },
        runProcess: async () => ({ status: 0, stdout: "tesseract 5", stderr: "" })
      }
    ),
    reason
  );
});

function response(statusCode, headers = {}, chunks = []) {
  return { statusCode, headers, body: Readable.from(chunks) };
}

async function extractHtml(
  html,
  options = {},
  contentType = "text/html; charset=utf-8",
  finalUrl = "https://article.example/story"
) {
  const bytes = Buffer.isBuffer(html) ? html : Buffer.from(html);
  return fetchAndExtractWebpage(finalUrl, options, {
    safeFetch: async () => fetchedResponse(bytes, contentType, { url: finalUrl })
  });
}

function fetchedResponse(bytes, contentType, overrides = {}) {
  return {
    url: "https://article.example/story",
    status: 200,
    ok: true,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : null) },
    bytes,
    byteLength: bytes.byteLength,
    truncated: false,
    ...overrides
  };
}

function malformedHtml(repetitions) {
  const starts = ["<a ", "<script ", "<style ", "<!--", "<meta ", "<img ", ' content: "'];
  return `<html><body>${starts.map((start) => start.repeat(repetitions)).join("")}</body></html>`;
}

async function measureExtraction(html) {
  const startedAt = performance.now();
  const result = await extractHtml(html, { maxTextChars: 1_000, maxImages: 1 });
  const elapsed = performance.now() - startedAt;
  assert.equal(result.images.length, 0);
  assert.equal(result.related_links.length, 0);
  return elapsed;
}
