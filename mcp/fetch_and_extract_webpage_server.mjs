#!/usr/bin/env node

import { fetchAndExtractWebpage } from "../tools/fetch_and_extract_webpage.mjs";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "cotrader-web-extractor", version: "0.1.0" };

const TOOL = {
  name: "fetch_and_extract_webpage",
  title: "Fetch and Extract Webpage",
  description:
    "Fetch a user-provided webpage URL and return cleaned text, metadata, extracted images, stock mentions, field candidates, and a webpage excerpt snapshot for A-share pre-market research.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "HTTP or HTTPS webpage URL to fetch and extract."
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
  }
};

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message, data) {
  send({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } });
}

async function handleRequest(message) {
  if (!message || message.jsonrpc !== "2.0") return;
  if (!("id" in message)) return;

  try {
    switch (message.method) {
      case "initialize":
        sendResult(message.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO
        });
        break;

      case "ping":
        sendResult(message.id, {});
        break;

      case "tools/list":
        sendResult(message.id, { tools: [TOOL] });
        break;

      case "tools/call":
        await handleToolCall(message);
        break;

      default:
        sendError(message.id, -32601, `Unknown method: ${message.method}`);
    }
  } catch (error) {
    sendError(message.id, -32603, error.message, { stack: error.stack });
  }
}

async function handleToolCall(message) {
  const params = message.params ?? {};
  if (params.name !== TOOL.name) {
    sendError(message.id, -32602, `Unknown tool: ${params.name}`);
    return;
  }

  const args = params.arguments ?? {};
  if (!args.url || typeof args.url !== "string") {
    sendError(message.id, -32602, "Missing required string argument: url");
    return;
  }

  try {
    const result = await fetchAndExtractWebpage(args.url, args);
    sendResult(message.id, {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
      isError: false
    });
  } catch (error) {
    sendResult(message.id, {
      content: [{ type: "text", text: `fetch_and_extract_webpage failed: ${error.message}` }],
      structuredContent: { error: error.message },
      isError: true
    });
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newlineIndex = buffer.indexOf("\n");
  while (newlineIndex >= 0) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (line) {
      try {
        handleRequest(JSON.parse(line));
      } catch (error) {
        sendError(null, -32700, "Parse error", { message: error.message });
      }
    }
    newlineIndex = buffer.indexOf("\n");
  }
});

process.stdin.on("end", () => {
  // Let any in-flight async tool calls finish naturally before Node exits.
});
