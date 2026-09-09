// Independent adaptation of Obsidian's default light reading view.
// Article appearance only: no application stylesheet, assets, or special syntax.
export const obsidianCss = `
.share-note-article[data-share-note-theme="obsidian"] {
  color-scheme: light;
  background: #ffffff;
  color: #222222;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.5;
  max-width: 764px;
  padding: 32px 32px 64px;
}
.share-note-article[data-share-note-theme="obsidian"] h1,
.share-note-article[data-share-note-theme="obsidian"] h2,
.share-note-article[data-share-note-theme="obsidian"] h3,
.share-note-article[data-share-note-theme="obsidian"] h4,
.share-note-article[data-share-note-theme="obsidian"] h5,
.share-note-article[data-share-note-theme="obsidian"] h6 { font-weight: 600; line-height: 1.3; margin: 1.5em 0 .5em; }
.share-note-article[data-share-note-theme="obsidian"] h1 { font-size: 1.802em; font-weight: 700; }
.share-note-article[data-share-note-theme="obsidian"] h2 { font-size: 1.602em; }
.share-note-article[data-share-note-theme="obsidian"] h3 { font-size: 1.424em; }
.share-note-article[data-share-note-theme="obsidian"] h4 { font-size: 1.266em; }
.share-note-article[data-share-note-theme="obsidian"] h5 { font-size: 1.125em; }
.share-note-article[data-share-note-theme="obsidian"] h6 { font-size: 1em; color: #666666; }
.share-note-article[data-share-note-theme="obsidian"] .share-note-content > :first-child { margin-top: 0; }
.share-note-article[data-share-note-theme="obsidian"] p,
.share-note-article[data-share-note-theme="obsidian"] ul,
.share-note-article[data-share-note-theme="obsidian"] ol { margin-bottom: 1em; }
.share-note-article[data-share-note-theme="obsidian"] li + li { margin-top: .15em; }
.share-note-article[data-share-note-theme="obsidian"] li::marker { color: #666666; }
.share-note-article[data-share-note-theme="obsidian"] a { color: #7852ee; text-decoration: underline; }
.share-note-article[data-share-note-theme="obsidian"] a:focus-visible { outline: 2px solid #7852ee; outline-offset: 2px; }
.share-note-article[data-share-note-theme="obsidian"] blockquote { border-left: 2px solid #7852ee; padding: 0 0 0 1.5em; color: #222222; }
.share-note-article[data-share-note-theme="obsidian"] blockquote > :last-child { margin-bottom: 0; }
.share-note-article[data-share-note-theme="obsidian"] code,
.share-note-article[data-share-note-theme="obsidian"] pre { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; }
.share-note-article[data-share-note-theme="obsidian"] :not(pre) > code { color: #7852ee; background: #f5f5f5; border-radius: 4px; padding: .1em .25em; font-size: .875em; }
.share-note-article[data-share-note-theme="obsidian"] pre { background: #f5f5f5; border: 0; border-radius: 4px; padding: 16px; font-size: .875em; line-height: 1.5; }
.share-note-article[data-share-note-theme="obsidian"] th { background: #f5f5f5; font-weight: 600; }
.share-note-article[data-share-note-theme="obsidian"] th,
.share-note-article[data-share-note-theme="obsidian"] td { border: 1px solid #e0e0e0; padding: 6px 10px; }
.share-note-article[data-share-note-theme="obsidian"] tr:nth-child(2n) { background: #fafafa; }
.share-note-article[data-share-note-theme="obsidian"] hr { border-top: 1px solid #e0e0e0; margin: 2em 0; }
@media (max-width: 640px) {
  .share-note-article[data-share-note-theme="obsidian"] { padding: 24px 20px 48px; }
}
`
