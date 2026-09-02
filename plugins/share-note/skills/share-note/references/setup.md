# Setup and doctor

The client requires Node.js 20 or newer and supports Windows, Linux, and macOS. Configuration, state, API credentials, and note keys live in the platform user-data directory, never the plugin or project directory. Credentials and note keys are intentionally stored as plaintext in private files; the client does not use a master password, Keychain, or another OS credential manager.

## Browser-assisted setup (recommended)

Use two restricted request files. The first contains no UID, key, or authorization URL.

For the frozen public service profile:

```json
{
  "profile": "public",
  "service": "public",
  "allowedSourceRoots": ["/absolute/path/to/project/docs"]
}
```

Call `setup-browser-start`. It generates a cryptographically random UID, stores a private pending record for ten minutes, and opens the exact public API authorization route in the system default browser. Its ordinary result contains only profile, service origins and expiry—not the UID or URL.

For self-hosting, require the user to separately inspect and confirm the API and web origins in the request. The confirmation values must exactly equal their corresponding normalized origins:

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

Do not choose, infer, rewrite, or fall back between these origins. In particular, a failed self-hosted launch or doctor never retries against the public service. Browser opening uses direct executable argument arrays for macOS, Windows and Linux; it does not use shell interpolation.

After the user completes the normal human verification in the browser, call `setup-browser-complete` with `{ "profile": "..." }`. The local client prompts on the user's TTY with non-echoing input for the displayed API key, passes it through a process-scoped environment entry into `setup`, then stores it as plaintext in a private local file. The client does not automate Turnstile, read the browser, read the clipboard, consume an `obsidian://` callback, or expose the key in an output. Use `{ "profile": "...", "cancel": true }` to delete a pending setup without prompting.

Pending setup is removed after successful completion, explicit cancellation, browser-launch failure, or on the next access after expiry. A missing, changed, expired, or already-consumed pending record fails closed. The user can restart browser setup after such a failure; there is no fully automatic recovery.

## Existing credential import

Create a request JSON with:

```json
{
  "profile": "default",
  "apiBaseUrl": "https://approved-api.example",
  "webBaseUrl": "https://approved-share.example",
  "allowedSourceRoots": ["/absolute/path/to/project/docs"],
  "credentialEnvVar": "SHARE_NOTE_CREDENTIAL"
}
```

`apiBaseUrl` and `webBaseUrl` have different roles even when a deployment uses the same origin. Do not infer or silently substitute a public origin for a configured enterprise origin.

The legacy `setup` action imports a credential the user already obtained through a legitimate flow. In a local terminal, let them set `SHARE_NOTE_CREDENTIAL` to `{"uid":"...","apiKey":"..."}`, then run setup. Prefer hidden terminal input; never construct either secret in conversation, a request file, shell history, or a command argument. The setup process deletes the in-process environment entry after reading it and persists the UID and API key as plaintext in a private local file.

Later actions read credentials and note keys directly from the private plaintext files; no master-password environment variable is required.

Default data locations are `%APPDATA%\\codex-share-note\\` on Windows, `$XDG_DATA_HOME/codex-share-note/` (or `~/.local/share/codex-share-note/`) on Linux, and `~/Library/Application Support/codex-share-note/` on macOS.

Schema-v1 Keychain and schema-v2 encrypted-vault profiles are intentionally rejected. Rerun setup to create schema v3; the client never reads or deletes old Keychain entries or encrypted secret files.

## Doctor

Doctor sends `POST /v1/file/check-files` with an empty file list. It checks configuration, network reachability and authentication without creating a note, rotating a key, or uploading an asset. An authentication error means setup must be repaired; do not call `get-key` automatically.
