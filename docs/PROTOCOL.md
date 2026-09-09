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
| `POST /v1/file/upload` | authorized public-update image upload; raw bytes and filetype/hash/bytelength headers | no blind retry; persist unknown outcomes |
| `POST /v1/file/delete` | delete an owned HTML note | no blind retry; verify with credential-free GET |
| `GET /v1/account/get-key?id=<random UID>` | interactive browser initialization only | no credential header; no automatic retry or fallback |
| `GET <share URL>` | read or verify page | limited retry, exact approved web origin only |

`setup-codex-browser` is an explicit agent-assisted alternative: it returns the pending authorization URL and a session ID bound to the pending hash and canonical project root, without launching a browser. The Skill opens the exact URL in the Codex in-app browser and may read the displayed API key after user verification. `setup-codex-browser-complete` receives that key via a child-process environment or explicit non-echoing `--key-tty` input, checks the session, validates authentication, saves and binds the project. Token values are absent from CLI results and request files; the authorization URL and page token may enter agent tool context. No Obsidian callback, resident server, or browser logging is introduced. Missing/expired/replaced/consumed sessions are rejected without creating a new identity.

`GET /v1/account/get-key` is an interactive initialization route that can include a human-verification step and an Obsidian redirect. `setup-browser-start` may open only the exact configured API-origin route with a cryptographically random, URL-encoded UID. The manual start flow does not use the route for doctor, key rotation, recovery, DOM scraping, log reading, clipboard monitoring, or an Obsidian callback. `setup-browser` combines authorization, local non-echoing token input, authenticated empty `check-files` validation, credential saving and project binding. `setup-browser-complete` remains available for a two-step flow and also validates before saving. Invalid keys remain unpersisted; a matching unexpired pending setup can be resumed. Neither flow automatically rotates an existing rejected credential.

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

No encrypted write path may fall back to plaintext or to either historical deterministic-IV codec. An explicitly authorized public update is a separate preview-bound mode, not an encryption fallback.

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

## Public update and image-upload extension

The 2026-09-09 image-upload experiment is recorded in [the live report](experiments/independent-image-upload.md), with pinned client/server sources. A public update sets `template.encrypted: false`, supplies the title and HTML content directly, and keeps the existing remote filename. Local raster images use `check-files` deduplication followed by raw `upload` where needed. Their uploaded URLs replace local image data in the public article. These assets are not encrypted, and the HTML delete endpoint does not remove them.

Public preview authorization binds the source, image dependencies and intended public/upload modes. The final article hash is computed after verified asset URLs have been substituted. Public HTML is parsed and serialized consistently for read-back; the service wrapper is not treated as user article content. New shares remain encrypted; public mode currently applies to updates of existing themed records.
