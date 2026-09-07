import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer as createNodeServer } from "node:http";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  InputValidationError,
  normalizeExtractionRequest
} from "../lib/extraction_request.mjs";
import { createActionServer, loadActionConfig } from "../actions/http_action_server.mjs";
import { createMcpServer } from "../mcp/fetch_and_extract_webpage_server.mjs";

const ACTION_SERVER_PATH = fileURLToPath(new URL("../actions/http_action_server.mjs", import.meta.url));
const MCP_SERVER_PATH = fileURLToPath(new URL("../mcp/fetch_and_extract_webpage_server.mjs", import.meta.url));

function initializeParams() {
  return {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "adapter-test", version: "1" }
  };
}

async function reservePort() {
  const server = createNodeServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return port;
}

async function startActionServer(options) {
  const server = createActionServer({ allowUnauthenticated: true, ...options });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function closeServer(server) {
  if (!server.listening) return;
  server.close();
  await once(server, "close");
}

function waitForText(stream, expected) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${expected}; saw ${output}`)), 3_000);
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      output += chunk;
      if (output.includes(expected)) {
        clearTimeout(timeout);
        resolve(output);
      }
    });
    stream.on("error", reject);
  });
}

async function stopChild(child) {
  if (child.exitCode === null && child.signalCode === null) child.kill();
  if (child.exitCode === null && child.signalCode === null) await once(child, "exit");
}

function startMcpProcess(env = {}) {
  const child = spawn(process.execPath, [MCP_SERVER_PATH], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"]
  });
  const messages = [];
  const waiters = [];
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        const message = JSON.parse(line);
        const waiter = waiters.shift();
        if (waiter) waiter.resolve(message);
        else messages.push(message);
      }
      newline = buffer.indexOf("\n");
    }
  });

  return {
    child,
    sendRaw(line) {
      child.stdin.write(`${line}\n`);
    },
    send(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
    nextMessage(timeoutMs = 2_000) {
      if (messages.length > 0) return Promise.resolve(messages.shift());
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject };
        waiters.push(waiter);
        waiter.timeout = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error("Timed out waiting for MCP response."));
        }, timeoutMs);
        waiter.resolve = (value) => {
          clearTimeout(waiter.timeout);
          resolve(value);
        };
      });
    }
  };
}

async function initializeMcp(client) {
  client.send({
    jsonrpc: "2.0",
    id: "initialize",
    method: "initialize",
    params: initializeParams()
  });
  const response = await client.nextMessage();
  assert.equal(response.id, "initialize");
  assert.ok(response.result);
  client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
}

function startMcpHarness(options = {}) {
  const input = new PassThrough();
  const output = options.output ?? new PassThrough();
  const session = createMcpServer({ ...options, input, output }).start();
  const messages = [];
  const waiters = [];
  let buffer = "";
  output.setEncoding("utf8");
  output.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        const message = JSON.parse(line);
        const waiter = waiters.shift();
        if (waiter) waiter.resolve(message);
        else messages.push(message);
      }
      newline = buffer.indexOf("\n");
    }
  });

  return {
    input,
    output,
    session,
    send(message) {
      input.write(`${JSON.stringify(message)}\n`);
    },
    nextMessage(timeoutMs = 2_000) {
      if (messages.length > 0) return Promise.resolve(messages.shift());
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject };
        waiters.push(waiter);
        waiter.timeout = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error("Timed out waiting for MCP response."));
        }, timeoutMs);
        waiter.resolve = (value) => {
          clearTimeout(waiter.timeout);
          resolve(value);
        };
      });
    }
  };
}

class ControlledOutput extends EventEmitter {
  constructor() {
    super();
    this.blocked = false;
    this.lines = [];
  }

  write(line) {
    this.lines.push(line);
    this.emit("write");
    return !this.blocked;
  }
}

function waitForWriteCount(output, count) {
  if (output.lines.length >= count) return Promise.resolve();
  return new Promise((resolve) => {
    const onWrite = () => {
      if (output.lines.length < count) return;
      output.off("write", onWrite);
      resolve();
    };
    output.on("write", onWrite);
  });
}

function waitForExit(child, timeoutMs = 2_000) {
  return Promise.race([
    once(child, "exit"),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timed out waiting for child process to exit.")), timeoutMs)
    )
  ]);
}

test("normalizeExtractionRequest applies the public request defaults", () => {
  assert.deepEqual(normalizeExtractionRequest({ url: "https://example.com/article" }), {
    url: "https://example.com/article",
    ocrImages: false,
    maxTextChars: 30_000,
    maxImages: 30
  });
});

test("normalizeExtractionRequest rejects non-object and unknown public fields", () => {
  for (const input of [null, [], "https://example.com", { url: "https://example.com", timeoutMs: 1 }]) {
    assert.throws(() => normalizeExtractionRequest(input), InputValidationError);
  }
});

test("normalizeExtractionRequest accepts only bounded credential-free HTTP(S) URLs", () => {
  const invalidUrls = [
    undefined,
    42,
    "ftp://example.com/file",
    "http:example.com",
    "https://user:secret@example.com/private",
    "not a url",
    `https://example.com/${"a".repeat(2_100)}`,
    `https://example.com/${"界".repeat(700)}`
  ];

  for (const url of invalidUrls) {
    assert.throws(() => normalizeExtractionRequest({ url }), InputValidationError);
  }

  assert.equal(
    normalizeExtractionRequest({ url: "http://example.com/path?q=1#ignored" }).url,
    "http://example.com/path?q=1"
  );
});

