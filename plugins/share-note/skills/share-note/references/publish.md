# Preview and publish

## Interactive style selection

For a new publication without a user-selected style, ask before creating its preview:

1. Read the project's `defaultTheme` from `.openai/share-note.json`; use `simple` when absent. Offer 简洁 (`simple`), 技术 (`technical`), 阅读 (`reading`), and 深色 (`dark`), with the resolved default first and marked as recommended.
2. Prefer Codex's `request_user_input_async` when available. Otherwise use `request_user_input` only if the current mode permits it. Ask one concise question: “这次发布使用哪种样式？” Respect the tool's option limit; if fewer than four choices are supported, use a follow-up choice to expose the remaining styles. If neither tool is available, ask in the conversation.
3. Wait for an explicit answer before the publication preview and upload. A preselected option or elapsed timeout is not an answer. If the user dismisses the question without choosing, leave publication pending. Independent read-only preparation may continue while waiting.
4. Set the selected `theme` on the preview request and show the resulting preview. Do not ask again when the user already specified a style or explicitly requested the default. Do not persist a one-time selection as `defaultTheme`; that requires a request to change the project default.

This is a Codex interaction; direct CLI preview requests retain their existing default behavior. Preview-only requests may use the default without this question. Updates preserve the record's style unless the user requests a change. Style selection is separate from write authorization.

## Preview

The request contains the exact absolute `projectRoot`, a project-relative `sourcePath`, and optionally `format` (`markdown` or `html`) and `theme` (`simple`, `technical`, `reading`, or `dark`). The client reads the profile from `.openai/share-note.json`, resolves real paths, enforces both project containment and the profile's global allowed roots and size limit, renders deterministically, sanitizes HTML, and writes a local preview under user data.

Omit `theme` for the project default (system fallback: `simple`). `themes` is a read-only, no-request command listing IDs, names, uses and the system default. The client sanitizes user content before adding bundled scoped CSS; it hashes and encrypts the entire styled fragment. Preview adds only the HTML document shell. Never add user CSS or change the sanitizer.

Preview returns the actual theme identifier/name, target profile, API/Web origins and `projectBindingHash`. Show those target fields with the content hash and warnings before authorizing a write.

Preview never contacts Share Note or fetches remote resources. Embedded images, active resources, private keys, and credential-like values return `publishable: false` and `status: blocked`. Do not work around the block by removing warnings from the request.

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
