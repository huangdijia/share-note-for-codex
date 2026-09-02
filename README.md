# Share Note for Codex

Share Note for Codex is a local Codex plugin that previews, publishes, reads, updates, lists, and deletes Share Note pages through a bundled HTTP client. It does not install or call Obsidian, use Obsidian CLI/URI/vault state, start a resident service, or install dependencies at runtime.

Version 0.1.0 targets Node.js 20+ on Windows, Linux, and macOS. Secrets are stored in a local encrypted vault backed only by Node.js standard cryptography; the client does not use macOS Keychain or any platform credential manager. The client writes only user-level state and treats the plugin installation as read-only.

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

The vault master password must contain at least 16 characters. It is never saved by the plugin and must be supplied again for every new process that reads or writes a credential or note key.

On Linux with Bash, use hidden input and process-scoped environment values:

```bash
read -r -p "Share Note UID: " SHARE_NOTE_UID
read -r -s -p "Share Note API key: " SHARE_NOTE_API_KEY; printf '\n'
export SHARE_NOTE_UID SHARE_NOTE_API_KEY
export SHARE_NOTE_CREDENTIAL="$(node -e 'process.stdout.write(JSON.stringify({uid:process.env.SHARE_NOTE_UID,apiKey:process.env.SHARE_NOTE_API_KEY}))')"
unset SHARE_NOTE_API_KEY SHARE_NOTE_UID
read -r -s -p "Vault master password: " SHARE_NOTE_MASTER_PASSWORD; printf '\n'
export SHARE_NOTE_MASTER_PASSWORD
node /absolute/path/to/share-note.mjs setup --request /absolute/path/to/setup.request.json
unset SHARE_NOTE_CREDENTIAL SHARE_NOTE_MASTER_PASSWORD
```

On Windows PowerShell, use `Read-Host -AsSecureString` and clear the process environment after setup:

```powershell
function ConvertTo-PlainText([Security.SecureString]$Value) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
$uid = Read-Host "Share Note UID"
$apiKey = ConvertTo-PlainText (Read-Host "Share Note API key" -AsSecureString)
$masterPassword = ConvertTo-PlainText (Read-Host "Vault master password" -AsSecureString)
$env:SHARE_NOTE_CREDENTIAL = @{ uid = $uid; apiKey = $apiKey } | ConvertTo-Json -Compress
$env:SHARE_NOTE_MASTER_PASSWORD = $masterPassword
node C:\absolute\path\to\share-note.mjs setup --request C:\absolute\path\to\setup.request.json
Remove-Item Env:\SHARE_NOTE_CREDENTIAL -ErrorAction SilentlyContinue
Remove-Item Env:\SHARE_NOTE_MASTER_PASSWORD -ErrorAction SilentlyContinue
$uid = $apiKey = $masterPassword = $null
```

The setup process encrypts the credential with scrypt and AES-256-GCM, deletes both imported environment entries from its in-process environment, and writes only an encrypted-file reference to the profile. It does not register, rotate, or display a key. Users obtain credentials through the service's legitimate flow.

Then run doctor with a small JSON request containing only the profile. Doctor sends an authenticated empty `check-files` request and never creates a note.

## Actions

Every invocation has this shape:

```bash
node /absolute/path/to/share-note.mjs <action> --request /absolute/path/to/request.json
```

Supported actions are `setup`, `doctor`, `preview`, `publish`, `read`, `update`, `list`, and `delete`. Request files contain paths, record IDs, hashes, and explicit write authorization—not secrets or note bodies.

Set `SHARE_NOTE_MASTER_PASSWORD` immediately before `doctor`, `publish`, `update`, `delete`, or `read` by local record ID, then remove it from the shell environment. `setup` also requires it. `preview`, `list`, and `read` with a complete URL do not access the vault.

Publishing and updating always require a fresh preview and exact hash-bound authorization. Encrypted publication is the only write mode. The client persists a note key reference and pending operation before the first create request, never blindly retries ambiguous writes, and reports one of `verified`, `submitted_unverified`, `unknown`, `failed`, `blocked`, or `already_absent`.

`list` is explicitly local-only. Delete keeps the local source and audit record. Images and other user attachments block publication because Share Note body encryption does not cover them.

## Runtime data

The default user-data directory is:

- Windows: `%APPDATA%\codex-share-note\`
- Linux: `$XDG_DATA_HOME/codex-share-note/`, or `~/.local/share/codex-share-note/`
- macOS: `~/Library/Application Support/codex-share-note/`

Profiles, previews, operations, locks, records, and the encrypted credential/note-key vault live there. Each secret uses a random salt and IV, scrypt (`N=32768`, `r=8`, `p=1`) and AES-256-GCM with reference-bound authenticated data. Files are created privately and atomically; Windows also relies on the current user's data-directory ACL because POSIX modes are not available there. `SHARE_NOTE_DATA_DIR` changes the whole user-data location for isolated tests and controlled environments; it does not disable encryption.

The master password is intentionally unrecoverable. Losing it requires rerunning setup and republishing or recovering note keys from complete share URLs retained elsewhere. Existing schema-v1 profiles that referenced macOS Keychain are not imported or read; rerun setup to create a schema-v2 encrypted-vault profile. The plugin leaves any old Keychain entries untouched.

## Protocol and test status

The frozen profile and upstream commits are recorded in `docs/PROTOCOL.md`. Security boundaries are in `docs/SECURITY.md`; A01–A22 results are in `docs/ACCEPTANCE.md`.

All reported remote-flow tests use the in-process mock service and deterministic protocol fixtures. **No real service credential was provided, so public/self-hosted target-instance doctor, publish, update, delete, CDN behavior, clean-machine marketplace install, and online compatibility were not executed. No release or marketplace publication is claimed.**