test("normalizeExtractionRequest enforces boolean and finite integer schema ranges", () => {
  const base = { url: "https://example.com" };
  const invalidOptions = [
    { ocrImages: "false" },
    { maxTextChars: "30000" },
    { maxTextChars: 999 },
    { maxTextChars: 100_001 },
    { maxTextChars: 1_000.5 },
    { maxTextChars: Number.POSITIVE_INFINITY },
    { maxImages: -1 },
    { maxImages: 101 },
    { maxImages: Number.NaN }
  ];

  for (const options of invalidOptions) {
    assert.throws(() => normalizeExtractionRequest({ ...base, ...options }), InputValidationError);
  }

  assert.deepEqual(
    normalizeExtractionRequest({ ...base, ocrImages: true, maxTextChars: 1_000, maxImages: 0 }),
    { url: "https://example.com/", ocrImages: true, maxTextChars: 1_000, maxImages: 0 }
  );
});

test("HTTP Action rejects a non-JSON request before extraction", async () => {
  const port = await reservePort();
  const child = spawn(process.execPath, [ACTION_SERVER_PATH], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      COTRADER_ACTION_TOKEN: "",
      COTRADER_ALLOW_UNAUTHENTICATED_LOCAL: "true"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForText(child.stderr, "listening");
    const response = await fetch(`http://127.0.0.1:${port}/fetch_and_extract_webpage`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "not-json"
    });
    assert.equal(response.status, 415);
    assert.deepEqual(await response.json(), {
      error: { code: "unsupported_media_type", message: "Content-Type must be application/json." }
    });
  } finally {
    await stopChild(child);
  }
});

test("HTTP Action returns stable 400 errors for malformed JSON and invalid request objects", async () => {
  const port = await reservePort();
  const child = spawn(process.execPath, [ACTION_SERVER_PATH], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      COTRADER_ACTION_TOKEN: "",
      COTRADER_ALLOW_UNAUTHENTICATED_LOCAL: "true"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForText(child.stderr, "listening");
    const malformed = await fetch(`http://127.0.0.1:${port}/fetch_and_extract_webpage`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: "{"
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), {
      error: { code: "invalid_json", message: "Request body must contain valid JSON." }
    });

    const invalidObject = await fetch(`http://127.0.0.1:${port}/fetch_and_extract_webpage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([])
    });
    assert.equal(invalidObject.status, 400);
    assert.deepEqual(await invalidObject.json(), {
      error: { code: "invalid_request", message: "Request body must be a JSON object." }
    });
  } finally {
    await stopChild(child);
  }
});

test("HTTP Action returns 413 without dropping an oversized request connection", async () => {
  const port = await reservePort();
  const child = spawn(process.execPath, [ACTION_SERVER_PATH], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      COTRADER_ACTION_TOKEN: "",
      COTRADER_ALLOW_UNAUTHENTICATED_LOCAL: "true"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForText(child.stderr, "listening");
    const response = await fetch(`http://127.0.0.1:${port}/fetch_and_extract_webpage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", padding: "x".repeat(1_000_000) })
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), {
      error: { code: "payload_too_large", message: "Request body exceeds 1000000 bytes." }
    });
  } finally {
    await stopChild(child);
  }
});

