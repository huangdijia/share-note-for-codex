# Preview and publish

For publication, complete the identity preflight or first-time binding in `setup.md` before style selection and preview. Resume the same requested file/action after binding; do not repeat a successful setup's authentication check. Preview-only requests remain local.

## Interactive style selection

For a new publication without a user-selected style, ask before creating its preview:

1. Read the project's `defaultTheme` from `.openai/share-note.json`; use `simple` when absent. The complete catalog is 简洁 (`simple`), 技术 (`technical`), 阅读 (`reading`), 深色 (`dark`), GitHub (`github`), Typora GitHub (`typora-github`), Typora Newsprint (`typora-newsprint`), Typora Night (`typora-night`), Obsidian (`obsidian`), and Obsidian 深色 (`obsidian-dark`). Present the resolved default first and mark it as recommended.
2. Prefer Codex's `request_user_input_async` when available. Otherwise use `request_user_input` only if the current mode permits it. Ask one concise question: “这次发布使用哪种样式？” Respect the tool's option limit; show the complete catalog before the question and use a family/variant follow-up when the choices do not fit one question. If neither tool is available, ask in the conversation.
3. Wait for an explicit answer before the publication preview and upload. A preselected option or elapsed timeout is not an answer. If the user dismisses the question without choosing, leave publication pending. Independent read-only preparation may continue while waiting.
4. Set the selected `theme` on the preview request and show the resulting preview. Do not ask again when the user already specified a style or explicitly requested the default. Do not persist a one-time selection as `defaultTheme`; that requires a request to change the project default.

This is a Codex interaction; direct CLI preview requests retain their existing default behavior. Preview-only requests may use the default without this question. Updates preserve the record's style unless the user requests a change. Style selection is separate from write authorization.

For natural-language requests, map “Typora” to `typora-github` and “Obsidian” to `obsidian`. Select `typora-night` or `obsidian-dark` only when the user explicitly asks for that dark variant; a generic 深色/dark request remains `dark`.

## Preview

The request contains the exact absolute `projectRoot`, a project-relative `sourcePath`, and optionally `format` (`markdown` or `html`) and one of the ten `theme` IDs listed above. The client reads the profile from `.openai/share-note.json`, resolves real paths, enforces both project containment and the profile's global allowed roots and size limit, renders deterministically, sanitizes HTML, and writes a local preview under user data.

Omit `theme` for the project default (system fallback: `simple`). `themes` is a read-only, no-request command listing IDs, names, uses and the system default. The client sanitizes user content before adding bundled scoped CSS and hashes the preview fragment. Encrypted publication encrypts the entire styled fragment; explicitly authorized public updates upload a public article after substituting verified image URLs. Preview adds only the HTML document shell. Never add user CSS or change the sanitizer.

Built-in themes are article-only visual adaptations using system fonts. They do not integrate with GitHub, Typora or Obsidian, and they do not expand Markdown syntax. The `github` CSS is derived from a pinned MIT-licensed source recorded in the package notices; the Typora- and Obsidian-named themes are independent visual adaptations.

Preview returns the actual theme identifier/name, target profile, API/Web origins and `projectBindingHash`. Show those target fields with the content hash and warnings before authorizing a write.

Preview never contacts Share Note or fetches remote resources. For an existing themed record, an explicit public update uses `encryption: "public"` with `imageMode: "upload"`; image bytes remain local until the authorized update. New publication continues to require encrypted/inline mode. Local PNG, JPEG, GIF and WebP images referenced with Markdown image syntax are validated and embedded as data URIs inside the encrypted body, with paths constrained to the project and profile allowed roots. Source and image bytes share the configured source-size limit, counting repeated references per occurrence. Publish/update recheck image dependencies against the preview; changed images require a fresh preview. Remote image URLs, SVG, raw HTML image embeds, invalid or out-of-root images, active resources, private keys, and credential-like values return `publishable: false` / `status: blocked` or a source-validation error. Do not work around the block by removing warnings from the request.

## Publish

Publish requires the same `projectRoot`, fresh `previewId`, `expectedContentHash`, and:

```json
{
  "authorization": {
    "granted": true,
    "action": "publish",
    "profile": "default",
    "projectBindingHash": "<exact preview project binding hash>",
    "contentHash": "<exact preview hash>",
    "encryption": "encrypted"
  },
  "returnShareUrl": true
}
```

Set `returnShareUrl` only when the user wants the resulting link. The client rechecks the project binding and source hash, stores the note key in the ignored project key file and the pending operation in the project manifest first, encrypts with new random IVs, submits once, fetches the returned page without credentials, decrypts it, and compares title and content hash.

Never convert `unknown` into a retry or `submitted_unverified` into success. The complete URL fragment is a decryption capability and must not be copied into logs or ordinary summaries.
