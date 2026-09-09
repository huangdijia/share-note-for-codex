// Independent adaptation of Typora Night's blue-grey reading appearance.
export const typoraNightCss = `
.share-note-article[data-share-note-theme="typora-night"] {
  color-scheme: dark;
  background: #363b40;
  color: #b8bfc6;
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.625;
  max-width: 914px;
  padding: 32px 40px 72px;
}
.share-note-article[data-share-note-theme="typora-night"] h1,
.share-note-article[data-share-note-theme="typora-night"] h2,
.share-note-article[data-share-note-theme="typora-night"] h3,
.share-note-article[data-share-note-theme="typora-night"] h4,
.share-note-article[data-share-note-theme="typora-night"] h5,
.share-note-article[data-share-note-theme="typora-night"] h6 { color: #dedede; font-weight: 600; margin: 1.4em 0 .65em; }
.share-note-article[data-share-note-theme="typora-night"] h1 { font-size: 2.25em; }
.share-note-article[data-share-note-theme="typora-night"] h2 { font-size: 1.75em; }
.share-note-article[data-share-note-theme="typora-night"] h3 { font-size: 1.5em; }
.share-note-article[data-share-note-theme="typora-night"] h4 { font-size: 1.25em; }
.share-note-article[data-share-note-theme="typora-night"] h5 { font-size: 1em; }
.share-note-article[data-share-note-theme="typora-night"] h6 { font-size: .875em; color: #b8bfc6; }
.share-note-article[data-share-note-theme="typora-night"] .share-note-content > :first-child { margin-top: 0; }
.share-note-article[data-share-note-theme="typora-night"] a { color: #a3d5fe; text-decoration: none; }
.share-note-article[data-share-note-theme="typora-night"] a:hover { text-decoration: underline; }
.share-note-article[data-share-note-theme="typora-night"] blockquote { color: #a8b1ba; border-left: 4px solid #707d8a; padding: .2em 1em; }
.share-note-article[data-share-note-theme="typora-night"] blockquote > :last-child { margin-bottom: 0; }
.share-note-article[data-share-note-theme="typora-night"] code,
.share-note-article[data-share-note-theme="typora-night"] pre { font-family: Menlo, Monaco, Consolas, monospace; }
.share-note-article[data-share-note-theme="typora-night"] :not(pre) > code { background: #2e3338; color: #d1d8df; border-radius: 3px; font-size: .9em; }
.share-note-article[data-share-note-theme="typora-night"] pre { background: #2e3338; color: #d1d8df; border: 1px solid #464c53; border-radius: 3px; padding: 16px; font-size: .9em; line-height: 1.6; }
.share-note-article[data-share-note-theme="typora-night"] th { background: #2e3338; color: #dedede; }
.share-note-article[data-share-note-theme="typora-night"] th,
.share-note-article[data-share-note-theme="typora-night"] td { border: 1px solid #555d66; padding: 6px 13px; }
.share-note-article[data-share-note-theme="typora-night"] tr:nth-child(2n) { background: #32373c; }
.share-note-article[data-share-note-theme="typora-night"] hr { border-top: 2px solid #555d66; margin: 2em 0; }
@media (min-width: 1400px) {
  .share-note-article[data-share-note-theme="typora-night"] { max-width: 1024px; }
}
@media (min-width: 1800px) {
  .share-note-article[data-share-note-theme="typora-night"] { max-width: 1200px; }
}
@media (max-width: 640px) {
  .share-note-article[data-share-note-theme="typora-night"] { padding: 24px 18px 48px; }
  .share-note-article[data-share-note-theme="typora-night"] h1 { font-size: 1.9em; }
}
`