test("HTTP Action refuses a non-loopback bind without a bearer token", async () => {
  const port = await reservePort();
  const child = spawn(process.execPath, [ACTION_SERVER_PATH], {
    env: {
      ...process.env,
      HOST: "0.0.0.0",
      PORT: String(port),
      COTRADER_ACTION_TOKEN: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  try {
    const [code] = await waitForExit(child, 1_000);
    assert.equal(code, 1);
    assert.match(stderr, /COTRADER_ACTION_TOKEN is required unless/u);
  } finally {
    await stopChild(child);
  }
});

test("HTTP Action requires authentication by default even on loopback", () => {
  assert.throws(
    () => loadActionConfig({ HOST: "127.0.0.1" }),
    /COTRADER_ACTION_TOKEN is required unless/u
  );

  const localDevelopment = loadActionConfig({
    HOST: "127.0.0.1",
    COTRADER_ALLOW_UNAUTHENTICATED_LOCAL: "true"
  });
  assert.equal(localDevelopment.allowUnauthenticated, true);
  assert.equal(localDevelopment.maxRequestsPerMinute, 60);

  assert.throws(
    () =>
      loadActionConfig({
        HOST: "0.0.0.0",
        COTRADER_ACTION_TOKEN: "test-secret",
        COTRADER_ALLOW_UNAUTHENTICATED_LOCAL: "true"
      }),
    /valid only for a loopback HOST/u
  );
});

test("HTTP Action programmatic server denies anonymous requests unless explicitly allowed", async () => {
  const server = createActionServer({ extractor: async () => ({ ok: true }) });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/fetch_and_extract_webpage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" })
    });
    assert.equal(response.status, 401);
  } finally {
    await closeServer(server);
  }
});

test("HTTP Action disables OCR by default unless explicitly enabled", () => {
  const baseEnv = {
    HOST: "0.0.0.0",
    PORT: "8787",
    COTRADER_ACTION_TOKEN: "test-secret"
  };
  assert.equal(loadActionConfig(baseEnv).allowOcr, false);
  assert.equal(
    loadActionConfig({
      HOST: "127.0.0.1",
      COTRADER_ACTION_TOKEN: "test-secret"
    }).allowOcr,
    false
  );
  assert.equal(loadActionConfig({ ...baseEnv, COTRADER_ENABLE_OCR: "true" }).allowOcr, true);
  assert.throws(
    () => loadActionConfig({ ...baseEnv, COTRADER_ENABLE_OCR: "yes" }),
    /COTRADER_ENABLE_OCR must be true or false/u
  );
});

test("HTTP Action rejects OCR when deployment policy disables it", async () => {
  const { server, baseUrl } = await startActionServer({
    allowOcr: false,
    extractor: async () => {
      throw new Error("extractor must not run");
    }
  });
  try {
    const response = await fetch(`${baseUrl}/fetch_and_extract_webpage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", ocrImages: true })
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: { code: "ocr_disabled", message: "Image OCR is disabled for this deployment." }
    });
  } finally {
    await closeServer(server);
  }
});

test("HTTP Action enforces Authorization Bearer when a token is configured", async () => {
  const port = await reservePort();
  const child = spawn(process.execPath, [ACTION_SERVER_PATH], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      COTRADER_ACTION_TOKEN: "test-secret"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForText(child.stderr, "listening");
    for (const authorization of [undefined, "Bearer wrong-secret", "Basic dGVzdA=="]) {
      const headers = { "content-type": "application/json" };
      if (authorization) headers.authorization = authorization;
      const response = await fetch(`http://127.0.0.1:${port}/fetch_and_extract_webpage`, {
        method: "POST",
        headers,
        body: "{}"
      });
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("www-authenticate"), "Bearer");
      assert.deepEqual(await response.json(), {
        error: { code: "unauthorized", message: "A valid bearer token is required." }
      });
    }
  } finally {
    await stopChild(child);
  }
});

