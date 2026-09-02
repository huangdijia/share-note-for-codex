# Setup and doctor

The client requires Node.js 20 or newer and supports Windows, Linux, and macOS. Configuration, state, and an encrypted local secret vault live in the platform user-data directory, never the plugin or project directory. It does not use Keychain or another OS credential manager.

## Setup

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

The user should obtain their own UID/API key through the service's normal flow. In a local terminal, let them set `SHARE_NOTE_CREDENTIAL` to `{"uid":"...","apiKey":"..."}` and set a separate `SHARE_NOTE_MASTER_PASSWORD` of at least 16 characters, then run setup. Prefer hidden terminal input; never construct either secret in conversation, a request file, shell history, or a command argument. The setup process deletes both in-process environment entries after reading, derives a key with scrypt, and persists only AES-256-GCM ciphertext. It does not call `get-key` or register a new identity.

Every later process that needs a credential or locally stored note key must receive the same `SHARE_NOTE_MASTER_PASSWORD`. This includes doctor, publish, update, delete, and read by record ID. Preview, local list, and read by complete URL do not open the vault. Remove the environment variable after each invocation.

Default data locations are `%APPDATA%\\codex-share-note\\` on Windows, `$XDG_DATA_HOME/codex-share-note/` (or `~/.local/share/codex-share-note/`) on Linux, and `~/Library/Application Support/codex-share-note/` on macOS.

Schema-v1 profiles from the former Keychain implementation are intentionally rejected. Rerun setup to create schema v2; the client never reads or deletes old Keychain entries.

## Doctor

Doctor sends `POST /v1/file/check-files` with an empty file list. It checks configuration, network reachability and authentication without creating a note, rotating a key, or uploading an asset. An authentication error means setup must be repaired; do not call `get-key` automatically.
