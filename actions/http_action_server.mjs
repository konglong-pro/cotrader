#!/usr/bin/env node

import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { isIP } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { InputValidationError, normalizeExtractionRequest } from "../lib/extraction_request.mjs";
import { fetchAndExtractWebpage } from "../tools/fetch_and_extract_webpage.mjs";

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_MAX_BODY_BYTES = 1_000_000;
const DEFAULT_EXTRACTION_TIMEOUT_MS = 55_000;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const ACTIONS_DIR = dirname(fileURLToPath(import.meta.url));

class HttpError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export function loadActionConfig(env = process.env) {
  const host = env.HOST?.trim() || DEFAULT_HOST;
  const port = readBoundedInteger(env.PORT, "PORT", DEFAULT_PORT, 0, 65_535);
  const token = env.COTRADER_ACTION_TOKEN?.trim() || "";
  const allowUnauthenticatedLocal = readBoolean(
    env.COTRADER_ALLOW_UNAUTHENTICATED_LOCAL,
    "COTRADER_ALLOW_UNAUTHENTICATED_LOCAL",
    false
  );
  const maxConcurrent = readBoundedInteger(
    env.COTRADER_MAX_CONCURRENCY,
    "COTRADER_MAX_CONCURRENCY",
    DEFAULT_MAX_CONCURRENT,
    1,
    100
  );
  const extractionTimeoutMs = readBoundedInteger(
    env.COTRADER_ACTION_TIMEOUT_MS,
    "COTRADER_ACTION_TIMEOUT_MS",
    DEFAULT_EXTRACTION_TIMEOUT_MS,
    1_000,
    120_000
  );
  const maxRequestsPerMinute = readBoundedInteger(
    env.COTRADER_RATE_LIMIT_PER_MINUTE,
    "COTRADER_RATE_LIMIT_PER_MINUTE",
    DEFAULT_RATE_LIMIT_PER_MINUTE,
    1,
    10_000
  );
  const allowOcr = readBoolean(
    env.COTRADER_ENABLE_OCR,
    "COTRADER_ENABLE_OCR",
    false
  );
  const allowedOrigins = normalizeAllowedOrigins(env.COTRADER_ALLOWED_ORIGINS || "");

  if (allowUnauthenticatedLocal && !isLoopbackHost(host)) {
    throw new Error("COTRADER_ALLOW_UNAUTHENTICATED_LOCAL is valid only for a loopback HOST.");
  }
  const allowUnauthenticated = allowUnauthenticatedLocal && isLoopbackHost(host);
  if (!token && !allowUnauthenticated) {
    throw new Error(
      "COTRADER_ACTION_TOKEN is required unless " +
        "COTRADER_ALLOW_UNAUTHENTICATED_LOCAL=true on a loopback HOST."
    );
  }

  return {
    host,
    port,
    token,
    allowUnauthenticated,
    maxConcurrent,
    maxRequestsPerMinute,
    extractionTimeoutMs,
    allowOcr,
    allowedOrigins
  };
}

