#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAndExtractWebpage } from "../tools/fetch_and_extract_webpage.mjs";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const MAX_BODY_BYTES = 1_000_000;
const ACTIONS_DIR = dirname(fileURLToPath(import.meta.url));

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      writeJson(res, 204, {});
      return;
    }

    if (req.method === "GET" && req.url === "/openapi.json") {
      const spec = await readFile(join(ACTIONS_DIR, "openapi.json"), "utf8");
      write(res, 200, spec, "application/json");
      return;
    }

    if (req.method === "POST" && req.url === "/fetch_and_extract_webpage") {
      const body = await readJsonBody(req);
      if (!body.url || typeof body.url !== "string") {
        writeJson(res, 400, { error: "Missing required string field: url" });
        return;
      }
      const result = await fetchAndExtractWebpage(body.url, body);
      writeJson(res, 200, result);
      return;
    }

    writeJson(res, 404, {
      error: "Not found",
      routes: ["GET /openapi.json", "POST /fetch_and_extract_webpage"]
    });
  } catch (error) {
    writeJson(res, 500, { error: error.message });
  }
});

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      bytes += chunk.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8") || "{}";
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${error.message}`));
      }
    });
    req.on("error", reject);
  });
}

function writeJson(res, status, value) {
  if (status === 204) {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }
  write(res, status, JSON.stringify(value, null, 2), "application/json");
}

function write(res, status, body, contentType) {
  res.writeHead(status, {
    ...corsHeaders(),
    "content-type": `${contentType}; charset=utf-8`
  });
  res.end(body);
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization"
  };
}

server.listen(PORT, HOST, () => {
  console.error(`cotrader action server listening at http://${HOST}:${PORT}`);
});
