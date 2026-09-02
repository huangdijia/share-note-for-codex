# Share Note 浏览器辅助配置实施计划

在不修改现有 Share Note API 的前提下，实现“系统浏览器授权 + 本地安全导入”的半自动配置流程，同时支持公共服务和自托管实例。由于现有接口只把 API Key 显示在网页并回调 `obsidian://`，无法在不读取浏览器 DOM、注册 Obsidian Handler 或改服务端的情况下安全地全自动回传。

## 范围

- 包含：系统默认浏览器启动、人机验证、公共/自托管配置、本地隐藏输入、加密保险库存储、doctor 与发布验证。
- 不包含：修改 Share Note 服务端、绕过 Turnstile、读取浏览器 DOM/日志、监控剪贴板、注册 Obsidian URI Handler，以及完全无人值守取钥。

## 已确定决策

- 兼容现有 Share Note API，不要求服务端增加设备码或回调接口。
- 首个线上版本同时支持公共 Share Note 与自托管实例。
- 授权页面使用系统默认浏览器打开。

## 行动项

- [ ] 定义两阶段配置流程：`setup-browser-start` 生成 UID 并打开授权页，`setup-browser-complete` 通过本地隐藏输入导入网页返回的 API Key。
- [ ] 在 `src/platform/browser.ts` 增加跨平台系统浏览器启动器，分别使用 macOS、Windows 和 Linux 的安全参数调用，禁止 shell 拼接与未批准来源。
- [ ] 在 `src/app.ts` 和 `src/cli.ts` 增加浏览器配置操作，构造现有 `/v1/account/get-key?id=<uid>` 地址，并确保 UID 使用密码学安全随机值。
- [ ] 增加短期 pending-setup 记录，绑定 profile、UID、API/Web 来源、允许的源目录和过期时间；成功、取消或超时后原子删除。
- [ ] 实现本地隐藏输入助手：用户在系统浏览器完成 Turnstile 后，将页面显示的 API Key 输入终端；Key 和主密码只通过进程环境进入现有 `setup`，不进入请求文件或输出。
- [ ] 增加明确的服务选择：公共 Share Note 使用经过版本验证的预设来源，自托管要求用户分别确认 API 与 Web 来源；禁止连接失败后自动切换实例。
- [ ] 更新 Skill、README 和安全文档，解释浏览器步骤、人工验证、现有 API 限制，以及为何禁止 DOM 抓取、剪贴板监听和 Obsidian URI Handler。
- [ ] 添加单元与契约测试，覆盖浏览器命令参数、URL 编码、公共/自托管配置、pending 过期、取消、错误 Key、错误主密码、来源偏移和重复完成。
- [ ] 添加泄密测试，确认 UID/API Key、主密码、认证头和浏览器返回内容不会进入请求文件、标准输出、错误信息、状态记录或 Codex 上下文。
- [ ] 分别在公共 Share Note 和受控自托管实例执行线上验收：浏览器授权 → 加密保存 → doctor → fresh preview → 加密 publish → 回读 `verified`。

## 验收门槛

- `npm run typecheck` 与完整测试套件通过。
- 浏览器启动仅使用精确绑定的 API 来源，参数经过 URL 编码且不经过 shell 拼接。
- 配置、失败与诊断输出均不包含 API Key、主密码、认证头或完整解密链接。
- 公共服务与自托管实例各完成一次真实 doctor 和加密发布回读验证。
- 不支持的浏览器、取消、超时和错误凭据均失败关闭，并保留安全的手动隐藏输入回退流程。

## 未决问题

无；API 兼容范围、首发目标和浏览器选择均已确定。
