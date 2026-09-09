# Setup and doctor

The client requires Node.js 20 or newer and supports Windows, Linux, and macOS. Trusted profiles, API credentials, previews, locks, and pending browser setup live in the platform user-data directory, never the plugin directory. Project profile bindings, records, and operations live in `.openai/share-note.json`; plaintext per-note keys live in the ignored `.openai/share-note.keys.json`. The client does not use a master password, Keychain, or another OS credential manager.

## One-command browser setup (recommended)

Prepare one non-secret request with `profile`, `service` and the exact absolute `projectRoot`, then call `setup-browser` in a user-accessible interactive local terminal. For public setup:

```json
{
  "profile": "public",
  "service": "public",
  "projectRoot": "/absolute/path/to/project"
}
```

`allowedSourceRoots` is optional: it preserves an existing profile's roots or defaults a new profile to `projectRoot`. Include it explicitly to restrict a new profile to a docs directory. For self-hosting use the independently confirmed origins below, with `projectRoot` added.

The public-service shortcut `node <absolute-client-path> setup-browser` uses the terminal's current directory and the `public` profile. Only use this shortcut when its service, profile and project match the user's request.

The command checks configuration, reuses a valid existing credential or resumes a matching unexpired authorization, and opens the browser only when a new authorization is needed. The user completes human verification and pastes the API key into the hidden local terminal prompt. The command validates authentication before saving, then binds the project automatically. Interactive wrong-key input may be retried up to three times without opening another authorization page.

Do not ask the user to run separate completion, doctor or configure-project steps after successful `setup-browser`. Interpret `authentication: "accepted"` and `status: "configured"` as successful authentication and local project binding, not a verified publication. `reusedCredential` and `resumed` describe whether existing credentials or pending authorization were reused.

Keep the terminal accessible for the user to type directly; never send the token through a Codex message or tool argument. If no interactive terminal is available, the client stops before opening a new browser. Provide the same command for the user's terminal. For an interruption, wrong key or transient network failure, rerun the same request; it resumes matching unexpired pending state. Explicit cancellation still uses `setup-browser-complete` with `cancel: true`.

Do not retry authentication failure for an existing saved profile by generating a new identity. Do not change service origins, allowed roots, or another project binding to make setup pass. If saving credentials succeeded but project binding failed, fix the local project issue and rerun the same command; the credential is reused.

## Two-step browser setup (recovery)

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

After the user completes the normal human verification in the browser, call `setup-browser-complete` with `{ "profile": "..." }`. The local client prompts on the user's TTY with non-echoing input for the displayed API key, verifies authentication against the bound API origin, then stores it as plaintext in a private local file. The client does not automate Turnstile, read the browser, read the clipboard, consume an `obsidian://` callback, or expose the key in an output. Use `{ "profile": "...", "cancel": true }` to delete a pending setup without prompting.

Pending setup is removed after successful completion, explicit cancellation, browser-launch failure, or on the next access after expiry. A missing, changed, expired, or already-consumed pending record fails closed during completion. A wrong key is not saved and leaves an unexpired pending record available for another attempt. `setup-browser` resumes a matching record or starts a new authorization after expiry; it never switches service origins.

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

## Project configuration

After setup, call `configure-project` with an absolute `projectRoot` and an existing `profile`. It creates `.openai/share-note.json` and ensures `.openai/.gitignore` contains `share-note.keys.json`. The project manifest may select a trusted profile but cannot define origins, credential references, or allowed source roots. Use `importLegacyRecords: true` only when the user asks to copy matching legacy records and keys into this project; the originals remain untouched.
