# Share Note for Codex

Share Note for Codex is a local Codex plugin that previews, publishes, reads, updates, lists, and deletes Share Note pages through a bundled HTTP client. It does not install or call Obsidian, use Obsidian CLI/URI/vault state, start a resident service, or install dependencies at runtime.

Version 0.1.0 targets Node.js 20+ and macOS Keychain. The client writes only user-level state and treats the plugin installation as read-only.

## What is delivered

- Standard manifest at `plugins/share-note/.codex-plugin/plugin.json`
- One routing Skill with task-specific references
- Independent TypeScript HTTP client bundled as `share-note.mjs`
- Repo-local marketplace at `.agents/plugins/marketplace.json`
- Locked build dependencies, mock/contract tests, protocol fixtures, and security/acceptance documentation

There is no MCP server, daemon, background sync, dynamic `npm install`, arbitrary webpage execution, user-attachment upload, or plaintext fallback.

## Build and test

```bash
npm ci
npm run build
```

`npm run build` type-checks, runs all tests, then emits the Node.js bundle into the plugin installation tree. Users installing the built plugin do not run npm.

## Install from this local marketplace

From the repository root:

```bash
codex plugin marketplace add "$(pwd)"
codex plugin add share-note@personal
```

Start a new Codex conversation after install so the Skill is discovered. The repository marketplace is intentionally merged as one `AVAILABLE` / `ON_INSTALL` Productivity entry pointing to `./plugins/share-note`.

## Secure first setup

Copy `examples/setup.request.json` outside the plugin if needed and replace only non-secret service paths. Do not put UID or API key in that JSON.

In a local zsh terminal, use hidden input and a process-scoped environment value:

```bash
read "SHARE_NOTE_UID?Share Note UID: "
read -s "SHARE_NOTE_API_KEY?Share Note API key: "
echo
export SHARE_NOTE_UID SHARE_NOTE_API_KEY
export SHARE_NOTE_CREDENTIAL="$(node -e 'process.stdout.write(JSON.stringify({uid:process.env.SHARE_NOTE_UID,apiKey:process.env.SHARE_NOTE_API_KEY}))')"
node /absolute/path/to/share-note.mjs setup --request /absolute/path/to/setup.request.json
unset SHARE_NOTE_CREDENTIAL SHARE_NOTE_API_KEY SHARE_NOTE_UID
```

The setup process imports the credential to macOS Keychain, deletes its in-process environment entry, and writes only a Keychain reference to the profile. It does not register, rotate, or display a key. Users obtain credentials through the service's legitimate flow.

Then run doctor with a small JSON request containing only the profile. Doctor sends an authenticated empty `check-files` request and never creates a note.

## Actions

Every invocation has this shape:

```bash
node /absolute/path/to/share-note.mjs <action> --request /absolute/path/to/request.json
```

Supported actions are `setup`, `doctor`, `preview`, `publish`, `read`, `update`, `list`, and `delete`. Request files contain paths, record IDs, hashes, and explicit write authorization—not secrets or note bodies.

Publishing and updating always require a fresh preview and exact hash-bound authorization. Encrypted publication is the only write mode. The client persists a note key reference and pending operation before the first create request, never blindly retries ambiguous writes, and reports one of `verified`, `submitted_unverified`, `unknown`, `failed`, `blocked`, or `already_absent`.

`list` is explicitly local-only. Delete keeps the local source and audit record. Images and other user attachments block publication because Share Note body encryption does not cover them.

## Runtime data

On macOS the default directory is `~/Library/Application Support/codex-share-note/`, with mode-restricted profiles, previews, operations, locks, and records. Credentials and note keys are in Keychain. `SHARE_NOTE_DATA_DIR` exists for isolated tests and controlled environments; it is not a secret-store fallback.

## Protocol and test status

The frozen profile and upstream commits are recorded in `docs/PROTOCOL.md`. Security boundaries are in `docs/SECURITY.md`; A01–A22 results are in `docs/ACCEPTANCE.md`.

All reported remote-flow tests use the in-process mock service and deterministic protocol fixtures. **No real service credential was provided, so public/self-hosted target-instance doctor, publish, update, delete, CDN behavior, clean-machine marketplace install, and online compatibility were not executed. No release or marketplace publication is claimed.**