test("HTTP Action accepts the configured bearer token and passes only normalized options", async () => {
  let observed;
  const extractor = async (url, request, runtime) => {
    observed = { url, request, signal: runtime.signal };
    return { ok: true };
  };
  const { server, baseUrl } = await startActionServer({ extractor, token: "test-secret" });
  try {
    const response = await fetch(`${baseUrl}/fetch_and_extract_webpage`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json"
      },
      body: JSON.stringify({ url: "https://example.com", maxImages: 0 })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(observed.request, {
      url: "https://example.com/",
      ocrImages: false,
      maxTextChars: 30_000,
      maxImages: 0
    });
    assert.equal(observed.url, "https://example.com/");
    assert.ok(observed.signal instanceof AbortSignal);
  } finally {
    await closeServer(server);
  }
});

test("HTTP Action emits CORS headers only for explicitly allowed origins", async () => {
  const port = await reservePort();
  const child = spawn(process.execPath, [ACTION_SERVER_PATH], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      COTRADER_ACTION_TOKEN: "",
      COTRADER_ALLOW_UNAUTHENTICATED_LOCAL: "true",
      COTRADER_ALLOWED_ORIGINS: "https://app.example, https://research.example"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForText(child.stderr, "listening");
    const allowed = await fetch(`http://127.0.0.1:${port}/fetch_and_extract_webpage`, {
      method: "OPTIONS",
      headers: { origin: "https://app.example" }
    });
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://app.example");
    assert.equal(allowed.headers.get("vary"), "Origin");

    const rejected = await fetch(`http://127.0.0.1:${port}/fetch_and_extract_webpage`, {
      method: "OPTIONS",
      headers: { origin: "https://evil.example" }
    });
    assert.equal(rejected.status, 204);
    assert.equal(rejected.headers.get("access-control-allow-origin"), null);
  } finally {
    await stopChild(child);
  }
});

test("HTTP Action applies a process-wide fixed-window request quota", async () => {
  const { server, baseUrl } = await startActionServer({
    maxRequestsPerMinute: 2,
    extractor: async () => ({ ok: true })
  });
  const request = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com" })
  };

  try {
    assert.equal((await fetch(`${baseUrl}/fetch_and_extract_webpage`, request)).status, 200);
    assert.equal((await fetch(`${baseUrl}/fetch_and_extract_webpage`, request)).status, 200);
    const limited = await fetch(`${baseUrl}/fetch_and_extract_webpage`, request);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);
    assert.deepEqual(await limited.json(), {
      error: {
        code: "too_many_requests",
        message: "The extraction request rate limit has been reached."
      }
    });
  } finally {
    await closeServer(server);
  }
});

test("HTTP Action bounds concurrent extractions with a stable 429 response", async () => {
  let releaseFirst;
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const extractor = async () => {
    markStarted();
    return new Promise((resolve) => {
      releaseFirst = resolve;
    });
  };
  const { server, baseUrl } = await startActionServer({ extractor, maxConcurrent: 1 });
  const request = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com" })
  };

  try {
    const firstResponsePromise = fetch(`${baseUrl}/fetch_and_extract_webpage`, request);
    await started;
    const secondResponse = await fetch(`${baseUrl}/fetch_and_extract_webpage`, request);
    assert.equal(secondResponse.status, 429);
    assert.equal(secondResponse.headers.get("retry-after"), "1");
    assert.deepEqual(await secondResponse.json(), {
      error: {
        code: "too_many_requests",
        message: "The extraction concurrency limit has been reached."
      }
    });

    releaseFirst({ ok: true });
    const firstResponse = await firstResponsePromise;
    assert.equal(firstResponse.status, 200);
  } finally {
    releaseFirst?.({ ok: true });
    await closeServer(server);
  }
});

