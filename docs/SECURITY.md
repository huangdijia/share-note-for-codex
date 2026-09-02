# Security model

Share Note for Codex is a local client, not a security boundary between processes running as the same operating-system user.

## Enforced boundaries

- The installation directory is treated as read-only. Profiles, state, previews and locks live in the platform user-data directory.
- API and web origins are distinct and bound to a profile. Authentication headers are constructed only inside the HTTP client for the exact approved API origin.
- Credentialed requests use manual redirect handling and reject redirects. Share-page redirects are revalidated and never carry credentials.
- API credentials and note keys use a plaintext-file SecretStore on Windows, Linux, and macOS. They are deliberately stored without encryption in the user-data directory. POSIX files use mode `0600` and parent directories use `0700`; Windows relies on the current user's data-directory ACL.
- The setup credential import is a process-scoped input. The client removes it from its own environment after reading it, then persists the UID and API key as plaintext. There is no master-password environment variable.
- Browser-assisted setup generates a cryptographically random UID only in private, short-lived pending state, binds it to profile, API origin, web origin and allowed roots, and opens only the bound API authorization URL. Pending state is atomically removed after success, cancellation, launch failure, or detected expiry.
- Public browser setup uses the frozen `https://api.note.sx` and `https://share.note.sx` pair. Self-hosted setup requires independent exact confirmations for API and web origins; any mismatch, launch failure, bad key, or doctor failure fails closed and never falls back to public Share Note.
- The local completion client uses non-echoing terminal input for the browser-displayed API key. It passes the key through a process-scoped environment entry to setup, then clears that entry. Results, errors, profile records, and ordinary output omit the UID, API key, authentication headers, browser-returned content, and complete decryption URLs; the private plaintext secret file intentionally contains the UID and API key.
- Source files are checked with `realpath`, allowed roots, symbolic-link resolution and a size limit before they are read.
- Preview and publishing never fetch embedded resources. User images and active embeds block first-release publication instead of being silently omitted or uploaded.
- Markdown embedded HTML is escaped. Explicit HTML is allow-list sanitized. Scripts, event handlers, `iframe`, active embeds and dangerous URL schemes are removed or blocked.
- Requests use structured JSON files and direct process argument arrays. There is no `eval`, shell command construction, or execution of note contents.
- Logs and ordinary results omit credentials, authentication headers, plaintext bodies and URL fragments. A full share URL is returned only as the direct authorized result of publish/update/read.
- Create/update/delete are not blindly retried. A lost create response is `unknown`; a successful HTTP status without matching read-back is not `verified`.
- State updates use per-note local locks and atomic replacement. This does not provide cross-client concurrency control because the audited upstream protocol has no conditional-write primitive.

## Authorization boundary

Generating or previewing content is not publication authorization. `publish`, `update` and `delete` require an explicit action-specific authorization field bound to a source/record and the current preview hash. A changed source, target, encryption downgrade, sensitive-data warning or embedded-resource warning blocks the operation.

Project configuration may narrow approved roots and defaults. It cannot add a trusted service origin or select a different credential source.

## Known limitations

- Anyone or any process with the complete URL fragment can decrypt that note.
- There is no encryption at rest. Anyone who can read the user-data directory can recover the API credential and every locally stored note key.
- POSIX systems enforce mode `0700` directories and `0600` files. Windows uses the current user's data-directory ACL; POSIX mode bits are not a Windows security boundary.
- Share deletion cannot revoke copies already saved by recipients and does not claim to delete independently uploaded attachments.
- CDN visibility after deletion can lag. The client reports `submitted_unverified` until absence is observed.
- The first release does not claim atomic exactly-once creation or cross-client lost-update prevention.
- Live compatibility depends on the configured Share Note instance matching the frozen protocol profile.

## Explicit exclusions

The implementation does not install, start, call or inspect Obsidian, Obsidian CLI, Obsidian URI handlers, vaults, `.obsidian`, Obsidian plugin APIs, or its rendering environment. It does not run a resident service, MCP server, background synchronization loop, arbitrary page script or dynamic dependency installer. It does not bypass or automate Turnstile, inspect browser DOM/logs/history/traffic, monitor the clipboard, or use an Obsidian URI handler to collect browser output.

It also does not call macOS Keychain, Windows Credential Manager, Linux Secret Service, or their CLIs. Schema-v1 Keychain and schema-v2 encrypted-file references are rejected and must be replaced by rerunning setup; old external entries and encrypted files are never read, migrated, or deleted.
