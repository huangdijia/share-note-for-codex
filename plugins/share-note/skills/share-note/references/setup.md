# Setup and doctor

The client requires Node.js 20 or newer and macOS Keychain in this release. Configuration and state live in the platform user-data directory, never the plugin or project directory.

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

The user should obtain their own UID/API key through the service's normal flow. In a local terminal, let them set one process-scoped variable containing `{"uid":"...","apiKey":"..."}` and run setup. Prefer hidden terminal input; never construct the secret in conversation, a request file, shell history, or a command argument. The setup process deletes its in-process copy after parsing and persists it to Keychain. It does not call `get-key` or register a new identity.

## Doctor

Doctor sends `POST /v1/file/check-files` with an empty file list. It checks configuration, network reachability and authentication without creating a note, rotating a key, or uploading an asset. An authentication error means setup must be repaired; do not call `get-key` automatically.
