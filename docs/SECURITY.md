# Security model

Share Note for Codex is a local client, not a security boundary between processes running as the same operating-system user.

## Enforced boundaries

- The installation directory is treated as read-only. Profiles, state, previews and locks live in the platform user-data directory.
- API and web origins are distinct and bound to a profile. Authentication headers are constructed only inside the HTTP client for the exact approved API origin.
- Credentialed requests use manual redirect handling and reject redirects. Share-page redirects are revalidated and never carry credentials.
- API credentials and note keys use the platform SecretStore. The macOS adapter uses Keychain. A process-scoped environment import is supported only to seed Keychain and is never a persistence fallback.
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
- A local process with the same OS user permissions may be able to access Keychain after OS policy permits it.
- Share deletion cannot revoke copies already saved by recipients and does not claim to delete independently uploaded attachments.
- CDN visibility after deletion can lag. The client reports `submitted_unverified` until absence is observed.
- The first release does not claim atomic exactly-once creation or cross-client lost-update prevention.
- Live compatibility depends on the configured Share Note instance matching the frozen protocol profile.

## Explicit exclusions

The implementation does not install, start, call or inspect Obsidian, Obsidian CLI, Obsidian URI handlers, vaults, `.obsidian`, Obsidian plugin APIs, or its rendering environment. It does not run a resident service, MCP server, background synchronization loop, arbitrary page script or dynamic dependency installer.
