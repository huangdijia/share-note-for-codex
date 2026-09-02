# Share Note protocol profile

Status: **frozen for the 0.1.0 implementation**. This is an interoperability record, not a claim that every public or self-hosted Share Note instance runs the same revision.

## Audited upstream

The M0 review was performed on 2026-09-01 against:

- `alangrainger/share-note` commit `30aa5fec60725e1c3a97842255be865a3fb542f3` (manifest 1.5.5, MIT).
- `note-sx/server` commit `c9d98c33a7f3301c12584b3fb4df05260dbb35d2` (PolyForm Perimeter 1.0.0). Server code is referenced for wire compatibility and is not copied into this project.

The implementation profile is `note-sx-client-1.5.5`. The Codex plugin version is `0.1.0`; it is deliberately not sent as the Share Note version header.

## Authentication and routing

Credentialed requests use these four headers:

| Header | Value |
|---|---|
| `x-sharenote-id` | configured UID |
| `x-sharenote-nonce` | decimal timestamp string |
| `x-sharenote-key` | lowercase hex `SHA-256(nonce + API key)` |
| `x-sharenote-version` | `1.5.5` for this profile |

The API and web origins are configured separately. Credentials are sent only to the exact approved API origin and are never sent while fetching a share page.

| Method and path | Purpose | Retry policy |
|---|---|---|
| `POST /v1/file/check-files` | non-writing authenticated doctor check with `files: []` | limited only when no ambiguity is created |
| `POST /v1/file/create-note` | create or update by `filename` | no blind retry |
| `POST /v1/file/delete` | delete an owned HTML note | no blind retry; verify with credential-free GET |
| `GET /v1/account/get-key?id=<random UID>` | user-driven browser initialization only | no credential header; no automatic retry or fallback |
| `GET <share URL>` | read or verify page | limited retry, exact approved web origin only |

`GET /v1/account/get-key` is an interactive initialization route that can include a human-verification step and an Obsidian redirect. `setup-browser-start` may open only the exact configured API-origin route with a cryptographically random, URL-encoded UID. It does not use the route for doctor, key rotation, recovery, DOM scraping, log reading, clipboard monitoring, or an Obsidian callback. `setup-browser-complete` receives the displayed key only through a local non-echoing terminal prompt.

## Create/update wire shape

The request JSON is:

```json
{
  "filename": "optionalexistingfilename",
  "filetype": "html",
  "hash": "sha1(template.content)",
  "template": {
    "width": "",
    "elements": [],
    "encrypted": true,
    "content": "{\"ciphertext\":[\"...\"],\"ivs\":[\"...\"]}",
    "mathJax": false
  }
}
```

`filename` is omitted on create and reused on update. A returned URL that differs from the recorded URL during update is treated as target deviation, because the server can create a new note when the original target is absent or not owned by the active identity.

## Modern write codec

New writes use `aes-gcm-random-ivs-v1.5`:

- plaintext is UTF-8 JSON: `{ "content": "<sanitized HTML>", "basename": "<title>" }`;
- AES-GCM key is 16 random bytes for a new note; an existing 16-byte or legacy 32-byte key is preserved on update;
- content is chunked at at most 2,000 UTF-16 code units without splitting a surrogate pair;
- every chunk gets a new random 12-byte IV, including every update and retry preparation;
- ciphertext includes the GCM authentication tag and is standard Base64;
- the key is standard Base64 without trailing padding and is placed only in the share URL fragment or secure storage;
- the server receives `JSON.stringify({ ciphertext: string[], ivs: string[] })` and never receives the fragment key.

No write path may fall back to plaintext or to either historical deterministic-IV codec.

## Read codecs

Read dispatch is based on the encrypted payload shape frozen in the server templates:

| Payload shape | Codec | Policy |
|---|---|---|
| `{ciphertext[], ivs[]}` | modern random 12-byte IVs (>=1.5.0) | read/write |
| `{ciphertext[]}` | deterministic little-endian index IV (1.2.0–1.4.x) | read only |
| `{ciphertext[], iv}` | legacy shared IV (<1.2.0) | read only |

Malformed or unknown payloads fail explicitly. Decryption failure is not converted into an empty note.

## Frozen fixtures and M0 result

`tests/fixtures/protocol-ciphertexts.json` contains known modern, 1.4.2 and 1.1.3 ciphertexts for identical Chinese/emoji content. Unit tests verify decryption and the authentication vector. The mock service used by contract tests implements only this recorded wire behavior and must not be described as a live Share Note instance.

M0 entry condition is met locally: request structure, authentication, codec selection, version mapping and fixtures are fixed. **No live service credential was available, so target-instance compatibility and online writes were not tested.**