test("HTTP Action maps extraction failures to non-leaking 502 and 504 errors", async (t) => {
  const cases = [
    {
      name: "upstream failure",
      error: new Error("secret upstream URL and stack details"),
      status: 502,
      body: {
        error: { code: "extraction_failed", message: "The webpage could not be extracted." }
      }
    },
    {
      name: "upstream timeout",
      error: Object.assign(new Error("secret timeout details"), { name: "AbortError" }),
      status: 504,
      body: {
        error: { code: "upstream_timeout", message: "The upstream request timed out." }
      }
    },
    {
      name: "core safe-fetch timeout code",
      error: Object.assign(new Error("secret safe-fetch details"), { code: "TIMEOUT" }),
      status: 504,
      body: {
        error: { code: "upstream_timeout", message: "The upstream request timed out." }
      }
    },
    {
      name: "unsafe target",
      error: Object.assign(new Error("private target details"), { code: "UNSAFE_ADDRESS" }),
      status: 400,
      body: {
        error: { code: "unsafe_target", message: "The requested URL is not an allowed public target." }
      }
    }
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const { server, baseUrl } = await startActionServer({
        extractor: async () => {
          throw scenario.error;
        }
      });
      try {
        const response = await fetch(`${baseUrl}/fetch_and_extract_webpage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: "https://example.com" })
        });
        assert.equal(response.status, scenario.status);
        assert.deepEqual(await response.json(), scenario.body);
      } finally {
        await closeServer(server);
      }
    });
  }
});

test("HTTP Action enforces a total extraction timeout even if an extractor ignores abort", async () => {
  const { server, baseUrl } = await startActionServer({
    extractionTimeoutMs: 20,
    extractor: async () => new Promise(() => {})
  });
  try {
    const response = await fetch(`${baseUrl}/fetch_and_extract_webpage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" })
    });
    assert.equal(response.status, 504);
    assert.deepEqual(await response.json(), {
      error: { code: "upstream_timeout", message: "The upstream request timed out." }
    });
  } finally {
    await closeServer(server);
  }
});

