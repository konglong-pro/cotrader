import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

export const MAX_FETCH_BYTES = 8_000_000;
export const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

const DEFAULT_MAX_REDIRECTS = 5;
const MAX_COMPRESSION_OVERHEAD_BYTES = 64_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_IPV4 = new BlockList();
const BLOCKED_IPV6 = new BlockList();

for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
]) {
  BLOCKED_IPV4.addSubnet(address, prefix, "ipv4");
}

for (const [address, prefix] of [
  ["::", 3],
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["4000::", 2],
  ["8000::", 1],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8]
]) {
  BLOCKED_IPV6.addSubnet(address, prefix, "ipv6");
}

export class SafeFetchError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "SafeFetchError";
    this.code = code;
  }
}

export async function safeFetchBuffer(url, options = {}, runtime = {}) {
  const maxBytes = normalizeLimit(options.maxBytes, MAX_FETCH_BYTES, MAX_FETCH_BYTES);
  const timeoutMs = normalizeLimit(
    options.timeoutMs,
    DEFAULT_FETCH_TIMEOUT_MS,
    DEFAULT_FETCH_TIMEOUT_MS
  );
  const maxRedirects = normalizeLimit(options.maxRedirects, DEFAULT_MAX_REDIRECTS, DEFAULT_MAX_REDIRECTS);
  const lookup = runtime.lookup ?? defaultLookup;
  const request = runtime.request ?? requestOnce;
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(runtime.signal.reason);
  if (runtime.signal?.aborted) abortFromCaller();
  else runtime.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("Fetch timed out."));
  }, timeoutMs);

  try {
    let current = normalizeTarget(url);
    for (let redirects = 0; ; redirects += 1) {
      throwIfAborted(controller.signal, timedOut);
      const addresses = await resolvePublicAddresses(current.hostname, lookup, controller.signal);
      const pinnedAddress = addresses.find(({ family }) => family === 4) ?? addresses[0];
      const response = await waitForAbort(
        request(current, {
          pinnedAddress,
          signal: controller.signal,
          headers: {
            "User-Agent": options.userAgent ?? "cotrader-web-extractor/0.1 (+https://local.cotrader; research extraction)",
            Accept: options.accept ?? "*/*",
            "Accept-Encoding": "gzip, deflate, br"
          }
        }),
        controller.signal
      );
      const headers = normalizeHeaders(response.headers);
      const location = headers.get("location");

      if (REDIRECT_STATUSES.has(response.statusCode) && location) {
        disposeBody(response.body);
        if (redirects >= maxRedirects) {
          throw new SafeFetchError("TOO_MANY_REDIRECTS", "The URL exceeded the redirect limit.");
        }
        try {
          current = normalizeTarget(new URL(location, current));
        } catch (error) {
          if (error instanceof SafeFetchError) throw error;
          throw new SafeFetchError("INVALID_REDIRECT", "The server returned an invalid redirect URL.", {
            cause: error
          });
        }
        continue;
      }

      const body = await readBody(response.body, headers.get("content-encoding"), maxBytes, controller.signal);
      return {
        url: current.toString(),
        status: response.statusCode,
        ok: response.statusCode >= 200 && response.statusCode < 300,
        headers,
        bytes: body.bytes,
        byteLength: body.bytes.byteLength,
        truncated: body.truncated
      };
    }
  } catch (error) {
    if (error instanceof SafeFetchError) throw error;
    if (controller.signal.aborted) {
      throw new SafeFetchError(
        timedOut ? "TIMEOUT" : "ABORTED",
        timedOut ? "The fetch exceeded its total timeout." : "The fetch was aborted.",
        { cause: error }
      );
    }
    throw new SafeFetchError("FETCH_FAILED", "The URL could not be fetched.", { cause: error });
  } finally {
    clearTimeout(timeout);
    runtime.signal?.removeEventListener("abort", abortFromCaller);
  }
}

function normalizeLimit(value, defaultValue, hardMaximum) {
  if (!Number.isSafeInteger(value) || value <= 0) return defaultValue;
  return Math.min(value, hardMaximum);
}

function normalizeTarget(value) {
  let parsed;
  try {
    parsed = value instanceof URL ? new URL(value) : new URL(value);
  } catch (error) {
    throw new SafeFetchError("INVALID_URL", "The URL must be absolute.", { cause: error });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SafeFetchError("INVALID_URL", "Only http and https URLs are supported.");
  }
  if (parsed.username || parsed.password) {
    throw new SafeFetchError("INVALID_URL", "URLs with credentials are not supported.");
  }
  parsed.hash = "";
  return parsed;
}

