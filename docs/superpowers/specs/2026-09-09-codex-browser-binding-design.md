# Codex 内置浏览器绑定设计

用户已确认采用内置浏览器授权、AI 读取页面 token、本地验证保存并绑定项目，保留手动输入。

CLI 增加 `setup-codex-browser` 与 `setup-codex-browser-complete`。前者复用有效凭据，或创建/续接 pending 并返回授权 URL、来源、过期时间及 sessionId。后者从进程环境读取 token，复用现有鉴权和项目绑定逻辑。系统浏览器模式行为保持兼容。

sessionId 为 `sha256(JSON.stringify([pending.bindingHash, canonicalProjectRoot]))`，关联授权身份、配置、时间和项目。完成时必须仍有匹配 pending，拒绝缺失、过期、替换、跨项目和重放；失败不得创建新身份。pending 仍按 profile 共享，不新增会话存储层；多个项目可准备同一 pending，但只允许一次成功消费。

Skill 使用当前可用的内置浏览器工具打开精确授权 URL，并只读该来源的授权页面。人机验证由用户完成；无可读取 token 或工具不可用时使用手动输入。URL/UID 和 token 可能进入工具及会话上下文，不能宣称零暴露；token 不进入请求文件、shell 参数或 CLI 输出。token 通过结构化子进程环境或显式 `--key-tty` 隐藏输入传递；PTY 模式等待关闭回显后的提示，再发送 token。

验证包括无浏览器启动、续接、错误 token 无持久化、错误/跨项目/过期/替换/消费后的 session 拒绝、并发完成、配置与项目变化，以及独立 bundle 的 CLI 调用。真实授权页/CAPTCHA 兼容性单独说明，不以 mock 结果替代。未授权发布、提交、推送或安装刷新。
