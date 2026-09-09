# Repository Guidelines

## Project Structure & Module Organization

Share Note is a Node.js 20+ TypeScript HTTP client distributed as a local Codex plugin.

- `src/cli.ts` and `src/app.ts` handle command dispatch; adjacent modules implement preview, publication, and management.
- `src/protocol/`, `crypto/`, `http/`, `render/`, `state/`, and `secrets/` separate protocol, encryption, transport, rendering, persistence, and credentials.
- `plugins/share-note/` contains the plugin manifest, routing skill, references, and generated client bundle. `.agents/plugins/marketplace.json` registers the local marketplace entry.
- `tests/` contains unit, contract, and package acceptance tests, shared helpers, and protocol fixtures.
- `examples/` provides request JSON and Markdown fixtures; `docs/` documents protocol, security, and acceptance criteria.

## Build, Test, and Development Commands

- `npm ci`: install locked development dependencies.
- `npm run typecheck`: check strict TypeScript without emitting files.
- `npm test`: run all Vitest tests once.
- `npm run test:unit` / `npm run test:contract`: run focused suites.
- `npm run bundle`: generate `plugins/share-note/skills/share-note/scripts/share-note.mjs` with esbuild and copy license notices.
- `npm run build`: type-check, run tests, then bundle.
- `node plugins/share-note/skills/share-note/scripts/share-note.mjs themes`: exercise the bundled CLI without credentials.

Package acceptance tests execute the existing bundle. After source changes, run `npm run bundle` before `npm run build` to test the updated artifact. Edit source files rather than generated JavaScript.

## Coding Style & Naming Conventions

Use two-space indentation, single quotes, and no semicolons. Follow strict TypeScript and NodeNext ESM conventions, including `.js` extensions in relative imports. Use camelCase for functions and variables, PascalCase for types, and descriptive kebab-case filenames. No formatter or lint script is configured; match surrounding code.

## Testing Guidelines

Name tests `*.test.ts` and use Vitest `describe`/`it` blocks describing observable behavior. Add regression coverage for changed behavior and reuse mock servers and fixtures. Keep tests isolated from live credentials and services. No numerical coverage threshold is configured. Run a single file with `npx vitest run tests/unit/protocol.test.ts`.

## Commit & Pull Request Guidelines

Recent history favors Conventional Commits, such as `feat(themes): ...` and `docs(readme): ...`, with Chinese or English summaries. Keep commits focused. PRs should explain behavior changes, link relevant issues, and report validation results; include screenshots for rendered theme changes. Update both READMEs when user-facing instructions change.

## Security & Configuration

Keep API keys and note keys out of request files, logs, and commits. Preserve source-root restrictions, preview-bound write authorization, and ambiguous-write safeguards. Consult `docs/SECURITY.md` before changing authentication or publication behavior.
