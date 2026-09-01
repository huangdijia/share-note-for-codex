# Preview and publish

## Preview

The request contains `profile`, `sourcePath`, `workspaceRoot`, and optionally `format` (`markdown` or `html`). The client resolves real paths, enforces the profile's allowed roots and size limit, renders deterministically, sanitizes HTML, and writes a local preview under user data.

Preview never contacts Share Note or fetches remote resources. Embedded images, active resources, private keys, and credential-like values return `publishable: false` and `status: blocked`. Do not work around the block by removing warnings from the request.

## Publish

Publish requires the fresh `previewId`, `expectedContentHash`, `workspaceRoot`, and:

```json
{
  "authorization": {
    "granted": true,
    "action": "publish",
    "profile": "default",
    "contentHash": "<exact preview hash>",
    "encryption": "encrypted"
  },
  "returnShareUrl": true
}
```

Set `returnShareUrl` only when the user wants the resulting link. The client rechecks the source hash, stores the note key and pending operation first, encrypts with new random IVs, submits once, fetches the returned page without credentials, decrypts it, and compares title and content hash.

Never convert `unknown` into a retry or `submitted_unverified` into success. The complete URL fragment is a decryption capability and must not be copied into logs or ordinary summaries.
