# 可交给 Codex 的开发任务

开发一个名为 Share Note for Codex 的 Codex 插件，插件 ID 为 share-note，首发目标版本 0.1.0。先阅读同目录的 PLUGIN_PLAN.md，并将其作为范围、架构、验收和安全约束。

## 目标

用户能在 Codex 对话内预览、发布、读取、更新、列出本地记录和删除 Share Note 分享。插件客户端直接调用 Share Note HTTP 接口。

不得安装、启动、调用、依赖 Obsidian、Obsidian CLI、Obsidian URI、vault、.obsidian 配置、桌面渲染或插件内部对象。

## 交付结构

按照 PLUGIN_PLAN.md 建立仓库。使用 .codex-plugin/plugin.json，包含一个 share-note 路由 Skill、references 流程文件和 scripts 下的预编译独立客户端。开发源码使用 TypeScript，构建为 Node.js 可执行 bundle，并锁定依赖。

创建本地 marketplace 条目指向 ./plugins/share-note。先检查现有市场配置，合并新条目，不覆盖其他插件。当前插件规范应以官方文档核验，必要时使用 $plugin-creator 协助生成/校验包装文件。

首发不引入 MCP、常驻服务、管理后台、额外模型 API、自动全盘扫描、自动后台发布或动态安装运行依赖。

## 能力

实现 setup、doctor、preview、publish、read、update、list、delete。

- setup：支持安全导入用户自己的 UID/API key；正常首次验证由用户完成；不要求把秘密贴进对话。已有身份不自动重新注册。
- doctor：只进行无发布的配置/运行时/网络/鉴权检查，不自动创建测试笔记或轮换密钥。
- preview：支持基础 Markdown、经过允许列表清洗的 HTML；生成本地预览，不进行远端写入或未授权资源请求。
- publish：默认正文加密；明确授权后上传；保存状态；返回经过回读、解密和正文哈希核对的链接。
- read：获取分享页面并在脚本内解密；不执行页面 JavaScript；未知格式明确报错。
- update：保留原 filename 和解密密钥；每个分块重新生成随机 IV；核对返回 URL 和回读内容，不允许把新建当作原链接更新成功。
- configure-project：将已存在的用户级 profile 绑定到项目 `.openai/share-note.json`，项目记录与操作随项目保存，API 凭证仍为用户级。
- list：仅检索当前项目登记的分享记录，输出 scope=project，不宣称账号全部远端笔记。
- delete：要求明确目标与授权，删除后回读验证，不删除本地源文件，不把 HTTP 200 或 success=true 直接视为已删成功。

## 必须实现的边界

1. 插件自身 semver 与 Share Note 协议版本分离。先检查上游源码并固定 codec/profile、提交记录和测试夹具，不能把 0.1.0 直接用作上游加密格式版本头。
2. API origin、网页 origin、身份和发布记录绑定。只向批准的 API 主机发送发布凭证；网页读取和跨域重定向不得泄漏凭证；企业服务失败不自动切公共服务。
3. 用户级安全存储保存 API 凭证；安装目录只读；项目笔记 key 仅保存到 `.openai/share-note.keys.json` 并保持 Git 忽略；日志脱敏。Skill+本机脚本不被描述成强隔离的凭证环境。
4. 所有命令采用安全参数或受限 JSON 请求文件；禁止 eval、拼接 shell 执行输入、打印秘密和自动采纳笔记中的操作指令。
5. realpath、符号链接、文件大小和允许目录校验落到代码，不只写在 Skill 中。
6. 首发不自动上传用户附件、不执行任意网页脚本、不静默丢失图片。附件不随正文加密，发现时在预览阶段阻止并提示。允许插件固定、不含用户内容的样式资源采用受控流程。
7. 保存密钥和操作记录后才发首次创建请求。创建响应丢失时返回 unknown，不盲目重试；本地日志和哈希不能被描述成服务端 exactly-once 保证。
8. 明确区分 verified、submitted_unverified、unknown、failed、blocked、already_absent；回读失败就不能报告已验证成功。
9. 本机同笔记加锁、原子状态写入和崩溃恢复；不承诺没有上游条件写接口时的跨客户端原子并发控制。
10. “生成内容”不等于授权上传；用户明确给定内容、目标、加密模式并要求发布时，在风险不变的情况下不要重复索取相同确认。遇到敏感信息、目标变化、附件风险或降级时暂停。

## 开发顺序

M0：协议记录、已知加密夹具、模拟服务、结构与安全设计。
M1：setup/doctor/preview/read，建立安全存储和状态接口。
M2：publish 与回读校验，首发闭环。
M3：update/list/delete、并发和超时恢复。
M4：插件清单、Skill、发布 bundle、marketplace、README、验收文档。

每个阶段结束运行相关测试，并在最终报告中区分通过、失败、未执行。依赖缺失或无真实凭证时，不伪造线上联调，不声称实际发布成功。

## 验收

落实 PLUGIN_PLAN.md 中 A01–A22 的测试矩阵。优先测试中文/emoji 分块、错误密钥、未知 codec、更新目标消失、删除成功但页面仍存在、缓存延迟、创建超时、域名变更、路径越界、日志秘密、并发、升级和误触发上传。

真实服务的写入仅在用户明确提供测试服务及授权时执行，内容必须不敏感。没有真实凭证时完成单元、模拟和协议契约测试，并在 README 中标注目标实例联调未完成。

## 最终交付

交付可构建源码、插件安装目录、预编译 bundle、本地 marketplace、配置示例、PROTOCOL.md、SECURITY.md、ACCEPTANCE.md、测试结果和安装/使用说明。先核查实际许可再决定项目许可，保留必要第三方声明。

不要只交付 SKILL.md 或规划文档后宣称插件已完成；实际发布客户端、状态管理、安全处理和测试必须与交付状态一致。
