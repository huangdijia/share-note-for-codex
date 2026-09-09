# Share Note

[English](README.md) | [简体中文](README_CN.md)

Share Note 是一款本地 Codex 插件，通过内置 HTTP 客户端预览、发布、读取、更新、列出和删除 Share Note 页面。它不会安装或调用 Obsidian，不使用 Obsidian CLI、URI 或笔记库状态，不启动常驻服务，也不会在运行时安装依赖。

0.1.0 版本面向 Windows、Linux 和 macOS，要求 Node.js 20+。API 凭据以明文 JSON 存储在用户数据目录中。每个项目的配置档案（profile）绑定、发布记录和操作状态保存在 `.openai/share-note.json`；笔记链接片段中的密钥保存在私有文件 `.openai/share-note.keys.json` 中，该文件会被 Git 忽略。客户端不使用主密码、macOS 钥匙串或其他平台凭据管理器，并将插件安装目录视为只读目录。

## 交付内容

- 标准插件清单：`plugins/share-note/.codex-plugin/plugin.json`
- 一个负责路由的 Skill，以及各任务对应的参考文档
- 独立的 TypeScript HTTP 客户端，打包为 `share-note.mjs`
- 仓库内的本地插件市场：`.agents/plugins/marketplace.json`
- 锁定的构建依赖、模拟测试与契约测试、协议测试夹具，以及安全和验收文档

本插件不包含 MCP 服务器、守护进程或后台同步，不会动态执行 `npm install`、执行任意网页内容或上传用户附件。本地密钥明确采用明文存储；发布时仅支持加密 Share Note 页面正文。

## 构建与测试

```bash
npm ci
npm run build
```

`npm run build` 会执行类型检查、运行全部测试，然后将 Node.js 打包产物输出到插件安装目录中。安装已构建插件的用户无需运行 npm。

## 从本地插件市场安装

在仓库根目录执行：

```bash
codex plugin marketplace add "$(pwd)"
codex plugin add share-note@personal
```

安装后请开启新的 Codex 对话，以便发现 Skill。仓库中的插件市场仅包含一个指向 `./plugins/share-note` 的 Productivity 条目，安装策略为 `AVAILABLE`，认证策略为 `ON_INSTALL`。

## 首次设置

在需要绑定的项目目录中，使用交互式终端执行：

```bash
node /absolute/path/to/share-note.mjs setup-browser
```

此快捷命令使用公共服务和 `public` 配置档案，并将当前目录作为项目根目录。对于新配置档案，该目录也会成为允许访问的源文件根目录；已有配置档案的源文件访问限制会被保留。

命令会自动复用匹配且有效的凭据，或打开系统浏览器进行新的授权。完成正常的人机验证后，将页面显示的 API 密钥粘贴到终端一次即可，输入内容会隐藏。客户端会在**保存前**通过空的 `check-files` 请求验证身份，然后绑定项目，无需单独执行完成设置、`doctor` 或项目配置命令。错误的密钥不会保存；交互式命令允许使用同一个授权页面最多尝试三次。

如需明确指定项目和配置档案，可使用一个不含机密的请求文件：

```json
{
  "profile": "public",
  "service": "public",
  "projectRoot": "/absolute/path/to/project",
  "allowedSourceRoots": ["/absolute/path/to/project/docs"]
}
```

```bash
node /absolute/path/to/share-note.mjs setup-browser --request /absolute/path/to/browser-setup.json
```

`allowedSourceRoots` 可以省略：已有配置档案会保留原有根目录，否则使用项目根目录。使用自托管服务时，请在下方经过明确确认的自托管请求中加入 `projectRoot`，再通过 `setup-browser` 调用。

流程中断后，重新运行同一命令即可恢复尚未过期且匹配的待完成设置，无需重新打开浏览器。已有凭据有效时，重跑会验证并复用凭据，不再提示输入。网络错误、源文件配置变化、配置损坏或项目已绑定其他配置档案都会中止流程。已有凭据被拒绝时，不会静默生成新身份替换它。如果凭据保存成功后本地项目绑定失败，重新运行命令即可复用该凭据并完成绑定。已安装的插件需要从当前检出目录刷新，才能使用新的打包产物。

## 通过 Codex 内置浏览器绑定

如需在 Codex 中由 AI 辅助绑定，请使用内置 Skill 的[设置流程](plugins/share-note/skills/share-note/references/setup.md)。Agent 会调用：

```sh
node /absolute/path/to/share-note.mjs setup-codex-browser --request /absolute/path/to/browser-setup.json
```

