# AGENTS.md

## Repository Purpose

`cotrader` is an A-share research assistant toolkit. It provides:

- A pre-market system prompt for A-share market hypothesis building.
- A `transaction` skill for explicit stock/sector abnormal-move analysis.
- A small webpage extraction tool exposed through CLI, MCP stdio, and HTTP Action wrappers.

This repository is for research workflow support only. Do not produce deterministic buy/sell advice, return promises, or unverified market claims.

## How To Run

Use Node.js 22 or newer.

```powershell
npm run extract -- "https://www.jiuyangongshe.com/a/1185592pj2h"
```

```powershell
npm run mcp
```

```powershell
npm run action
```

## Codex Entry Points

- System prompt: `prompts/a-share-premarket-system-prompt.md`
- Explicit skill: `.agents/skills/transaction`
- MCP server: `mcp/fetch_and_extract_webpage_server.mjs`
- HTTP Action server: `actions/http_action_server.mjs`
- OpenAPI schema: `actions/openapi.json`

The `transaction` skill is explicit-only. Use it only when the user invokes `$transaction`.

## Local Command Routing

When the user message starts with or clearly contains:

```text
$transaction
```

load and follow `.agents/skills/transaction/SKILL.md`. If detailed abnormal-move classification, output templates, expectation-gap analysis, bull/bear debate, or risk checks are needed, load the relevant files under `.agents/skills/transaction/references/`.

Do not invoke `transaction` for ordinary A-share or market questions unless the user explicitly uses `$transaction`.

## MCP Tool

The MCP server exposes:

```text
fetch_and_extract_webpage(url)
```

It fetches a user-provided webpage and returns metadata, clean text, stock mentions, image URLs, extracted field candidates, and webpage excerpt snapshots.

Webpage-derived market numbers must remain pending verification unless backed by an original authoritative source.

## Verification

Before handing off changes, run:

```powershell
node --check tools\fetch_and_extract_webpage.mjs
node --check mcp\fetch_and_extract_webpage_server.mjs
node --check actions\http_action_server.mjs
node -e "JSON.parse(require('fs').readFileSync('actions/openapi.json','utf8')); console.log('openapi json ok')"
```

For a live extraction smoke test:

```powershell
npm run extract -- "https://example.com"
```

## Editing Rules

- Keep changes small and aligned with the current no-dependency Node implementation.
- Do not add production dependencies without explicit approval.
- Do not weaken safety language around investment advice, source verification, or missing data.
- If real-time data, OCR, or external sources are unavailable, report the missing capability instead of fabricating output.
