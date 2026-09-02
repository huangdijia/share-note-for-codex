# Preview and publish

## Preview

The request contains the exact absolute `projectRoot`, a project-relative `sourcePath`, and optionally `format` (`markdown` or `html`). The client reads the profile from `.openai/share-note.json`, resolves real paths, enforces both project containment and the profile's global allowed roots and size limit, renders deterministically, sanitizes HTML, and writes a local preview under user data.

Preview returns the target profile, API/Web origins and `projectBindingHash`. Show those target fields with the content hash and warnings before authorizing a write.

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
