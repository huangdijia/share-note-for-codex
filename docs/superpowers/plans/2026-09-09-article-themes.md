# Share Note article themes implementation plan

**Goal:** Deliver four bundled article themes with project defaults, per-preview overrides, legacy compatibility and evidence-bounded verification.

**Architecture:** Sanitize source HTML first, then wrap it in a trusted, scoped article theme. Encrypt and hash that exact fragment; preview adds only a document shell. Read-back hashes raw decrypted content while human-readable HTML and Markdown remain sanitized.

**Tech stack:** Existing TypeScript, marked, sanitize-html, parse5, Vitest and esbuild. No new runtime dependencies.

The source-task design and implementation contract are already approved. Work stays in this isolated worktree; no commits, pushes, credential copying or real publication are authorized by this plan.

## Execution and verification

- [x] Add `src/render/themes.ts`, integrate `src/render/renderer.ts`, retire the unused article CSS. Four themes use system fonts and scoped styles; code and tables scroll locally. Verify deterministic fragments, distinct hashes and unchanged source blocking.
- [x] Extend `src/project.ts`, `src/state/store.ts`, `src/preview.ts`, `src/app.ts` and `src/cli.ts`. Defaults apply to new shares; record-bound update previews preserve themes and legacy unthemed bodies. Reject invalid themes, stale previews and mismatched targets before writes. Verify project state preservation.
- [x] Update `src/read/page.ts`, `src/publish.ts`, `src/manage.ts`. Match hashes on raw decrypted fragments while sanitizing reading output. Verify encrypted CSS, content/CSS tampering, updates and Markdown without CSS text using the mock service.
- [x] Update README, plugin Skill/references and request examples. Ordinary shares need no extra theme question. Build using `npm run build`, then test the newly emitted bundle with `npm test` and an isolated non-network preview fixture.
- [x] Render one bilingual fixture with headings, lists, quotations, wide tables and long code across all themes at desktop and narrow widths. Inspect screenshots and overflow measurements; keep artifacts reproducible.
- [x] Run `git diff --check`; report automated/local visual results separately from real service compatibility. Real online acceptance requires an explicitly authorized dedicated test article and legitimate access; never alter existing shares.

Online acceptance remains pending: no dedicated test publication/access authorization in this task. The overall goal is not complete until that evidence exists.
