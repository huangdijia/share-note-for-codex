# One-command token binding Implementation Plan

**Goal:** Run browser authorization, credential validation and project binding in one command, with one hidden token entry.

**Architecture:** Keep the existing two-step commands as recovery tools. Add a `setup-browser` orchestration method and CLI shortcut; reuse trusted profiles and resume matching pending authorization. Validate newly entered credentials against the empty doctor endpoint before persisting them. Keep human verification and token copying local.

**Tech Stack:** TypeScript, Node.js built-ins, existing Share Note HTTP client and Vitest mock server. No new dependencies.

User approved this design on 2026-09-09 and requested immediate implementation for a trial. Work remains uncommitted on a feature branch.

1. Add contract cases in `tests/contract/browser-setup.test.ts`: successful single-command binding, valid-profile reuse, matching pending resume, wrong token followed by successful retry, source mismatch, project conflict, expiry and no-TTY preflight. Verify wrong tokens never create a profile or replace existing credentials.
2. In `src/config.ts` and `src/project.ts`, distinguish missing configuration from corrupt/unsafe configuration. Add a non-rebinding project configuration option, enforced under the existing manifest lock.
3. In `src/state/pending-setup.ts`, expose an expiry-aware pending lookup and optionally check the expected binding hash during completion. Reuse only matching profile fields; do not display pending UID or URL.
4. In `src/app.ts`, share browser profile validation, verify credentials before saving, and orchestrate setup with injectable input/preflight callbacks. Reuse valid profiles without generating new identities; do not automatically replace existing invalid credentials. On retry retain the same pending UID, and on source mismatch fail before reading token input.
5. In `src/cli.ts` and `src/platform/hidden-input.ts`, add `setup-browser` with a no-request public-service shortcut for the current directory. Check TTY capability before opening a new browser. Keep prompts on stderr and secrets out of results, requests and arguments.
6. Update README, plugin setup reference, protocol/security notes and a sample request. Run `npm run typecheck`, focused browser tests, then bundle and the full suite so acceptance tests exercise the newly built artifact. Review `git diff --check` and the final diff.

Acceptance: only an authenticated token produces a successful project binding; subsequent identical calls require neither a browser nor input; failed input can resume without another authorization launch. No real-service authorization or publishing occurs as part of automated verification.

## Verification and revised entry-point request

The one-command implementation passed TypeScript checking, all 87 tests in 13 files, and `git diff --check`. The plugin bundle was rebuilt before the final suite. No real credentials were used.

The user subsequently requested a native plugin-detail **Connect** button that opens Share Note authorization and displays a token field. This is now the desired primary entry point; the terminal workflow is only a working fallback. No native Connect button has been implemented or claimed.

Current integration evidence:

- The installed Gmail package's `.app.json` declares a required, already-registered connector ID. Its plugin manifest references that companion file; it does not define a custom connection form.
- [Official packaging instructions](https://developers.openai.com/plugins/build/plugins) require registering the MCP server in developer mode before referencing its `plugin_asdk_app...` ID from `.app.json`. An invented ID or arbitrary manifest field cannot supply that connection.
- [Official authentication instructions](https://developers.openai.com/plugins/build/auth) describe MCP OAuth 2.1 with authorization metadata and PKCE. Share Note's currently implemented `get-key` page is not an OAuth authorization-code/token service.

Implementing a native connection therefore requires a supported connector/authentication integration, or a host extension point verified against the installed Codex build. A separate local browser token form is a possible alternative, but does not by itself create the requested native detail-page button. Do not substitute that alternative silently.