async function defaultLookup(hostname) {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

async function resolvePublicAddresses(rawHostname, lookup, signal) {
  const hostname = stripIpv6Brackets(rawHostname);
  const literalFamily = isIP(hostname);
  let addresses;
  try {
    addresses = literalFamily
      ? [{ address: hostname, family: literalFamily }]
      : await waitForAbort(lookup(hostname), signal);
  } catch (error) {
    if (error instanceof SafeFetchError || signal.aborted) throw error;
    throw new SafeFetchError("DNS_ERROR", "The URL hostname could not be resolved.", { cause: error });
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new SafeFetchError("DNS_ERROR", "The URL hostname did not resolve to an address.");
  }

  const normalized = addresses.map((entry) => {
    const address = typeof entry === "string" ? entry : entry?.address;
    const family = isIP(address);
    return { address, family };
  });
  if (normalized.some(({ address, family }) => !family || isBlockedAddress(address))) {
    throw new SafeFetchError("UNSAFE_ADDRESS", "The URL resolves to a non-public address.");
  }
  return normalized;
}

function isBlockedAddress(address) {
  const family = isIP(address);
  if (family === 4) return BLOCKED_IPV4.check(address, "ipv4");
  if (family === 6) return BLOCKED_IPV6.check(address, "ipv6");
  return true;
}

function stripIpv6Brackets(hostname) {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function requestOnce(target, { pinnedAddress, signal, headers }) {
  const transport = target.protocol === "https:" ? httpsRequest : httpRequest;
  const hostname = stripIpv6Brackets(target.hostname);
  return new Promise((resolve, reject) => {
    const request = transport(
      {
        protocol: target.protocol,
        hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        headers,
        signal,
        family: pinnedAddress.family,
        servername: isIP(hostname) ? undefined : hostname,
        lookup(_hostname, lookupOptions, callback) {
          if (typeof lookupOptions === "function") {
            callback = lookupOptions;
            lookupOptions = {};
          }
          if (lookupOptions?.all) callback(null, [pinnedAddress]);
          else callback(null, pinnedAddress.address, pinnedAddress.family);
        }
      },
      (response) => {
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: response
        });
      }
    );
    request.once("error", reject);
    request.end();
  });
}

function normalizeHeaders(rawHeaders = {}) {
  const values = new Map();
  for (const [name, value] of Object.entries(rawHeaders)) {
    if (value === undefined) continue;
    values.set(name.toLowerCase(), Array.isArray(value) ? value.join(", ") : String(value));
  }
  return {
    get(name) {
      return values.get(String(name).toLowerCase()) ?? null;
    },
    entries() {
      return values.entries();
    }
  };
}

async function readBody(body, rawEncoding, maxBytes, signal) {
  const source = body instanceof Readable ? body : Readable.from(body ?? []);
  const maxRawBytes = Math.min(MAX_FETCH_BYTES, maxBytes + MAX_COMPRESSION_OVERHEAD_BYTES);
  const decoded = decodeStream(source, rawEncoding, maxRawBytes);
  const iterator = decoded[Symbol.asyncIterator]();
  const chunks = [];
  let byteLength = 0;

  try {
    while (true) {
      const { value, done } = await waitForAbort(iterator.next(), signal);
      if (done) break;
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      const remaining = maxBytes - byteLength;
      if (chunk.byteLength > remaining) {
        if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
        byteLength = maxBytes;
        disposeBody(decoded);
        if (decoded !== source) disposeBody(source);
        return { bytes: Buffer.concat(chunks, byteLength), truncated: true };
      }
      chunks.push(chunk);
      byteLength += chunk.byteLength;
    }
  } catch (error) {
    disposeBody(decoded);
    if (decoded !== source) disposeBody(source);
    throw error;
  }

  return { bytes: Buffer.concat(chunks, byteLength), truncated: false };
}

function decodeStream(source, rawEncoding, maxRawBytes) {
  const encoding = (rawEncoding || "identity").trim().toLowerCase();
  if (!encoding || encoding === "identity") return source;
  let decoder;
  if (encoding === "gzip" || encoding === "x-gzip") decoder = createGunzip();
  else if (encoding === "deflate") decoder = createInflate();
  else if (encoding === "br") decoder = createBrotliDecompress();
  else {
    disposeBody(source);
    throw new SafeFetchError("UNSUPPORTED_ENCODING", `Unsupported content encoding: ${encoding}`);
  }

  let rawBytes = 0;
  const onRawData = (chunk) => {
    rawBytes += chunk.byteLength;
    if (rawBytes <= maxRawBytes) return;
    source.destroy(
      new SafeFetchError("BODY_TOO_LARGE", "The encoded response body exceeded the byte limit.")
    );
  };
  source.on("data", onRawData);
  source.once("error", (error) => decoder.destroy(error));
  decoder.once("close", () => source.off("data", onRawData));
  return source.pipe(decoder);
}

function disposeBody(body) {
  if (typeof body?.destroy === "function") body.destroy();
}

function throwIfAborted(signal, timedOut) {
  if (!signal.aborted) return;
  throw new SafeFetchError(
    timedOut ? "TIMEOUT" : "ABORTED",
    timedOut ? "The fetch exceeded its total timeout." : "The fetch was aborted."
  );
}

function waitForAbort(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Aborted"));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, signal.reason ?? new Error("Aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error)
    );
  });
}
