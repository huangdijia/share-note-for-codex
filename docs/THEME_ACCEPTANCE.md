# Article theme acceptance

Date: 2026-09-09. Current scope: ten bundled article themes, including six new
GitHub, Typora and Obsidian article styles. All results below are local evidence;
no real Share Note article was published or updated.

## Reproduce

```bash
npm ci
npm run bundle
npm run build
node scripts/verify-themes.mjs /absolute/path/to/local-artifacts
git diff --check
```

Package acceptance executes the existing bundle, so bundle before running build.
The visual script requires an already available Playwright installation. Set
`PLAYWRIGHT_MODULE` to its absolute module path when it is outside this checkout;
optionally set `CHROME_EXECUTABLE` to an existing Chromium/Chrome binary. Neither
is a plugin runtime dependency.

The script reads the bundled CLI's theme catalog, creates a temporary project and
user-data directory with synthetic credentials and `.invalid` service origins,
and renders `examples/theme-fixture.md`. It blocks all browser network requests,
checks each theme at 1440 and 375 CSS pixels, and removes temporary project and
credential state. Output: ten HTML previews, twenty PNG screenshots, `index.html`
and `metrics.json`. The fixture includes Chinese/English, headings H1–H6, nested
lists, emphasis, deletion, links, quotes, inline code, long code and a wide table.

## Current local results

- `npm run bundle` and `npm run build` passed: strict typecheck, 15 test files /
  131 tests, then bundle generation.
- The clean-bundle test lists all ten IDs, names and descriptions with default
  `simple`, without a project, credentials or `node_modules`.
- Each new theme passes configure/default-preview, encrypted publish/decode/hash
  verification, CSS removal from read output, record-theme preservation on update,
  and hash change on an explicit theme switch.
- Original four theme CSS SHA-256 baselines are unchanged byte for byte. Existing
  preview tampering, record binding and legacy unthemed regressions remain passing.
- All twenty viewport checks passed: no full-page horizontal overflow, long code
  and narrow-screen wide tables scroll locally, and no remote requests occurred.
- Host typography injected after the article CSS did not change checked colors,
  fonts, line heights or backgrounds, including all six heading levels and links.
- All twenty screenshots were visually inspected at both widths. For the six new themes, text, hierarchy, spacing,
  tables and code remain readable; the GitHub/Typora GitHub layouts are distinct,
  Newsprint uses serif paper styling, and both Obsidian variants retain purple accents.
- Ten themes produce ten distinct content hashes for the same fixture.
- `git diff --check` passed.

Measured at a 1440px viewport (all narrow article widths are 375px):

| Theme | Article width | Background | Text |
| --- | ---: | --- | --- |
| `simple` | 860 | `rgb(255, 255, 255)` | `rgb(32, 33, 36)` |
| `technical` | 1080 | `rgb(255, 255, 255)` | `rgb(23, 32, 51)` |
| `reading` | 740 | `rgb(251, 247, 239)` | `rgb(52, 46, 39)` |
| `dark` | 900 | `rgb(22, 27, 34)` | `rgb(230, 237, 243)` |
| `github` | 980 | `rgb(255, 255, 255)` | `rgb(31, 35, 40)` |
| `typora-github` | 860 | `rgb(255, 255, 255)` | `rgb(51, 51, 51)` |
| `typora-newsprint` | 840 | `rgb(243, 242, 238)` | `rgb(31, 9, 9)` |
| `typora-night` | 1024 | `rgb(54, 59, 64)` | `rgb(184, 191, 198)` |
| `obsidian` | 764 | `rgb(255, 255, 255)` | `rgb(34, 34, 34)` |
| `obsidian-dark` | 764 | `rgb(30, 30, 30)` | `rgb(218, 218, 218)` |

## Source and adaptation boundary

The `github` article rules derive from `github-markdown-css` commit
`e49401776c9d581ad42367fc4ea3d677d13e2e39`, with its MIT license and adaptation notes
in `THIRD_PARTY_NOTICES.md` and the packaged copy; the rendered GitHub CSS also
carries the MIT notice for standalone previews and published fragments. Typora and Obsidian styles are
independent visual adaptations, not bundled application stylesheets.

Only supported sanitized article elements are styled. Downloaded fonts, image
masks, editor controls, syntax highlighting and product-specific Markdown
extensions are excluded. Local font fallbacks may differ across platforms.
The original four themes and `simple` system default remain unchanged.

## Live acceptance outstanding

Local previews and generic host-style stress checks do not replicate the live
service stylesheet or its post-decryption initialization. Public/self-hosted
publication, online cascade, online update and CDN behavior remain unverified.

A future live check requires a dedicated test article and explicitly authorized
service access through the normal setup flow. Preview and publish the fixture,
inspect each theme at desktop/narrow widths through authorized theme updates,
and verify decrypted content hashes after writes. Delete only if cleanup is
authorized; do not use an existing production share for this test.
