#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { InputValidationError, normalizeExtractionRequest } from "../lib/extraction_request.mjs";
import { fetchAndExtractWebpage } from "../tools/fetch_and_extract_webpage.mjs";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "cotrader-web-extractor", version: "0.1.0" };
const DEFAULT_MAX_FRAME_BYTES = 1_000_000;
const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_MAX_CALL_TIMEOUT_MS = 55_000;
const DEFAULT_MAX_PENDING_TASKS = 64;
const DEFAULT_MAX_PENDING_WRITES = 64;
const MAX_PENDING_TASKS_HARD_LIMIT = 1_024;
const MAX_PENDING_WRITES_HARD_LIMIT = 1_024;

const TOOL = {
  name: "fetch_and_extract_webpage",
  title: "Fetch and Extract Webpage",
  description:
    "Fetch a user-provided webpage URL and return cleaned text, metadata, extracted images, stock mentions, field candidates, research workflow buckets, verification queue, and webpage excerpt snapshots for A-share research.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        format: "uri",
        maxLength: 2048,
        pattern: "^[Hh][Tt][Tt][Pp][Ss]?://",
        description: "Credential-free HTTP or HTTPS webpage URL to fetch and extract."
      },
      ocrImages: {
        type: "boolean",
        description: "Attempt OCR on a small number of images when local tesseract is available.",
        default: false
      },
      maxTextChars: {
        type: "integer",
        description: "Maximum clean_text characters to return.",
        default: 30000,
        minimum: 1000,
        maximum: 100000
      },
      maxImages: {
        type: "integer",
        description: "Maximum image URLs to include.",
        default: 30,
        minimum: 0,
        maximum: 100
      }
    },
    required: ["url"],
    additionalProperties: false
  },
  outputSchema: {
    type: "object",
    additionalProperties: true
  }
};

