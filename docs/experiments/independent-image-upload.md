# 独立图片上传实测

时间：2026-09-09 14:39:56–14:40:00（Asia/Shanghai）。

## 范围

使用当前项目已绑定的 public profile，测试 `https://api.note.sx` 与 `https://share.note.sx`。仅上传仓库中无敏感内容的 `tests/fixtures/images/pixel.jpg`，创建并删除一篇专用加密测试页面；未更新正式 README 页面，未改变客户端发布策略。

## 上游依据

- [官方客户端 API，固定 commit fa42a8c](https://github.com/alangrainger/share-note/blob/fa42a8c03466ba73cc77e0a17e0663604ff3037d/src/api.ts)：先调用 `POST /v1/file/check-files`，未命中时向 `POST /v1/file/upload` 发送原始图片字节。
- [官方媒体处理流程](https://github.com/alangrainger/share-note/blob/fa42a8c03466ba73cc77e0a17e0663604ff3037d/src/pipeline/upload-media.ts)：图片上传后，将返回 URL 写入正文元素的 `src`。
- [服务端 File 实现，固定 commit e328445](https://github.com/note-sx/server/blob/e328445707a4d2ccbfc1365ca6d54f804e089a79/app/src/v1/File.ts)：附件保存、哈希查询与 URL 返回；当前删除接口只处理 HTML。

上传复用现有身份认证头，另传 `x-sharenote-filetype`、`x-sharenote-hash`（SHA-1）和 `x-sharenote-bytelength`。测试使用现有协议版本头 1.5.5，未安装或运行上游应用。写请求均只发送一次，没有自动重试。

## 实测结果

| 检查 | 结果 |
| --- | --- |
| JPEG 大小 | 160 字节 |
| 原文件 SHA-1 | `6e666b617b1d2c5d3d40027b423c6178ab32cc09` |
| 上传前查重 | 未命中 |
| 独立上传 | HTTP 200 |
| 无凭据 GET 图片 | HTTP 200，`image/jpeg` |
| 下载字节与原文件比较 | 完全一致 |
| 上传后查重 | 返回相同图片 URL，未再次上传 |
| 加密测试页面 | 解密后的标题及完整 HTML 与提交值一致 |
| 未解密页面是否包含图片 URL | 不包含 |
| 当前客户端净化后是否保留远程 img | 不保留，正式接入需要调整 |
| 临时测试页面删除 | 删除后 GET 为 HTTP 404 |

图片地址：[微型 JPEG 测试图片](https://share.note.sx/files/2b/2bg08n5puiaqq9odyf3j.jpg)。

测试页面 ID 为 `azm84vr9`，已删除。未尝试删除图片：当前上游附件删除接口不支持图片，且附件可按哈希复用。本次剩余资产仅为上述无敏感内容的 160 字节测试图。

## 结论与限制

独立上传在当前目标实例上可用。正文可以继续加密，但图片字节不受正文加密保护；知道附件 URL 即可匿名读取图片。测试验证了上传、字节回读、查重及加密正文引用，没有进行浏览器视觉验收，也没有验证其他图片格式或较大文件的上传限制。

上述首次实测时，插件尚未正式接入独立上传，默认仍使用本地图片内嵌加密方案。

## 后续公开更新验证

2026-09-09 14:53（Asia/Shanghai），在用户明确授权后，客户端已接入针对已有主题记录的 public/upload 更新流程，并将 README_CN.md 的原页面 `hl5s26an` 从加密模式原地改为公开模式。配置档案的默认加密设置不变。

- 正文：[公开 README_CN.md](https://share.note.sx/hl5s26an)，无需片段密钥；匿名 GET 为 HTTP 200，页面 HTML 为 36,034 字节。
- 图片：[独立 banner](https://share.note.sx/files/l2/l2wvu5ktlm0km6zjl1zj.png)，匿名 GET 为 HTTP 200、`image/png`，1,331,602 字节。
- 图片 SHA-256：`83ef179207c388d5624f73f175f5fbf709d52499f20a53a0fd35de4e2d641200`，下载字节与本地 banner 完全一致。
- 更新结果为 `verified`，`fetched: true`、`decrypted: false`、`contentMatched: true`；公开正文直接引用独立图片 URL。
- 客户端 `read` 返回 `encrypted: false`，净化后的 HTML 保留该受限服务图片 URL。
- 完整构建和 161 项自动化测试通过；未执行浏览器视觉验收，也未提交或发布 Git 版本。

该 README 页面与 banner 是用户要求保留的正式分享，不属于已清理的微型图片测试页面。