export function createActionServer({
  extractor = fetchAndExtractWebpage,
  token = "",
  allowUnauthenticated = false,
  allowedOrigins = [],
  maxConcurrent = DEFAULT_MAX_CONCURRENT,
  maxRequestsPerMinute = DEFAULT_RATE_LIMIT_PER_MINUTE,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  extractionTimeoutMs = DEFAULT_EXTRACTION_TIMEOUT_MS,
  allowOcr = false,
  openapiPath = join(ACTIONS_DIR, "openapi.json")
} = {}) {
  if (typeof extractor !== "function") throw new TypeError("extractor must be a function.");
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 100) {
    throw new TypeError("maxConcurrent must be an integer from 1 through 100.");
  }
  if (
    !Number.isInteger(maxRequestsPerMinute) ||
    maxRequestsPerMinute < 1 ||
    maxRequestsPerMinute > 10_000
  ) {
    throw new TypeError("maxRequestsPerMinute must be an integer from 1 through 10000.");
  }
  if (typeof allowUnauthenticated !== "boolean") {
    throw new TypeError("allowUnauthenticated must be a boolean.");
  }
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1) {
    throw new TypeError("maxBodyBytes must be a positive integer.");
  }
  if (
    !Number.isInteger(extractionTimeoutMs) ||
    extractionTimeoutMs < 1 ||
    extractionTimeoutMs > 120_000
  ) {
    throw new TypeError("extractionTimeoutMs must be an integer from 1 through 120000.");
  }

  const expectedToken = typeof token === "string" ? token : "";
  const originAllowlist = normalizeAllowedOrigins(allowedOrigins);
  const rateLimiter = createFixedWindowRateLimiter(maxRequestsPerMinute);
  let activeExtractions = 0;

  const server = createServer(async (req, res) => {
    applyCorsHeaders(req, res, originAllowlist);

    try {
      const path = new URL(req.url || "/", "http://action.local").pathname;

      if (req.method === "OPTIONS") {
        writeJson(res, 204, {});
        return;
      }

      if (req.method === "GET" && path === "/openapi.json") {
        const spec = await readFile(openapiPath, "utf8");
        write(res, 200, spec, "application/json");
        return;
      }

      if (req.method !== "POST" || path !== "/fetch_and_extract_webpage") {
        writeJson(res, 404, {
          error: { code: "not_found", message: "Route not found." },
          routes: ["GET /openapi.json", "POST /fetch_and_extract_webpage"]
        });
        return;
      }

      if (!hasValidBearerToken(req.headers.authorization, expectedToken, allowUnauthenticated)) {
        throw new HttpError(
          401,
          "unauthorized",
          "A valid bearer token is required.",
          { "www-authenticate": "Bearer" }
        );
      }
      const retryAfter = rateLimiter.consume();
      if (retryAfter !== null) {
        throw new HttpError(
          429,
          "too_many_requests",
          "The extraction request rate limit has been reached.",
          { "retry-after": String(retryAfter) }
        );
      }
      if (!isJsonContentType(req.headers["content-type"])) {
        throw new HttpError(
          415,
          "unsupported_media_type",
          "Content-Type must be application/json."
        );
      }

      const body = await readJsonBody(req, maxBodyBytes);
      const request = normalizeExtractionRequest(body);
      if (request.ocrImages && !allowOcr) {
        throw new HttpError(400, "ocr_disabled", "Image OCR is disabled for this deployment.");
      }
      if (activeExtractions >= maxConcurrent) {
        throw new HttpError(
          429,
          "too_many_requests",
          "The extraction concurrency limit has been reached.",
          { "retry-after": "1" }
        );
      }

      const controller = new AbortController();
      let timedOut = false;
      const deadline = Date.now() + extractionTimeoutMs;
      const abortForTimeout = () => {
        if (timedOut) return;
        timedOut = true;
        controller.abort(new DOMException("Extraction timed out.", "TimeoutError"));
      };
      const extractionTimeout = setTimeout(abortForTimeout, extractionTimeoutMs);
      const cancelOnDisconnect = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.once("close", cancelOnDisconnect);
      activeExtractions += 1;

      try {
        const result = await raceWithAbort(
          extractor(request.url, request, { signal: controller.signal }),
          controller.signal
        );
        if (Date.now() >= deadline) {
          abortForTimeout();
          throw controller.signal.reason;
        }
        writeJson(res, 200, result);
      } catch (error) {
        if (timedOut || isTimeoutError(error)) {
          throw new HttpError(504, "upstream_timeout", "The upstream request timed out.");
        }
        if (isUnsafeTargetError(error)) {
          throw new HttpError(400, "unsafe_target", "The requested URL is not an allowed public target.");
        }
        throw new HttpError(502, "extraction_failed", "The webpage could not be extracted.");
      } finally {
        clearTimeout(extractionTimeout);
        activeExtractions -= 1;
        res.off("close", cancelOnDisconnect);
      }
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      if (error instanceof HttpError) {
        writeJson(res, error.status, { error: { code: error.code, message: error.message } }, error.headers);
        return;
      }
      if (error instanceof InputValidationError) {
        writeJson(res, 400, { error: { code: "invalid_request", message: error.message } });
        return;
      }
      writeJson(res, 500, { error: { code: "internal_error", message: "Internal server error." } });
    }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  return server;
}

function readBoundedInteger(rawValue, name, defaultValue, minimum, maximum) {
  if (rawValue === undefined || rawValue === "") return defaultValue;
  const value = Number(rawValue);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function readBoolean(rawValue, name, defaultValue) {
  if (rawValue === undefined || rawValue === "") return defaultValue;
  if (rawValue === "true") return true;
  if (rawValue === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

function normalizeAllowedOrigins(value) {
  const candidates =
    typeof value === "string"
      ? value.split(",")
      : value && typeof value[Symbol.iterator] === "function"
        ? [...value]
        : [];
  const origins = new Set();

  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const text = candidate.trim();
    let url;
    try {
      url = new URL(text);
    } catch {
      throw new Error(`Invalid COTRADER_ALLOWED_ORIGINS entry: ${text}`);
    }
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      text !== url.origin
    ) {
      throw new Error(`Invalid COTRADER_ALLOWED_ORIGINS entry: ${text}`);
    }
    origins.add(url.origin);
  }
  return origins;
}

function isJsonContentType(value) {
  return typeof value === "string" && value.split(";", 1)[0].trim().toLowerCase() === "application/json";
}

function hasValidBearerToken(value, expectedToken, allowUnauthenticated) {
  if (!expectedToken) return allowUnauthenticated;
  if (typeof value !== "string") return false;
  const match = /^Bearer ([^\s]+)$/iu.exec(value);
  if (!match) return false;
  const actual = Buffer.from(match[1], "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function createFixedWindowRateLimiter(limit) {
  let windowStart = Date.now();
  let count = 0;

  return {
    consume(now = Date.now()) {
      if (now - windowStart >= RATE_LIMIT_WINDOW_MS || now < windowStart) {
        windowStart = now;
        count = 0;
      }
      if (count >= limit) {
        return Math.max(1, Math.ceil((windowStart + RATE_LIMIT_WINDOW_MS - now) / 1_000));
      }
      count += 1;
      return null;
    }
  };
}

function readJsonBody(req, maxBodyBytes) {
  return new Promise((resolvePromise, rejectPromise) => {
    let bytes = 0;
    let tooLarge = false;
    const chunks = [];

    const rejectTooLarge = () => {
      tooLarge = true;
      chunks.length = 0;
      rejectPromise(
        new HttpError(
          413,
          "payload_too_large",
          `Request body exceeds ${maxBodyBytes} bytes.`
        )
      );
    };

    const contentLength = Number(req.headers["content-length"]);
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      req.resume();
      rejectTooLarge();
      return;
    }

    req.on("data", (chunk) => {
      if (tooLarge) return;
      bytes += chunk.byteLength;
      if (bytes > maxBodyBytes) {
        rejectTooLarge();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) return;
      try {
        const bytesBuffer = Buffer.concat(chunks);
        if (bytesBuffer.length === 0) throw new SyntaxError("Empty JSON body.");
        const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytesBuffer);
        resolvePromise(JSON.parse(raw));
      } catch {
        rejectPromise(new HttpError(400, "invalid_json", "Request body must contain valid JSON."));
      }
    });
    req.on("error", rejectPromise);
  });
}

function isTimeoutError(error) {
  return (
    error?.name === "AbortError" ||
    error?.name === "TimeoutError" ||
    error?.code === "TIMEOUT" ||
    error?.code === "ETIMEDOUT" ||
    error?.code === "UND_ERR_CONNECT_TIMEOUT" ||
    error?.code === "UND_ERR_HEADERS_TIMEOUT" ||
    error?.code === "UND_ERR_BODY_TIMEOUT"
  );
}

function isUnsafeTargetError(error) {
  return error?.code === "INVALID_URL" || error?.code === "UNSAFE_ADDRESS";
}

function raceWithAbort(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () =>
      finish(rejectPromise, signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => finish(resolvePromise, value),
      (error) => finish(rejectPromise, error)
    );
  });
}