export function createMcpServer({
  input = process.stdin,
  output = process.stdout,
  extractor = fetchAndExtractWebpage,
  maxFrameBytes = DEFAULT_MAX_FRAME_BYTES,
  maxConcurrent = DEFAULT_MAX_CONCURRENT,
  maxCallTimeoutMs = DEFAULT_MAX_CALL_TIMEOUT_MS,
  maxPendingTasks = DEFAULT_MAX_PENDING_TASKS,
  maxPendingWrites = DEFAULT_MAX_PENDING_WRITES
} = {}) {
  if (
    !input ||
    typeof input.on !== "function" ||
    typeof input.off !== "function" ||
    typeof input.pause !== "function" ||
    typeof input.resume !== "function"
  ) {
    throw new TypeError("input must be a pausable readable event stream.");
  }
  if (!output || typeof output.write !== "function") {
    throw new TypeError("output must be a writable stream.");
  }
  if (typeof extractor !== "function") throw new TypeError("extractor must be a function.");
  if (!Number.isInteger(maxFrameBytes) || maxFrameBytes < 1 || maxFrameBytes > 16_000_000) {
    throw new TypeError("maxFrameBytes must be an integer from 1 through 16000000.");
  }
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 100) {
    throw new TypeError("maxConcurrent must be an integer from 1 through 100.");
  }
  if (!Number.isInteger(maxCallTimeoutMs) || maxCallTimeoutMs < 1 || maxCallTimeoutMs > 120_000) {
    throw new TypeError("maxCallTimeoutMs must be an integer from 1 through 120000.");
  }
  if (
    !Number.isInteger(maxPendingTasks) ||
    maxPendingTasks < 1 ||
    maxPendingTasks > MAX_PENDING_TASKS_HARD_LIMIT
  ) {
    throw new TypeError(
      `maxPendingTasks must be an integer from 1 through ${MAX_PENDING_TASKS_HARD_LIMIT}.`
    );
  }
  if (
    !Number.isInteger(maxPendingWrites) ||
    maxPendingWrites < 1 ||
    maxPendingWrites > MAX_PENDING_WRITES_HARD_LIMIT
  ) {
    throw new TypeError(
      `maxPendingWrites must be an integer from 1 through ${MAX_PENDING_WRITES_HARD_LIMIT}.`
    );
  }
  if (maxPendingWrites < maxPendingTasks) {
    throw new TypeError("maxPendingWrites must be greater than or equal to maxPendingTasks.");
  }

  const writer = createJsonLineWriter(output, maxPendingWrites);
  const activeCalls = new Map();
  const pendingTasks = new Set();
  let lifecycleState = "uninitialized";
  let buffer = Buffer.alloc(0);
  let discardingOversizedFrame = false;
  let drainingInput = false;
  let inputPaused = false;
  let maxObservedPendingTasks = 0;
  let started = false;
  let finishing = false;
  let resolveDone;
  const done = new Promise((resolvePromise) => {
    resolveDone = resolvePromise;
  });

  const sendResult = (id, result) => writer.send({ jsonrpc: "2.0", id, result });
  const sendError = (id, code, message) =>
    writer.send({ jsonrpc: "2.0", id, error: { code, message } });

  async function handleRequest(message) {
    if (!isValidRequestEnvelope(message)) {
      const id = isValidRequestId(message?.id) ? message.id : null;
      await sendError(id, -32600, "Invalid Request.");
      return;
    }

    if (!Object.hasOwn(message, "id")) {
      handleNotification(message);
      return;
    }

    try {
      if (message.method === "initialize") {
        if (lifecycleState !== "uninitialized") {
          await sendError(message.id, -32600, "Server is already initialized.");
          return;
        }
        if (!isValidInitializeParams(message.params)) {
          await sendError(message.id, -32602, "Invalid initialize parameters.");
          return;
        }
        lifecycleState = "initializing";
        await sendResult(message.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO
        });
        return;
      }

      if (message.method === "ping" && lifecycleState === "initializing") {
        await sendResult(message.id, {});
        return;
      }

      if (lifecycleState !== "initialized") {
        await sendError(message.id, -32002, "Server not initialized.");
        return;
      }

      switch (message.method) {
        case "ping":
          await sendResult(message.id, {});
          break;

        case "tools/list":
          await sendResult(message.id, { tools: [TOOL] });
          break;

        case "tools/call":
          await handleToolCall(message);
          break;

        default:
          await sendError(message.id, -32601, "Method not found.");
      }
    } catch {
      await sendError(message.id, -32603, "Internal error.");
    }
  }

  function handleNotification(message) {
    if (message.method === "notifications/initialized") {
      if (lifecycleState === "initializing") lifecycleState = "initialized";
      return;
    }

    if (message.method !== "notifications/cancelled" || !isValidCancellationParams(message.params)) {
      return;
    }
    const call = activeCalls.get(requestIdKey(message.params.requestId));
    if (!call) return;
    call.cancelled = true;
    call.controller.abort();
  }

  async function handleToolCall(message) {
    const params = message.params;
    if (!isValidToolCallParams(params) || params.name !== TOOL.name) {
      await sendError(message.id, -32602, "Invalid tool parameters.");
      return;
    }

    let request;
    try {
      request = normalizeExtractionRequest(params.arguments ?? {});
    } catch (error) {
      if (!(error instanceof InputValidationError)) throw error;
      await sendError(message.id, -32602, "Invalid tool arguments.");
      return;
    }

    if (activeCalls.size >= maxConcurrent) {
      await sendError(message.id, -32001, "Too many concurrent tool calls.");
      return;
    }

    const key = requestIdKey(message.id);
    if (activeCalls.has(key)) {
      await sendError(message.id, -32600, "Request id is already in use.");
      return;
    }

    const call = {
      controller: new AbortController(),
      cancelled: false,
      timedOut: false,
      deadline: Date.now() + maxCallTimeoutMs,
      timeout: null
    };
    const abortForTimeout = () => {
      if (call.cancelled || call.timedOut) return;
      call.timedOut = true;
      call.controller.abort(new DOMException("Tool call timed out.", "TimeoutError"));
    };
    call.timeout = setTimeout(abortForTimeout, maxCallTimeoutMs);
    activeCalls.set(key, call);
    try {
      const result = await raceWithAbort(
        extractor(request.url, request, { signal: call.controller.signal }),
        call.controller.signal
      );
      if (!call.cancelled && Date.now() >= call.deadline) abortForTimeout();
      if (call.cancelled) return;
      if (call.timedOut) {
        await sendError(message.id, -32003, "Tool call timed out.");
        return;
      }
      await sendResult(message.id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
        isError: false
      });
    } catch {
      if (!call.cancelled && Date.now() >= call.deadline) abortForTimeout();
      if (call.cancelled) return;
      if (call.timedOut) {
        await sendError(message.id, -32003, "Tool call timed out.");
        return;
      }
      await sendResult(message.id, {
        content: [{ type: "text", text: "The webpage could not be extracted." }],
        structuredContent: {
          error: { code: "extraction_failed", message: "The webpage could not be extracted." }
        },
        isError: true
      });
    } finally {
      clearTimeout(call.timeout);
      activeCalls.delete(key);
    }
  }

  function scheduleTask(operation) {
    if (pendingTasks.size >= maxPendingTasks) return false;
    const task = Promise.resolve().then(operation);
    pendingTasks.add(task);
    maxObservedPendingTasks = Math.max(maxObservedPendingTasks, pendingTasks.size);
    void task
      .finally(() => {
        pendingTasks.delete(task);
        queueMicrotask(drainInputBuffer);
      })
      .catch(() => {});
    return true;
  }

  function scheduleFrame(frame) {
    if (frame.length > maxFrameBytes) {
      return scheduleTask(() =>
        sendError(null, -32600, `Request frame exceeds ${maxFrameBytes} bytes.`)
      );
    }

    let line;
    try {
      line = new TextDecoder("utf-8", { fatal: true }).decode(frame).trim();
    } catch {
      return scheduleTask(() => sendError(null, -32700, "Parse error."));
    }
    if (!line) return true;

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return scheduleTask(() => sendError(null, -32700, "Parse error."));
    }
    return scheduleTask(() => handleRequest(message));
  }

  function pauseInput() {
    if (inputPaused) return;
    inputPaused = true;
    input.pause();
  }

  function resumeInput() {
    if (!inputPaused || finishing) return;
    inputPaused = false;
    input.resume();
  }

  function drainInputBuffer() {
    if (drainingInput || finishing) return;
    drainingInput = true;
    try {
      let offset = 0;
      while (pendingTasks.size < maxPendingTasks) {
        const newlineIndex = buffer.indexOf(0x0a, offset);
        if (newlineIndex < 0) break;
        const frame = buffer.subarray(offset, newlineIndex);
        offset = newlineIndex + 1;
        scheduleFrame(frame);
      }

      if (offset > 0) {
        buffer = offset < buffer.length ? Buffer.from(buffer.subarray(offset)) : Buffer.alloc(0);
      }

      if (pendingTasks.size >= maxPendingTasks) {
        pauseInput();
        return;
      }

      if (buffer.length > maxFrameBytes) {
        buffer = Buffer.alloc(0);
        discardingOversizedFrame = true;
        scheduleTask(() =>
          sendError(null, -32600, `Request frame exceeds ${maxFrameBytes} bytes.`)
        );
        if (pendingTasks.size >= maxPendingTasks) {
          pauseInput();
          return;
        }
      }
      resumeInput();
    } finally {
      drainingInput = false;
    }
  }

  function onData(rawChunk) {
    let chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);

    if (discardingOversizedFrame) {
      const newlineIndex = chunk.indexOf(0x0a);
      if (newlineIndex < 0) return;
      chunk = chunk.subarray(newlineIndex + 1);
      discardingOversizedFrame = false;
    }

    buffer = buffer.length > 0 ? Buffer.concat([buffer, chunk]) : Buffer.from(chunk);
    drainInputBuffer();
  }

  function abortActiveCalls() {
    for (const call of activeCalls.values()) {
      call.cancelled = true;
      call.controller.abort();
    }
  }

  function onInputEnd() {
    abortActiveCalls();
    void finish();
  }

  function onInputError() {
    abortActiveCalls();
    void finish();
  }

  async function finish() {
    if (finishing) return done;
    finishing = true;
    await Promise.allSettled([...pendingTasks]);
    await writer.flush().catch(() => {});
    resolveDone();
    return done;
  }

  function start() {
    if (started) return api;
    started = true;
    input.on("data", onData);
    input.once("end", onInputEnd);
    input.once("error", onInputError);
    return api;
  }

  async function stop() {
    if (started) {
      pauseInput();
      input.off("data", onData);
      input.off("end", onInputEnd);
      input.off("error", onInputError);
    }
    abortActiveCalls();
    await finish();
  }

  function getStats() {
    const writerStats = writer.getStats();
    return Object.freeze({
      pendingTasks: pendingTasks.size,
      maxPendingTasks,
      pendingWrites: writerStats.pendingWrites,
      maxPendingWrites,
      inputPaused,
      bufferedInputBytes: buffer.length,
      maxObservedPendingTasks,
      maxObservedPendingWrites: writerStats.maxObservedPendingWrites
    });
  }

  const api = { start, stop, done, getStats };
  return api;
}

