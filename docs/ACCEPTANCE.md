# Acceptance report

Date: 2026-09-02
Target package: Share Note for Codex 0.1.0  
Protocol profile: `note-sx-client-1.5.5`

## Test environment and meaning

The automated suite uses Node.js, frozen page-ciphertext fixtures, temporary user-data/workspace directories, an in-memory SecretStore, the production plaintext-file SecretStore, and an in-process mock that implements the audited Share Note wire behavior. The distributable client stores API credentials and note keys as plaintext private files on Windows, Linux, and macOS and has no master-password or Keychain dependency.

`npm run build` performs TypeScript checking, all tests, and the precompiled bundle build. The current local suite contains 61 passing tests across unit, contract and clean-bundle acceptance layers, including browser setup and shipped-bundle checks. The routing Skill and bundle were rebuilt from this source.

“Mock passed” proves local client behavior against the recorded contract; it is not evidence about a public or self-hosted service instance.

## A01–A23

| ID | Result | Evidence and limits |
|---|---|---|
| A01 | Local package passed; actual Codex install not executed | Bundle was copied to a clean temp directory with no `node_modules` and ran successfully. Source/bundle scan found no Obsidian integration or resident server. Marketplace installation itself remains unexecuted. |
| A02 | Passed | Missing credential fails with `credential_missing`, sends no request, and does not ask for chat plaintext or auto-register. |
| A03 | Passed by routing/static checks | Routing Skill explicitly says content creation is not upload authorization; no generic content-generation action exists in the client. |
| A04 | Passed | Preview tests show zero network requests; embedded resources block publication. |
| A05 | Passed | Chinese, emoji, table, fenced code and a surrogate pair at the chunk boundary round-trip. |
| A06 | Mock passed; live not executed | Raw mock page contains ciphertext rather than body plaintext; complete fragment URL decrypts and read-back hash matches. |
| A07 | Passed | Missing/wrong keys fail explicitly and do not return an empty note or plaintext fallback. |
| A08 | Passed | Frozen modern, 1.4.2 and 1.1.3 fixtures decrypt; unknown payload shape fails explicitly. Historical codecs are read-only. |
| A09 | Mock passed | Update preserves base URL and key, changes ciphertext and every tested IV, then verifies the new content hash. |
| A10 | Mock passed | Missing original blocks before write; a different returned URL is recorded as failure, not in-place success. |
| A11 | Mock passed | Dropped create response returns `unknown`; exactly one create request is observed and the operation remains recoverable. |
| A12 | Mock passed | `success: true` with a still-readable page returns `submitted_unverified`. |
| A13 | Mock passed | Already absent returns `already_absent`, sends no second delete, and preserves source. |
| A14 | Mock passed | Bounded cache lag can verify later; unresolved visibility and lost responses remain unverified/unknown. |
| A15 | Passed | Origin-isolation tests reject cross-origin redirect/fallback; no second request is sent. |
| A16 | Passed | Markdown HTML is escaped, explicit/fetched HTML is sanitized, dangerous resources block, and a symlink escaping allowed roots is rejected. |
| A17 | Passed | Production-store tests round-trip credentials and note keys, verify that plaintext is intentionally persisted only in the secret files, check private POSIX modes, reject malformed files, and keep credentials out of ordinary results. |
| A18 | Mock passed | Concurrent updates to one record produce at most one active create request and leave one valid state record. |
| A19 | Policy/local behavior passed; real upgrade/uninstall not executed | Runtime data is outside the plugin tree; source, key references and audit record are preserved on delete. Actual Codex upgrade/uninstall remains unexecuted. |
| A20 | Packaging passed; install/new-session unexecuted | Manifest, route Skill, bundle and marketplace validate; clean bundle has no runtime install. Actual marketplace add/plugin add/new-session trigger was not run. |
| A21 | Passed | Output has `scope: local`, hides key references and warns that results are not a complete remote inventory. |
| A22 | Passed by client/Skill boundary | Fetched scripts are removed; no content execution path exists; Skill says remote instructions are untrusted data and must not be followed. |
| A23 | Local browser-setup coverage passed; live acceptance pending | Unit and contract coverage exercises direct macOS/Windows/Linux browser command arguments, URL construction, frozen public origins, independently confirmed self-hosted origins, pending expiry/cancellation/duplicate completion, bad keys, no fallback, hidden-input non-echo behavior, plaintext secret-file permissions, result redaction, and the shipped bundle. The test uses a fake launcher and in-process mock; it does not claim live target compatibility. |

## Commands and outcomes

```text
npm run typecheck  -> passed
npm test           -> 11 files, 62 tests passed
npm run bundle     -> built plugins/share-note/skills/share-note/scripts/share-note.mjs
plugin validator   -> passed in the earlier package baseline; not rerun for this browser-setup change
plaintext secret-store round-trip/permissions/malformed-file tests -> passed
Windows/Linux/macOS data-directory branch tests -> passed
browser setup unit/contract/leakage/bundle tests -> passed
```

## Explicitly not executed

- No real Share Note credential was supplied to the automated test suite.
- Automated acceptance did not perform a public or self-hosted browser authorization, human verification, target-instance doctor, encrypted publish, or verified remote read-back. Mock results are not substitutes.
- No public or self-hosted target-instance doctor, publish, read-back, update or delete was performed.
- CDN timing on a real deployment was not measured.
- `codex plugin marketplace add`, plugin installation, new-session discovery, upgrade and uninstall were not run.
- No release, external marketplace publication, or production readiness claim was made.
- Native Windows and Linux Codex runs were not available in this environment; cross-platform compatibility was verified by standard-library-only implementation, platform-path branch tests, and clean Node bundle execution on macOS.