function writeJson(res, status, value, headers = {}) {
  if (status === 204) {
    res.writeHead(204, headers);
    res.end();
    return;
  }
  write(res, status, JSON.stringify(value, null, 2), "application/json", headers);
}

function write(res, status, body, contentType, headers = {}) {
  res.writeHead(status, {
    ...headers,
    "content-type": `${contentType}; charset=utf-8`,
    "x-content-type-options": "nosniff"
  });
  res.end(body);
}

function applyCorsHeaders(req, res, allowedOrigins) {
  res.setHeader("vary", "Origin");
  const origin = req.headers.origin;
  if (typeof origin !== "string" || !allowedOrigins.has(origin)) return;
  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,authorization");
}

function isLoopbackHost(host) {
  const normalized = host.toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.$/u, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  if (normalized.startsWith("::ffff:127.")) return true;
  return isIP(normalized) === 4 && normalized.startsWith("127.");
}

function runMain() {
  try {
    const config = loadActionConfig();
    const server = createActionServer(config);
    server.once("error", (error) => {
      console.error(`cotrader action server failed to start: ${error.message}`);
      process.exitCode = 1;
    });
    server.listen(config.port, config.host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : config.port;
      console.error(`cotrader action server listening at http://${config.host}:${port}`);
    });
  } catch (error) {
    console.error(`cotrader action server failed to start: ${error.message}`);
    process.exitCode = 1;
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entryUrl) runMain();
