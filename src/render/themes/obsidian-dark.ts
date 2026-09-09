// Independent adaptation of Obsidian's default dark reading view.
// Article appearance only: no application stylesheet, assets, or special syntax.
export const obsidianDarkCss = `
.share-note-article[data-share-note-theme="obsidian-dark"] {
  color-scheme: dark;
  background: #1e1e1e;
  color: #dadada;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.5;
  max-width: 764px;
  padding: 32px 32px 64px;
}
.share-note-article[data-share-note-theme="obsidian-dark"] h1,
.share-note-article[data-share-note-theme="obsidian-dark"] h2,
.share-note-article[data-share-note-theme="obsidian-dark"] h3,
.share-note-article[data-share-note-theme="obsidian-dark"] h4,
.share-note-article[data-share-note-theme="obsidian-dark"] h5,
.share-note-article[data-share-note-theme="obsidian-dark"] h6 { font-weight: 600; line-height: 1.3; margin: 1.5em 0 .5em; }
.share-note-article[data-share-note-theme="obsidian-dark"] h1 { font-size: 1.802em; font-weight: 700; }
.share-note-article[data-share-note-theme="obsidian-dark"] h2 { font-size: 1.602em; }
.share-note-article[data-share-note-theme="obsidian-dark"] h3 { font-size: 1.424em; }
.share-note-article[data-share-note-theme="obsidian-dark"] h4 { font-size: 1.266em; }
.share-note-article[data-share-note-theme="obsidian-dark"] h5 { font-size: 1.125em; }
.share-note-article[data-share-note-theme="obsidian-dark"] h6 { font-size: 1em; color: #b3b3b3; }
.share-note-article[data-share-note-theme="obsidian-dark"] .share-note-content > :first-child { margin-top: 0; }
.share-note-article[data-share-note-theme="obsidian-dark"] p,
.share-note-article[data-share-note-theme="obsidian-dark"] ul,
.share-note-article[data-share-note-theme="obsidian-dark"] ol { margin-bottom: 1em; }
.share-note-article[data-share-note-theme="obsidian-dark"] li + li { margin-top: .15em; }
.share-note-article[data-share-note-theme="obsidian-dark"] li::marker { color: #b3b3b3; }
.share-note-article[data-share-note-theme="obsidian-dark"] a { color: #a88bfa; text-decoration: underline; }
.share-note-article[data-share-note-theme="obsidian-dark"] a:focus-visible { outline: 2px solid #a88bfa; outline-offset: 2px; }
.share-note-article[data-share-note-theme="obsidian-dark"] blockquote { border-left: 2px solid #a88bfa; padding: 0 0 0 1.5em; color: #dadada; }
.share-note-article[data-share-note-theme="obsidian-dark"] blockquote > :last-child { margin-bottom: 0; }
.share-note-article[data-share-note-theme="obsidian-dark"] code,
.share-note-article[data-share-note-theme="obsidian-dark"] pre { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; }
.share-note-article[data-share-note-theme="obsidian-dark"] :not(pre) > code { color: #a88bfa; background: #262626; border-radius: 4px; padding: .1em .25em; font-size: .875em; }
.share-note-article[data-share-note-theme="obsidian-dark"] pre { background: #262626; border: 0; border-radius: 4px; padding: 16px; font-size: .875em; line-height: 1.5; }
.share-note-article[data-share-note-theme="obsidian-dark"] th { background: #262626; font-weight: 600; }
.share-note-article[data-share-note-theme="obsidian-dark"] th,
.share-note-article[data-share-note-theme="obsidian-dark"] td { border: 1px solid #404040; padding: 6px 10px; }
.share-note-article[data-share-note-theme="obsidian-dark"] tr:nth-child(2n) { background: #2a2a2a; }
.share-note-article[data-share-note-theme="obsidian-dark"] hr { border-top: 1px solid #404040; margin: 2em 0; }
@media (max-width: 640px) {
  .share-note-article[data-share-note-theme="obsidian-dark"] { padding: 24px 20px 48px; }
}
`
