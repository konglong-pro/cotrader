# cotrader

A 股盘前研判智能体辅助工具。

## 文件

- `prompts/a-share-premarket-system-prompt.md`：以证据台账、催化传导和假设验证为核心的系统提示词。
- `plugins/cotrader/skills/transaction/`：A 股个股异动、板块联动、交易结构和风险排雷 skill；显式输入 `$transaction` 时调用。
- `plugins/cotrader/skills/contrast/`：跨美股、日本/日经、韩国、欧洲市场的同题材股票发现、数据核验和对比分析 skill；显式输入 `$contrast` 时调用。
- `plugins/cotrader/skills/chrome-research/`：通过已安装的 `chrome:control-chrome` 读取当前或指定 Chrome 页面并整理带来源、时间戳和核验状态的研究证据；显式输入 `$chrome-research` 时调用。
- `.codex/config.toml`：项目级 MCP 配置，让 Codex 能启动网页抽取工具。
- `lib/`：HTTP/MCP 共用的严格输入校验与安全抓取边界。
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
$env:COTRADER_ACTION_TOKEN = "replace-with-a-long-random-secret"
npm run action
```

HTTP Action 默认要求 Bearer token，包括监听 loopback 并由反向代理对外暴露的场景。本机临时开发如确需匿名访问，必须显式设置 `COTRADER_ALLOW_UNAUTHENTICATED_LOCAL=true`；不要在反向代理或公网部署中使用该开关。

完整配置见 [`docs/integration.md`](docs/integration.md)，安全边界与部署检查见 [`docs/security.md`](docs/security.md)。

## 分析能力

- 证据可追溯：核心声明关联原始来源、数据时点、单位与核验状态；带原文链接的转载仍需实际核验。
- 因果与预期差：拆解催化对收入、成本和现金流的传导，比较板块共振等替代解释，并说明共识依据与反证。
- 时间与口径：历史复盘固定信息截止时间；盘中量能使用同时间基准；跨市场比较对齐交易窗口、币种、财务期间和估值定义。
- 假设复盘：跟踪原判断的支持、弱化、失效或待验证状态；缺失数据不充当利好、低风险或“尚未交易”的证据。
- 条件评分：数据不足时只给待验证方向；观察评分不代表上涨概率或收益预测。

示例（替换日期、标的或材料后使用）：

```text
$transaction 复盘 300750 在指定交易日的异动，区分收盘前已知事实与盘后公告
$transaction 根据上次假设和新增材料，逐项判断支持、弱化、失效或待验证
$contrast 固态电池，只比较日本和韩国，检查业务暴露、估值口径和A股映射的反证
```

提示词中的 `get_a_share_premarket_snapshot` 是外部集成示例，本仓库未实现该工具，也未内置实时行情源或自动监控。技能按运行环境实际可用的数据能力降级。行为验收场景见 [`docs/analysis-validation.md`](docs/analysis-validation.md)。

## 说明

工具会尽量提取标题、发布时间、正文、内嵌页面数据、图片 URL、股票列表和可能的盘前字段。网页中的行情数字默认标记为“网页摘录，待核验”，不会直接当作权威结构化行情数据。

OCR 为可选能力：如果系统安装了 `tesseract`，并在调用时传入 `ocrImages: true`，工具会尝试识别少量图片；否则返回 `ocr_unavailable`。HTTP Action 还需显式设置 `COTRADER_ENABLE_OCR=true`。
