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
npm run action
```

OpenAPI 描述：

```text
actions/openapi.json
```

注意：ChatGPT Actions 需要可公网访问的 HTTPS URL。本地 `http://127.0.0.1:8787` 只适合开发测试；真正接入时需要把 `actions/http_action_server.mjs` 部署到 HTTPS 服务，并把 `actions/openapi.json` 中的 `servers[0].url` 改成部署地址。

## 4. 数据可信度

此工具只负责“抓取和结构化网页”。网页来源本身不自动升级为权威来源。

- 网页中的行情数字：默认 `webpage_excerpt_pending_verification`。
- 网页中的作者观点：只能作为观点/推演。
- 公告、政策、公司业务：仍需回到官方或公告源核验。

## 5. OCR

OCR 是可选能力。若系统安装了 `tesseract`，并传入 `ocrImages: true`，工具会尝试识别少量图片。

未安装时不会失败，会在图片字段中返回：

```text
ocr_unavailable
```
