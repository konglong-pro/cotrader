# 安全边界与资源限制

网页 URL、网页响应、OCR 图片和 HTTP Action 请求都按不可信输入处理。本工具只支持公开的、无凭据的 HTTP(S) 目标，不提供内网抓取能力。

## 已实施的边界

- URL 只允许 `http:` 和 `https:`，拒绝用户名/密码、非公开 IPv4/IPv6、混合公开/私有 DNS 结果及不安全的重定向目标。
- 每次请求先解析并校验全部地址，再把实际连接固定到已校验地址；最多跟随 5 次重定向，每一跳都重新校验。
- 主页面编码后与解压后响应均有硬上限，最大 8 MB；总抓取超时最大 20 秒。调用方不能通过公共参数提高这些上限。
- OCR 图片也经过同一网络边界，单图最大 5 MB、最多处理 3 张；只接受成功的 `image/*` 响应，并使用异步、可取消的子进程。
- HTTP 与 MCP 复用同一严格请求校验，只接受 `url`、`ocrImages`、`maxTextChars` 和 `maxImages`，拒绝未知字段。
- HTTP 请求体最大 1 MB；抽取有并发上限、每进程固定窗口速率上限和总调用超时。
- MCP 限制输入帧、并发抽取、未完成任务、stdout 待写响应和总调用时长；队列饱和时暂停输入，并在客户端取消或 stdin 关闭时传播取消信号。
- HTML 标签、属性、链接、图片和内嵌内容使用单向游标扫描；遇到未闭合的合法标记时保留已完成结果并丢弃不完整尾部，避免同步重复扫描。
- 来源等级按解析后的 hostname 精确匹配，不按 URL 子串判定；网页中的行情数字仍标记为待核验。

## HTTP Action 部署清单

1. 生成并配置长随机 `COTRADER_ACTION_TOKEN`，客户端发送 `Authorization: Bearer <token>`。
2. 对外只提供 HTTPS，并在反向代理与应用之间继续保留 Bearer 鉴权。监听 `127.0.0.1` 不代表反向代理后的服务是私有的。
3. 仅列出真实需要的 `COTRADER_ALLOWED_ORIGINS`；默认空列表是安全值。
4. 保留 `COTRADER_RATE_LIMIT_PER_MINUTE`、`COTRADER_MAX_CONCURRENCY` 和 `COTRADER_ACTION_TIMEOUT_MS` 的边界。多副本部署应在网关增加共享配额。
5. 默认保持 OCR 关闭；只有确认 CPU、临时目录和 Tesseract 风险可接受时才设置 `COTRADER_ENABLE_OCR=true`。
6. 将应用运行在低权限账户或容器中，并用网络策略限制出站访问，作为 SSRF 校验之外的纵深防御。

`COTRADER_ALLOW_UNAUTHENTICATED_LOCAL=true` 仅用于不经过代理、端口不对外开放的本机临时开发。该配置在非 loopback `HOST` 上会拒绝启动。

## 剩余限制

- 内置速率限制是单进程内存状态，不在实例之间共享，也不替代边缘网关的抗滥用能力。
- HTML 抽取是启发式处理，复杂脚本渲染页面可能不完整；这不应通过放宽网络边界来解决。
- OCR 是本机外部程序能力，未安装时返回 `ocr_unavailable`；本次测试不把真实 Tesseract 或任意公网网站作为稳定依赖。
- 工具返回的是研究线索，不是权威行情数据，也不构成确定性买卖建议。