请求使用与 `setup-browser` 相同的 `profile`、`service`、`projectRoot`、可选源文件根目录和已确认的自托管源站。省略请求文件时，使用当前目录和公共配置档案。已有有效凭据会立即完成验证和绑定；否则，命令会返回 `awaiting_user`、准确的 `authorizationUrl`、`sessionId`、源站和过期时间，不会打开系统浏览器。Agent 会在 Codex 内置浏览器中打开该 URL，等待你完成人机验证，然后读取页面显示的 API 密钥。

Agent 会在原始请求的副本中加入 `sessionId`，调用 `setup-codex-browser-complete`，并通过子进程环境变量 `SHARE_NOTE_BROWSER_API_KEY` 传入密钥。如果工具不支持结构化环境参数，则添加 `--key-tty`，并仅在隐藏输入提示出现后向专用 PTY 输入令牌。不使用该参数时，不会出现终端输入提示。完成步骤会检查待处理会话和规范化的项目根目录，通过空的 `check-files` 请求验证身份，保存凭据、绑定项目，并清除待处理状态。会话缺失、过期或被替换时会失败，不会生成另一个身份；错误密钥不会保存，可以在同一会话中重试。重新执行准备步骤会验证并复用已保存的凭据，包括本地绑定失败后的重试。

**信息暴露范围：**主动选择此模式后，授权 URL、UID 和页面令牌可能进入 Agent 工具或会话上下文。令牌不得写入请求文件、Shell 参数、CLI 输出或助手回复。应使用结构化子进程环境传递，避免 Shell 插值。若希望仅在本地隐藏输入，请使用手动 `setup-browser` 流程。浏览器工具不可用或无法读取页面令牌时，请使用 Skill 中说明的手动降级流程。模拟测试尚未验证真实公共服务页面的兼容性。

### 两步设置与恢复

原有的两步命令仍然可用。它们不会将生成的 UID、授权 URL、浏览器页面或 API 密钥写入请求文件和常规输出。

首先，为公共服务创建不含机密的请求文件，然后启动浏览器设置：

```json
{
  "profile": "public",
  "service": "public",
  "allowedSourceRoots": ["/absolute/path/to/project/docs"]
}
```

```bash
node /absolute/path/to/share-note.mjs setup-browser-start --request /absolute/path/to/public-browser-start.json
```

客户端会在私有、短期有效的待处理状态中创建密码学安全的随机 UID，并在系统默认浏览器中打开准确的授权地址 `https://api.note.sx/v1/account/get-key`。请在那里完成服务正常要求的人机验证。客户端不会检查浏览器 DOM、浏览器日志、重定向或剪贴板，也不会注册 Obsidian URI 处理程序。

然后，使用第二个仅包含配置档案的请求文件：

```json
{ "profile": "public" }
```

```bash
node /absolute/path/to/share-note.mjs setup-browser-complete --request /absolute/path/to/browser-complete.json
```

`setup-browser-complete` 会在本地 TTY 提示输入页面显示的 API 密钥，并且不回显。密钥不会进入请求文件、参数、JSON 结果、日志或持久化的配置档案；身份验证成功后，它会以明文写入用户数据目录中权限为 `0600` 的私有文件。若要放弃待完成设置，可使用 `{ "profile": "public", "cancel": true }`，命令会直接删除待处理状态，不再提示输入。

使用自托管实例时，用户必须分别主动输入并确认两个源站。它们可以相同，但不会被自动推断或替换：

```json
{
  "profile": "work",
  "service": "self-hosted",
  "apiBaseUrl": "https://api.notes.example",
  "webBaseUrl": "https://share.notes.example",
  "confirmedApiOrigin": "https://api.notes.example",
  "confirmedWebOrigin": "https://share.notes.example",
  "allowedSourceRoots": ["/absolute/path/to/project/docs"]
}
```

确认字段必须与规范化后的源站完全一致。浏览器启动流程与该 API 源站绑定；启动失败、密钥错误、`doctor` 失败或平台不受支持时，都不会切换到公共服务。待完成设置会在十分钟后过期（可配置范围仅为 60–1,800 秒），并在完成、取消或过期后下次访问时删除。

现有 `setup` 操作仍可用于导入通过合法流程取得的凭据。请求仍然只包含非机密路径和进程级凭据环境变量的名称；请勿将 UID 或 API 密钥放入请求文件。

通过旧方式导入凭据后，请使用仅包含配置档案的小型 JSON 请求运行 `doctor`。浏览器完成步骤已在保存前执行此检查。`doctor` 会发送经过身份验证的空 `check-files` 请求，不会创建笔记。

## 配置项目

用户级配置档案创建后，在执行任何文档操作之前，先将其绑定到准确的项目根目录：

```json
{
  "projectRoot": "/absolute/path/to/project",
  "profile": "public"
}
```

```bash
node /absolute/path/to/share-note.mjs configure-project --request /absolute/path/to/configure-project.json
```

