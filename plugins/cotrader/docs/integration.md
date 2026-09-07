# 集成说明

## 1. 系统提示词

使用：

```text
prompts/a-share-premarket-system-prompt.md
```

该提示词已包含“用户提供网页源模式”：用户给出盘前网页链接时，智能体应先调用 `fetch_and_extract_webpage`，再进行研判。

## 2. MCP stdio

MCP server：

```powershell
npm run mcp
```

可选资源边界（均有代码内硬上限）：

- `COTRADER_MCP_MAX_FRAME_BYTES`：单个 JSON-RPC 输入帧上限，默认 `1000000`。
- `COTRADER_MCP_MAX_CONCURRENCY`：并发抽取调用上限，默认 `4`。
- `COTRADER_MCP_CALL_TIMEOUT_MS`：单次工具调用总超时，默认 `55000` 毫秒。
- `COTRADER_MCP_MAX_PENDING_TASKS`：未完成输入任务上限，默认 `64`、硬上限 `1024`。
- `COTRADER_MCP_MAX_PENDING_WRITES`：stdout 待写响应上限，默认 `64`、硬上限 `1024`；不得小于任务上限。

如果客户端需要显式配置 command/args，可使用：

```json
{
  "mcpServers": {
    "cotrader-web-extractor": {
      "command": "node",
      "args": ["E:/cotrader/mcp/fetch_and_extract_webpage_server.mjs"]
    }
  }
}
```

工具名：

```text
fetch_and_extract_webpage
```

参数：

```json
{
  "url": "https://www.jiuyangongshe.com/a/1185592pj2h",
  "ocrImages": false,
  "maxTextChars": 30000,
  "maxImages": 30
}
```

## 3. Custom GPT Action

本地启动：

```powershell
$env:COTRADER_ACTION_TOKEN = "replace-with-a-long-random-secret"
npm run action
```

Action 默认拒绝匿名请求。仅在不经过反向代理、端口不对外开放的 loopback 开发环境中，可显式选择匿名模式：

```powershell
$env:COTRADER_ACTION_TOKEN = ""
$env:COTRADER_ALLOW_UNAUTHENTICATED_LOCAL = "true"
npm run action
```

主要环境变量：

- `COTRADER_ACTION_TOKEN`：Bearer token；默认必填。
- `COTRADER_ALLOW_UNAUTHENTICATED_LOCAL`：仅 loopback 开发可设为 `true`，默认 `false`。
- `COTRADER_ALLOWED_ORIGINS`：逗号分隔的精确 HTTP(S) origin；默认不发送跨域许可。
- `COTRADER_MAX_CONCURRENCY`：并发抽取上限，默认 `4`。
- `COTRADER_RATE_LIMIT_PER_MINUTE`：进程级每分钟请求上限，默认 `60`。
- `COTRADER_ACTION_TIMEOUT_MS`：单次 Action 抽取总超时，默认 `55000` 毫秒。
- `COTRADER_ENABLE_OCR`：设为 `true` 才允许 Action 请求 OCR，默认 `false`。

OpenAPI 描述：

```text
actions/openapi.json
```

注意：ChatGPT Actions 需要可公网访问的 HTTPS URL。本地 `http://127.0.0.1:8787` 只适合开发测试；真正接入时需要把 `actions/http_action_server.mjs` 部署到 HTTPS 服务，并把 `actions/openapi.json` 中的 `servers[0].url` 改成部署地址。即使应用只监听 `127.0.0.1`、由 Nginx/Caddy 等反向代理对外提供 HTTPS，也必须配置 token，不能开启匿名本机模式。多副本或高流量部署还应在网关实施共享速率限制；内置配额仅覆盖单个 Node 进程。

完整部署检查见 [`security.md`](security.md)。

## 4. 数据可信度

此工具只负责“抓取和结构化网页”。网页来源本身不自动升级为权威来源。

- 网页中的行情数字：默认 `webpage_excerpt_pending_verification`。
- 网页中的作者观点：只能作为观点/推演。
- 公告、政策、公司业务：仍需回到官方或公告源核验。
- `research_workflow_snapshot`：把网页线索分到市场结构、政策监管、公司公告、题材催化、个股逻辑、风险、事件日历和观点分桶。
- `verification_queue`：列出最需要优先核验的行情数字、政策公告、公司业务表述、风险线索和相关链接。
- `related_links`：抽取页面内链接，并标注可能的公告、政策、行情数据或原始出处线索。

## 5. OCR

OCR 是可选能力。若系统安装了 `tesseract`，并传入 `ocrImages: true`，工具会尝试识别少量图片。HTTP Action 还需显式设置 `COTRADER_ENABLE_OCR=true`；MCP stdio 由本机客户端直接控制。

未安装时不会失败，会在图片字段中返回：

```text
ocr_unavailable
```
