# Codex Browser Binding Implementation Plan

**Goal:** Add agent-assisted in-app browser binding while retaining manual hidden input.

**Architecture:** Reuse the existing browser setup flow and pending store. Add explicit prepare/complete actions and a project-bound session hash; the Skill handles browser interaction and passes the token through a child environment.

**Tech Stack:** TypeScript, Node.js, Vitest, esbuild; no new dependencies.

## Implementation and validation

- [x] `src/app.ts`: share the existing validation/persistence flow; skip system launch for Codex prepare; return URL/session/expiry; require exact session on completion and reject inline credential fields. Keep existing-profile validation, pending binding checks, locks and project readback.
- [x] `src/cli.ts`: route both actions; support public prepare shortcut; consume process-scoped `SHARE_NOTE_BROWSER_API_KEY` without implicit TTY prompting; offer explicit `--key-tty` for agent terminal input and clear it on all completion paths.
- [x] `tests/contract/browser-setup.test.ts`: exercise prepare/resume/complete, missing and wrong tokens, source mismatch, cross-project session, expiry, replacement, replay and concurrent completion. Assert no credentials/project on failed authentication.
- [x] `tests/contract/browser-cli.test.ts`: exercise the shipped bundle with isolated data directories and a mock service, process environment key transport, no-TTY behavior and safe output.
- [x] `plugins/share-note/skills/share-note/{SKILL.md,references/setup.md,references/security.md}`: document exact browser handoff, user verification, limited page reading, child environment transfer, fallback and exposure boundaries.
- [x] `README.md`, `docs/PROTOCOL.md`, `docs/ACCEPTANCE.md`: describe the new commands and distinguish mock validation from live-service compatibility.
- [x] Rebuild with `npm run bundle`, then run `npm run build` and `git diff --check`. Review changes excluding generated bundle and report actual results. No commit, push, or installed-plugin refresh.
