# Cotrader Codex Plugin

This directory is the installable Codex plugin package for cotrader.

## What it contains

- `skills/transaction`: explicit-only `$transaction` skill for A-share abnormal-move and risk analysis.
- `mcp/fetch_and_extract_webpage_server.mjs`: MCP stdio server exposing `fetch_and_extract_webpage`.
- `tools/fetch_and_extract_webpage.mjs`: no-dependency webpage extraction engine used by CLI, MCP, and HTTP Action wrappers.
- `prompts/a-share-premarket-system-prompt.md`: compressed A-share pre-market system prompt.

## Install from this repo marketplace

The repo marketplace file is:

```text
E:\cotrader\.agents\plugins\marketplace.json
```

In Codex, add this marketplace root if needed, then install `cotrader` from it. After installation, start a new thread so Codex can load the plugin skill and MCP server.

## Use

```text
$transaction 分析 300750 今日异动
```

For webpage extraction, ask Codex to call the MCP tool explicitly:

```text
调用 fetch_and_extract_webpage 抓取这个网页：https://www.jiuyangongshe.com/a/1185592pj2h
```

## Local smoke checks

From this plugin directory:

```powershell
node --check tools\fetch_and_extract_webpage.mjs
node --check mcp\fetch_and_extract_webpage_server.mjs
npm run extract -- "https://example.com"
```
