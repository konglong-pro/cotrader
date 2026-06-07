# cotrader

A 股盘前研判智能体辅助工具。

## 文件

- `prompts/a-share-premarket-system-prompt.md`：压缩强化版系统提示词。
- `.agents/skills/transaction/`：A 股个股异动、板块联动、交易结构和风险排雷 skill；显式输入 `$transaction` 时调用。
- `.codex/config.toml`：项目级 MCP 配置，让 Codex 能启动网页抽取工具。
- `tools/fetch_and_extract_webpage.mjs`：核心网页抓取与正文抽取工具，也可作为 CLI 使用。
- `mcp/fetch_and_extract_webpage_server.mjs`：最小 MCP stdio server，暴露 `fetch_and_extract_webpage`。
- `actions/http_action_server.mjs`：本地 HTTP Action 包装，暴露 `POST /fetch_and_extract_webpage`。
- `actions/openapi.json`：给 Custom GPT Actions 使用的 OpenAPI 描述；本地测试时 server URL 为 `http://127.0.0.1:8787`，实际给 ChatGPT 使用时需要部署到 HTTPS。

## 使用

```powershell
npm run extract -- "https://www.jiuyangongshe.com/a/1185592pj2h"
```

```powershell
npm run mcp
```

```powershell
npm run action
```

## 说明

工具会尽量提取标题、发布时间、正文、内嵌页面数据、图片 URL、股票列表和可能的盘前字段。网页中的行情数字默认标记为“网页摘录，待核验”，不会直接当作权威结构化行情数据。

OCR 为可选能力：如果系统安装了 `tesseract`，并在调用时传入 `ocrImages: true`，工具会尝试识别少量图片；否则返回 `ocr_unavailable`。