test("HTTP Action detects deadline overrun when synchronous work delays the timer", async () => {
  const { server, baseUrl } = await startActionServer({
    extractionTimeoutMs: 5,
    extractor: async () => {
      const end = Date.now() + 30;
      while (Date.now() < end) {
        // Deliberately occupy the event loop to verify the explicit deadline check.
      }
      return { tooLate: true };
    }
  });
  try {
    const response = await fetch(`${baseUrl}/fetch_and_extract_webpage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" })
    });
    assert.equal(response.status, 504);
    assert.deepEqual(await response.json(), {
      error: { code: "upstream_timeout", message: "The upstream request timed out." }
    });
  } finally {
    await closeServer(server);
  }
});

test("MCP enforces initialize then initialized before exposing tools", async () => {
  const client = startMcpProcess();
  try {
    client.send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    assert.deepEqual(await client.nextMessage(), {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32002, message: "Server not initialized." }
    });

    client.send({
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: initializeParams()
    });
    const initialized = await client.nextMessage();
    assert.equal(initialized.id, 2);
    assert.equal(initialized.result.protocolVersion, "2025-06-18");

    client.send({ jsonrpc: "2.0", id: 3, method: "ping" });
    assert.deepEqual(await client.nextMessage(), { jsonrpc: "2.0", id: 3, result: {} });

    client.send({ jsonrpc: "2.0", id: 4, method: "tools/list" });
    assert.equal((await client.nextMessage()).error.code, -32002);

    client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    client.send({ jsonrpc: "2.0", id: 5, method: "tools/list" });
    const tools = await client.nextMessage();
    assert.equal(tools.id, 5);
    assert.equal(tools.result.tools[0].name, "fetch_and_extract_webpage");
    assert.equal(tools.result.tools[0].inputSchema.additionalProperties, false);
    assert.equal(
      tools.result.tools[0].inputSchema.properties.url.pattern,
      "^[Hh][Tt][Tt][Pp][Ss]?://"
    );
    assert.deepEqual(tools.result.tools[0].outputSchema, {
      type: "object",
      additionalProperties: true
    });
  } finally {
    await stopChild(client.child);
  }
});

test("MCP returns stable JSON-RPC errors for malformed and invalid envelopes", async () => {
  const client = startMcpProcess();
  try {
    client.sendRaw('{"jsonrpc":');
    assert.deepEqual(await client.nextMessage(), {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error." }
    });

    client.send([]);
    assert.deepEqual(await client.nextMessage(), {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid Request." }
    });

    client.send({ jsonrpc: "2.0", id: {}, method: "ping" });
    assert.deepEqual(await client.nextMessage(), {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid Request." }
    });

    client.send({ jsonrpc: "2.0", id: 9, method: "ping", extra: true });
    assert.deepEqual(await client.nextMessage(), {
      jsonrpc: "2.0",
      id: 9,
      error: { code: -32600, message: "Invalid Request." }
    });

    for (const id of [null, 1.5]) {
      client.send({ jsonrpc: "2.0", id, method: "ping" });
      assert.deepEqual(await client.nextMessage(), {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid Request." }
      });
    }

    client.send({ jsonrpc: "2.0", id: 10, method: "initialize", params: {} });
    assert.equal((await client.nextMessage()).error.code, -32602);
  } finally {
    await stopChild(client.child);
  }
});

test("MCP rejects oversized input frames and resumes at the next newline", async () => {
  const client = startMcpProcess({ COTRADER_MCP_MAX_FRAME_BYTES: "256" });
  try {
    client.sendRaw("x".repeat(257));
    assert.deepEqual(await client.nextMessage(), {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Request frame exceeds 256 bytes." }
    });

    client.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initializeParams()
    });
    const response = await client.nextMessage();
    assert.equal(response.id, 1);
    assert.equal(response.result.serverInfo.name, "cotrader-web-extractor");
  } finally {
    await stopChild(client.child);
  }
});

test("MCP validates tool arguments against the shared public request contract", async () => {
  const client = startMcpProcess();
  try {
    await initializeMcp(client);
    for (const argumentsValue of [
      { url: "https://example.com", timeoutMs: 1 },
      { url: "https://example.com", ocrImages: "false" },
      { url: "https://user:secret@example.com" }
    ]) {
      client.send({
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name: "fetch_and_extract_webpage", arguments: argumentsValue }
      });
      assert.deepEqual(await client.nextMessage(), {
        jsonrpc: "2.0",
        id: 10,
        error: { code: -32602, message: "Invalid tool arguments." }
      });
    }
  } finally {
    await stopChild(client.child);
  }
});

test("MCP bounds tool concurrency and cancellation aborts the matching runtime signal", async () => {
  let observedSignal;
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const extractor = async (_url, _request, runtime) => {
    observedSignal = runtime.signal;
    markStarted();
    return new Promise((resolve, reject) => {
      runtime.signal.addEventListener(
        "abort",
        () => reject(Object.assign(new Error("cancelled details"), { name: "AbortError" })),
        { once: true }
      );
    });
  };
  const client = startMcpHarness({ extractor, maxConcurrent: 1 });

  try {
    await initializeMcp(client);
    client.send({
      jsonrpc: "2.0",
      id: "first",
      method: "tools/call",
      params: {
        name: "fetch_and_extract_webpage",
        arguments: { url: "https://example.com" }
      }
    });
    await started;

    client.send({
      jsonrpc: "2.0",
      id: "second",
      method: "tools/call",
      params: {
        name: "fetch_and_extract_webpage",
        arguments: { url: "https://example.com/second" }
      }
    });
    assert.deepEqual(await client.nextMessage(), {
      jsonrpc: "2.0",
      id: "second",
      error: { code: -32001, message: "Too many concurrent tool calls." }
    });

    client.send({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: "first", reason: "test cancellation" }
    });
    client.send({ jsonrpc: "2.0", id: "after-cancel", method: "ping" });
    assert.deepEqual(await client.nextMessage(), {
      jsonrpc: "2.0",
      id: "after-cancel",
      result: {}
    });
    assert.equal(observedSignal.aborted, true);
    await assert.rejects(client.nextMessage(50), /Timed out waiting for MCP response/u);
  } finally {
    await client.session.stop();
  }
});

test("MCP enforces a total tool-call timeout even when an extractor ignores abort", async () => {
  let observedSignal;
  const client = startMcpHarness({
    maxCallTimeoutMs: 20,
    extractor: async (_url, _request, runtime) => {
      observedSignal = runtime.signal;
      return new Promise(() => {});
    }
  });

  try {
    await initializeMcp(client);
    client.send({
      jsonrpc: "2.0",
      id: "timeout",
      method: "tools/call",
      params: {
        name: "fetch_and_extract_webpage",
        arguments: { url: "https://example.com" }
      }
    });
    assert.deepEqual(await client.nextMessage(), {
      jsonrpc: "2.0",
      id: "timeout",
      error: { code: -32003, message: "Tool call timed out." }
    });
    assert.equal(observedSignal.aborted, true);
  } finally {
    await client.session.stop();
  }
});

test("MCP detects deadline overrun when synchronous work delays the timer", async () => {
  const client = startMcpHarness({
    maxCallTimeoutMs: 5,
    extractor: async () => {
      const end = Date.now() + 30;
      while (Date.now() < end) {
        // Deliberately occupy the event loop to verify the explicit deadline check.
      }
      return { tooLate: true };
    }
  });

  try {
    await initializeMcp(client);
    client.send({
      jsonrpc: "2.0",
      id: "sync-timeout",
      method: "tools/call",
      params: {
        name: "fetch_and_extract_webpage",
        arguments: { url: "https://example.com" }
      }
    });
    assert.deepEqual(await client.nextMessage(), {
      jsonrpc: "2.0",
      id: "sync-timeout",
      error: { code: -32003, message: "Tool call timed out." }
    });
  } finally {
    await client.session.stop();
  }
});

test("MCP aborts active calls without replying when stdin closes", async () => {
  let observedSignal;
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const client = startMcpHarness({
    extractor: async (_url, _request, runtime) => {
      observedSignal = runtime.signal;
      markStarted();
      return new Promise((resolve, reject) => {
        runtime.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }
  });

  await initializeMcp(client);
  client.send({
    jsonrpc: "2.0",
    id: "shutdown",
    method: "tools/call",
    params: {
      name: "fetch_and_extract_webpage",
      arguments: { url: "https://example.com" }
    }
  });
  await started;
  client.input.end();
  await client.session.done;
  assert.equal(observedSignal.aborted, true);
  await assert.rejects(client.nextMessage(50), /Timed out waiting for MCP response/u);
});

test("MCP serializes stdout writes and waits for drain after backpressure", async () => {
  const input = new PassThrough();
  const output = new ControlledOutput();
  const session = createMcpServer({ input, output }).start();

  try {
    input.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: initializeParams()
      })}\n`
    );
    await waitForWriteCount(output, 1);
    input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

    output.blocked = true;
    input.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" })}\n` +
        `${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping" })}\n`
    );
    await waitForWriteCount(output, 2);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(output.lines.length, 2);

    output.blocked = false;
    output.emit("drain");
    await waitForWriteCount(output, 3);
    assert.deepEqual(
      output.lines.slice(1).map((line) => JSON.parse(line).id),
      [2, 3]
    );
  } finally {
    output.blocked = false;
    output.emit("drain");
    input.end();
    await session.done;
  }
});

