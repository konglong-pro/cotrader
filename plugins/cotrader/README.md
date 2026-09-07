# Cotrader Codex Plugin

This directory is the installable Codex plugin package for cotrader.

## What it contains

- `skills/transaction`: explicit-only `$transaction` skill for A-share abnormal-move and risk analysis.
- `skills/contrast`: explicit-only `$contrast` skill for US/Japan/Korea/Europe same-theme stock discovery, data verification, and comparison.
- `skills/chrome-research`: explicit-only `$chrome-research` skill for reading scoped, timestamped evidence from an authorized Chrome session.
- `mcp/fetch_and_extract_webpage_server.mjs`: MCP stdio server exposing `fetch_and_extract_webpage`.
- `tools/fetch_and_extract_webpage.mjs`: no-dependency webpage extraction engine used by CLI, MCP, and HTTP Action wrappers.
- `lib/`: shared strict request validation and safe public-web fetch boundary.
- `actions/`: authenticated HTTP Action wrapper and OpenAPI contract.
- `prompts/a-share-premarket-system-prompt.md`: evidence-based A-share pre-market hypotheses and follow-up framework.

The extractor also returns:

- `research_workflow_snapshot`: market-structure, policy/regulation, company-announcement, theme, stock-logic, risk, calendar, and opinion buckets.
- `verification_queue`: prioritized leads that still need S/A/B-level source or structured-data verification.
- `related_links`: page links classified as possible original sources, announcements, policy/calendar leads, market-data leads, or context links.

## Analysis behavior

Material conclusions carry evidence IDs, original-source links, observation times and verification status. Analysis distinguishes catalyst-to-business transmission, market/sector alternatives, consensus evidence and falsifiable follow-up signals. Historical requests retain their cutoff; later announcements cannot become previously known causes.

Intraday volume comparisons need matched elapsed trading time. Cross-market comparisons align sessions, currencies, share classes, fiscal periods and valuation definitions. Missing data leaves pricing and risk judgments unresolved; research scores are conditional observation priorities, not return probabilities.

On follow-up, the skills preserve the original hypothesis and report supported, weakened, invalidated or pending with new evidence. The plugin does not implement automatic monitoring or a live market-data feed. `get_a_share_premarket_snapshot` in the prompt is an external integration example, not an available tool supplied by this package.

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

```text
$contrast 固态电池 海外同题材股票对比
```

```text
$chrome-research 读取当前页面，提取公告标题、发布时间和原文链接
```

`$chrome-research` requires the Codex `chrome:control-chrome` skill and a connected, user-authorized Chrome session. It is read-only, defaults to the active tab, and does not copy or hardcode the Chrome plugin's versioned runtime path. Start a new Codex task after installing or updating the plugin so the new skill is discovered.

For webpage extraction, ask Codex to call the MCP tool explicitly:

```text
调用 fetch_and_extract_webpage 抓取这个网页：https://www.jiuyangongshe.com/a/1185592pj2h
```

The extractor rejects private-network targets and unsafe redirects, applies fixed response and timeout limits, and treats webpage market figures as pending verification. HTTP Action deployments require bearer authentication by default; see [`docs/integration.md`](docs/integration.md) and [`docs/security.md`](docs/security.md).

## Local smoke checks

From this plugin directory:

```powershell
node --check tools\fetch_and_extract_webpage.mjs
node --check mcp\fetch_and_extract_webpage_server.mjs
node --check actions\http_action_server.mjs
node -e "JSON.parse(require('fs').readFileSync('actions/openapi.json','utf8')); console.log('openapi json ok')"
npm run extract -- "https://example.com"
```

The repository-level test suite also imports and starts these plugin-package entry points and checks that mirrored runtime files remain byte-identical.
