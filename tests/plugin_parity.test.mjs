import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { createActionServer } from "../plugins/cotrader/actions/http_action_server.mjs";
import { createMcpServer } from "../plugins/cotrader/mcp/fetch_and_extract_webpage_server.mjs";
import { fetchAndExtractWebpage } from "../plugins/cotrader/tools/fetch_and_extract_webpage.mjs";

const MIRRORED_RUNTIME_FILES = [
  "lib/extraction_request.mjs",
  "lib/safe_fetch.mjs",
  "tools/fetch_and_extract_webpage.mjs",
  "actions/http_action_server.mjs",
  "actions/openapi.json",
  "mcp/fetch_and_extract_webpage_server.mjs",
  "docs/integration.md",
  "docs/security.md"
];

test("plugin package runtime mirrors the repository implementation byte-for-byte", async () => {
  for (const relativePath of MIRRORED_RUNTIME_FILES) {
    const rootBytes = await readFile(new URL(`../${relativePath}`, import.meta.url));
    const pluginBytes = await readFile(
      new URL(`../plugins/cotrader/${relativePath}`, import.meta.url)
    );
    assert.deepEqual(pluginBytes, rootBytes, relativePath);
  }
});

test("plugin package exposes chrome-research as an explicit Chrome skill", async () => {
  const skill = await readFile(
    new URL("../plugins/cotrader/skills/chrome-research/SKILL.md", import.meta.url),
    "utf8"
  );
  const metadata = await readFile(
    new URL("../plugins/cotrader/skills/chrome-research/agents/openai.yaml", import.meta.url),
    "utf8"
  );
  const manifest = JSON.parse(
    await readFile(
      new URL("../plugins/cotrader/.codex-plugin/plugin.json", import.meta.url),
      "utf8"
    )
  );

  assert.match(skill, /name: chrome-research/);
  assert.match(skill, /chrome:control-chrome/);
  assert.match(metadata, /default_prompt: .*\$chrome-research/);
  assert.match(metadata, /allow_implicit_invocation:\s*false/);
  assert.equal(manifest.skills, "./skills/");
});

test("plugin package extractor rejects loopback before opening a connection", async () => {
  await assert.rejects(
    fetchAndExtractWebpage("http://127.0.0.1/private-sentinel"),
    (error) => error?.code === "UNSAFE_ADDRESS"
  );
});

test("plugin package HTTP Action defaults to bearer authentication", async () => {
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
    server.close();
    await once(server, "close");
  }
});

test("plugin package MCP entry point starts and completes initialization", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const session = createMcpServer({ input, output }).start();
  const responsePromise = readJsonLine(output);

  input.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: "plugin-init",
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "plugin-parity-test", version: "1" }
      }
    })}\n`
  );

  const response = await responsePromise;
  assert.equal(response.id, "plugin-init");
  assert.equal(response.result.protocolVersion, "2025-06-18");
  input.end();
  await session.done;
});

function readJsonLine(stream) {
  return new Promise((resolvePromise, rejectPromise) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      cleanup();
      try {
        resolvePromise(JSON.parse(buffer.slice(0, newline)));
      } catch (error) {
        rejectPromise(error);
      }
    };
    const onError = (error) => {
      cleanup();
      rejectPromise(error);
    };
    const cleanup = () => {
      stream.off("data", onData);
      stream.off("error", onError);
    };
    stream.on("data", onData);
    stream.on("error", onError);
  });
}