function createJsonLineWriter(output, maxPendingWrites) {
  const queue = [];
  const idleWaiters = [];
  let current = null;
  let pumping = false;
  let failure = null;
  let maxObservedPendingWrites = 0;

  function pendingWrites() {
    return queue.length + (current ? 1 : 0);
  }

  function settleIdleWaiters(error) {
    if (current || queue.length > 0) return;
    for (const waiter of idleWaiters.splice(0)) {
      if (error) waiter.reject(error);
      else waiter.resolve();
    }
  }

  function fail(error) {
    failure = error;
    for (const item of queue.splice(0)) item.reject(error);
    settleIdleWaiters(error);
  }

  async function pump() {
    if (pumping || failure) return;
    pumping = true;
    try {
      while (queue.length > 0) {
        current = queue.shift();
        try {
          await writeWithBackpressure(output, current.line);
          current.resolve();
        } catch (error) {
          current.reject(error);
          current = null;
          fail(error);
          return;
        }
        current = null;
      }
    } finally {
      pumping = false;
      settleIdleWaiters(failure);
    }
  }

  function send(message) {
    if (failure) return Promise.reject(failure);
    if (pendingWrites() >= maxPendingWrites) {
      return Promise.reject(new Error("stdout write queue limit reached."));
    }

    const line = `${JSON.stringify(message)}\n`;
    const result = new Promise((resolvePromise, rejectPromise) => {
      queue.push({ line, resolve: resolvePromise, reject: rejectPromise });
    });
    maxObservedPendingWrites = Math.max(maxObservedPendingWrites, pendingWrites());
    void pump();
    return result;
  }

  function flush() {
    if (failure) return Promise.reject(failure);
    if (!current && queue.length === 0) return Promise.resolve();
    return new Promise((resolvePromise, rejectPromise) => {
      idleWaiters.push({ resolve: resolvePromise, reject: rejectPromise });
    });
  }

  function getStats() {
    return {
      pendingWrites: pendingWrites(),
      maxObservedPendingWrites
    };
  }

  return { send, flush, getStats };
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

async function writeWithBackpressure(output, line) {
  if (output.write(line)) return;
  if (typeof output.once !== "function" || typeof output.off !== "function") {
    throw new Error("Writable output cannot signal backpressure release.");
  }
  await new Promise((resolvePromise, rejectPromise) => {
    const onDrain = () => {
      cleanup();
      resolvePromise();
    };
    const onError = (error) => {
      cleanup();
      rejectPromise(error);
    };
    const cleanup = () => {
      output.off("drain", onDrain);
      output.off("error", onError);
    };
    output.once("drain", onDrain);
    output.once("error", onError);
  });
}

function isValidRequestEnvelope(message) {
  if (!isPlainObject(message)) return false;
  const allowedFields = new Set(["jsonrpc", "id", "method", "params"]);
  if (Object.keys(message).some((field) => !allowedFields.has(field))) return false;
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string" || !message.method) return false;
  if (Object.hasOwn(message, "id") && !isValidRequestId(message.id)) return false;
  if (
    Object.hasOwn(message, "params") &&
    !isPlainObject(message.params)
  ) {
    return false;
  }
  return true;
}

function isValidRequestId(id) {
  return typeof id === "string" || (typeof id === "number" && Number.isSafeInteger(id));
}

function isValidInitializeParams(params) {
  return (
    isPlainObject(params) &&
    typeof params.protocolVersion === "string" &&
    params.protocolVersion.length > 0 &&
    isPlainObject(params.capabilities) &&
    isPlainObject(params.clientInfo) &&
    typeof params.clientInfo.name === "string" &&
    params.clientInfo.name.length > 0 &&
    typeof params.clientInfo.version === "string" &&
    params.clientInfo.version.length > 0
  );
}

function isValidToolCallParams(params) {
  if (!isPlainObject(params)) return false;
  const allowedFields = new Set(["name", "arguments", "_meta"]);
  if (Object.keys(params).some((field) => !allowedFields.has(field))) return false;
  if (typeof params.name !== "string") return false;
  return !Object.hasOwn(params, "arguments") || isPlainObject(params.arguments);
}

function isValidCancellationParams(params) {
  if (!isPlainObject(params) || !Object.hasOwn(params, "requestId")) return false;
  const allowedFields = new Set(["requestId", "reason"]);
  if (Object.keys(params).some((field) => !allowedFields.has(field))) return false;
  if (!isValidRequestId(params.requestId)) return false;
  return !Object.hasOwn(params, "reason") || typeof params.reason === "string";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requestIdKey(id) {
  return `${typeof id}:${String(id)}`;
}

function readBoundedIntegerEnv(name, defaultValue, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function runMain() {
  try {
    createMcpServer({
      maxFrameBytes: readBoundedIntegerEnv(
        "COTRADER_MCP_MAX_FRAME_BYTES",
        DEFAULT_MAX_FRAME_BYTES,
        1,
        16_000_000
      ),
      maxConcurrent: readBoundedIntegerEnv(
        "COTRADER_MCP_MAX_CONCURRENCY",
        DEFAULT_MAX_CONCURRENT,
        1,
        100
      ),
      maxCallTimeoutMs: readBoundedIntegerEnv(
        "COTRADER_MCP_CALL_TIMEOUT_MS",
        DEFAULT_MAX_CALL_TIMEOUT_MS,
        1_000,
        120_000
      ),
      maxPendingTasks: readBoundedIntegerEnv(
        "COTRADER_MCP_MAX_PENDING_TASKS",
        DEFAULT_MAX_PENDING_TASKS,
        1,
        MAX_PENDING_TASKS_HARD_LIMIT
      ),
      maxPendingWrites: readBoundedIntegerEnv(
        "COTRADER_MCP_MAX_PENDING_WRITES",
        DEFAULT_MAX_PENDING_WRITES,
        1,
        MAX_PENDING_WRITES_HARD_LIMIT
      )
    }).start();
  } catch (error) {
    console.error(`cotrader MCP server failed to start: ${error.message}`);
    process.exitCode = 1;
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entryUrl) runMain();