该命令会创建可安全提交到 Git 的 `.openai/share-note.json` 清单，并确保 `.openai/.gitignore` 排除 `share-note.keys.json`。清单只能选择已有的用户级配置档案，不能添加服务源站、凭据来源或允许访问的源文件根目录。空项目可以重新绑定到其他配置档案；已有任何发布记录或操作的项目则不能更改绑定。

若要从旧版用户级注册表复制匹配记录，同时保留原始记录，请设置 `"importLegacyRecords": true`。只有配置档案相同且源文件位于当前项目内的记录才会导入。密钥缺失或 ID 冲突会在发起任何远程请求之前使导入失败。

## 操作

通过请求文件调用的格式如下（`setup-browser` 也支持前述不带请求文件的快捷方式）：

```bash
node /absolute/path/to/share-note.mjs <action> --request /absolute/path/to/request.json
```

支持的操作包括 `setup-codex-browser`、`setup-codex-browser-complete`、`setup`、`setup-browser`、`setup-browser-start`、`setup-browser-complete`、`doctor`、`configure-project`、`preview`、`publish`、`read`、`update`、`list` 和 `delete`。请求文件包含路径、记录 ID、哈希、会话 ID、服务源站和明确的写入授权，不包含机密、浏览器返回的密钥或笔记正文。

无需设置主密码环境变量。旧版设置流程和 `doctor` 仍以配置档案为作用域；`setup-browser` 还会绑定指定项目。所有文档操作（`preview`、`publish`、`read`、`update`、`list` 和 `delete`）都要求提供绝对路径 `projectRoot`，配置档案从该项目的清单中加载。这些操作会拒绝旧版顶层字段 `profile` 和 `workspaceRoot`，且源文件路径必须相对于 `projectRoot`。

预览会返回解析后的配置档案、API/Web 源站和 `projectBindingHash`。发布和更新授权必须回传该配置档案、绑定哈希及准确的内容哈希。如果预览后项目目标发生变化，授权便会失效。

发布和更新始终需要新的预览，以及与准确哈希绑定的授权。加密发布是唯一的写入模式。客户端会在首次创建请求前保存项目笔记密钥和待处理操作，不会盲目重试结果不明确的写入，并报告以下状态之一：`verified`、`submitted_unverified`、`unknown`、`failed`、`blocked` 或 `already_absent`。

`list` 的作用域为 `scope: "project"`，不代表列出远程账户的全部内容。删除操作会保留本地源文件、项目审计记录和项目密钥。包含图片或其他用户附件时会阻止发布，因为 Share Note 的正文加密不覆盖这些内容。

## 运行时数据

默认用户数据目录如下：

- Windows：`%APPDATA%\codex-share-note\`
- Linux：`$XDG_DATA_HOME/codex-share-note/`，或 `~/.local/share/codex-share-note/`
- macOS：`~/Library/Application Support/codex-share-note/`

配置档案、预览、锁、旧版记录、短期有效的待完成浏览器设置，以及明文 API 凭据文件均保存在该目录中。在 POSIX 系统上，文件和目录以原子方式创建，权限分别为 `0600` 和 `0700`；Windows 不支持 POSIX 权限模式，因此依赖当前用户的数据目录 ACL。`SHARE_NOTE_DATA_DIR` 可修改整个用户数据目录的位置，用于隔离测试和受控环境。

项目记录和操作以原子方式写入 `.openai/share-note.json`，使用项目相对源文件路径和不含片段的 URL。每篇笔记的密钥以明文保存在 `.openai/share-note.keys.json` 中，在 POSIX 系统上创建权限为 `0600`，并由同目录下的 `.openai/.gitignore` 忽略。Git 忽略规则无法保护已经被跟踪的密钥文件；任何能够读取或复制该文件的人都能解密对应的分享内容。Windows 依赖检出目录中当前用户的 ACL。

此设计不提供静态加密：任何能够读取用户数据目录的进程或用户，都可以取得 API 凭据；任何能够读取项目密钥文件的进程或用户，都可以取得笔记密钥。现有 schema-v1 钥匙串配置和 schema-v2 加密保险库配置不会被导入或读取；请重新运行设置，创建 schema-v3 明文文件配置档案。外部旧钥匙串条目、加密文件和旧版全局记录会保留原样。

## 协议与测试状态

冻结的协议配置和上游提交记录见 `docs/PROTOCOL.md`。安全边界见 `docs/SECURITY.md`；A01–A22 的验收结果见 `docs/ACCEPTANCE.md`。

所有已报告的远程流程测试均使用进程内模拟服务和确定性协议测试夹具。**由于未提供真实服务凭据，尚未执行公共或自托管目标实例上的 `doctor`、发布、更新、删除、CDN 行为、全新环境中的插件市场安装以及在线兼容性验证。此处不代表已完成版本发布或插件市场上架。**