test("MCP bounds pending ping tasks and stdout writes while applying input backpressure", async () => {
  const input = new PassThrough();
  const output = new ControlledOutput();
  const session = createMcpServer({
    input,
    output,
    maxPendingTasks: 4,
    maxPendingWrites: 4
  }).start();

  try {
    input.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: initializeParams()
      })}\n`
    );
    await waitForWriteCount(output, 1);
    input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

    output.blocked = true;
    input.write(
      Array.from({ length: 40 }, (_, index) =>
        `${JSON.stringify({ jsonrpc: "2.0", id: 100 + index, method: "ping" })}\n`
      ).join("")
    );
    await waitForWriteCount(output, 2);
    await new Promise((resolve) => setImmediate(resolve));

    const blockedStats = session.getStats();
    assert.equal(blockedStats.pendingTasks, 4);
    assert.equal(blockedStats.pendingWrites, 4);
    assert.equal(blockedStats.inputPaused, true);
    assert.ok(blockedStats.bufferedInputBytes > 0);
    assert.equal(blockedStats.maxObservedPendingTasks, 4);
    assert.equal(blockedStats.maxObservedPendingWrites, 4);

    output.blocked = false;
    output.emit("drain");
    await waitForWriteCount(output, 41);
    assert.deepEqual(
      output.lines.slice(1).map((line) => JSON.parse(line).id),
      Array.from({ length: 40 }, (_, index) => 100 + index)
    );

    await new Promise((resolve) => setImmediate(resolve));
    const drainedStats = session.getStats();
    assert.equal(drainedStats.pendingTasks, 0);
    assert.equal(drainedStats.pendingWrites, 0);
    assert.equal(drainedStats.inputPaused, false);
  } finally {
    output.blocked = false;
    output.emit("drain");
    input.end();
    await session.done;
  }
});

test("MCP bounds invalid-frame error tasks and recovers after stdout drains", async () => {
  const input = new PassThrough();
  const output = new ControlledOutput();
  const session = createMcpServer({
    input,
    output,
    maxPendingTasks: 4,
    maxPendingWrites: 4
  }).start();

  try {
    output.blocked = true;
    input.write(Array.from({ length: 40 }, () => "not-json\n").join(""));
    await waitForWriteCount(output, 1);
    await new Promise((resolve) => setImmediate(resolve));

    const blockedStats = session.getStats();
    assert.equal(blockedStats.pendingTasks, 4);
    assert.equal(blockedStats.pendingWrites, 4);
    assert.equal(blockedStats.inputPaused, true);
    assert.equal(blockedStats.maxObservedPendingTasks, 4);
    assert.equal(blockedStats.maxObservedPendingWrites, 4);

    output.blocked = false;
    output.emit("drain");
    await waitForWriteCount(output, 40);
    for (const line of output.lines) {
      assert.deepEqual(JSON.parse(line), {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error." }
      });
    }

    input.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: "after-flood",
        method: "initialize",
        params: initializeParams()
      })}\n`
    );
    await waitForWriteCount(output, 41);
    assert.equal(JSON.parse(output.lines[40]).id, "after-flood");
  } finally {
    output.blocked = false;
    output.emit("drain");
    input.end();
    await session.done;
  }
});

test("MCP enforces hard pending-task and pending-write configuration limits", async () => {
  for (const options of [
    { maxPendingTasks: 1_025 },
    { maxPendingWrites: 1_025 },
    { maxPendingTasks: 5, maxPendingWrites: 4 }
  ]) {
    assert.throws(
      () =>
        createMcpServer({
          input: new PassThrough(),
          output: new PassThrough(),
          ...options
        }),
      TypeError
    );
  }

  const client = startMcpProcess({ COTRADER_MCP_MAX_PENDING_TASKS: "1025" });
  let stderr = "";
  client.child.stderr.setEncoding("utf8");
  client.child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  try {
    const [code] = await waitForExit(client.child);
    assert.equal(code, 1);
    assert.match(stderr, /COTRADER_MCP_MAX_PENDING_TASKS must be an integer from 1 through 1024/u);
  } finally {
    await stopChild(client.child);
  }
});

test("OpenAPI documents bearer authentication and every stable HTTP error", async () => {
  const spec = JSON.parse(
    await readFile(fileURLToPath(new URL("../actions/openapi.json", import.meta.url)), "utf8")
  );
  const operation = spec.paths["/fetch_and_extract_webpage"].post;
  assert.deepEqual(spec.components.securitySchemes.bearerAuth, {
    type: "http",
    scheme: "bearer"
  });
  assert.deepEqual(operation.security, [{ bearerAuth: [] }]);

  const requestSchema = operation.requestBody.content["application/json"].schema;
  assert.equal(requestSchema.additionalProperties, false);
  assert.equal(requestSchema.properties.url.maxLength, 2_048);
  assert.equal(requestSchema.properties.url.pattern, "^[Hh][Tt][Tt][Pp][Ss]?://");

  for (const status of ["400", "401", "413", "415", "429", "502", "504"]) {
    assert.equal(
      operation.responses[status].content["application/json"].schema.$ref,
      "#/components/schemas/ErrorResponse"
    );
  }
  assert.ok(operation.responses["401"].headers["WWW-Authenticate"]);
  assert.ok(operation.responses["429"].headers["Retry-After"]);
});
