// Independent article-style adaptation of Typora GitHub's public appearance.
// Local font fallbacks replace downloaded fonts; editor UI is outside this theme.
export const typoraGithubCss = `
.share-note-article[data-share-note-theme="typora-github"] {
  color-scheme: light;
  background: #ffffff;
  color: #333333;
  font-family: "Open Sans", "Clear Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.6;
  max-width: 860px;
  padding: 32px 30px 80px;
}
.share-note-article[data-share-note-theme="typora-github"] h1,
.share-note-article[data-share-note-theme="typora-github"] h2,
.share-note-article[data-share-note-theme="typora-github"] h3,
.share-note-article[data-share-note-theme="typora-github"] h4,
.share-note-article[data-share-note-theme="typora-github"] h5,
.share-note-article[data-share-note-theme="typora-github"] h6 { font-weight: 700; margin: 1.2em 0 .6em; line-height: 1.4; }
.share-note-article[data-share-note-theme="typora-github"] h1 { font-size: 2.25em; border-bottom: 1px solid #eeeeee; padding-bottom: .3em; }
.share-note-article[data-share-note-theme="typora-github"] h2 { font-size: 1.75em; border-bottom: 1px solid #eeeeee; padding-bottom: .3em; }
.share-note-article[data-share-note-theme="typora-github"] h3 { font-size: 1.5em; }
.share-note-article[data-share-note-theme="typora-github"] h4 { font-size: 1.25em; }
.share-note-article[data-share-note-theme="typora-github"] h5,
.share-note-article[data-share-note-theme="typora-github"] h6 { font-size: 1em; }
.share-note-article[data-share-note-theme="typora-github"] h6 { color: #777777; }
.share-note-article[data-share-note-theme="typora-github"] .share-note-content > :first-child { margin-top: 0; }
.share-note-article[data-share-note-theme="typora-github"] p,
.share-note-article[data-share-note-theme="typora-github"] ul,
.share-note-article[data-share-note-theme="typora-github"] ol { margin-bottom: .8em; }
.share-note-article[data-share-note-theme="typora-github"] a { color: #4183c4; text-decoration: none; }
.share-note-article[data-share-note-theme="typora-github"] a:hover { text-decoration: underline; }
.share-note-article[data-share-note-theme="typora-github"] blockquote { border-left: 4px solid #dfe2e5; color: #777777; padding: 0 15px; }
.share-note-article[data-share-note-theme="typora-github"] blockquote > :last-child { margin-bottom: 0; }
.share-note-article[data-share-note-theme="typora-github"] code,
.share-note-article[data-share-note-theme="typora-github"] pre { font-family: Menlo, Monaco, Consolas, "Courier New", monospace; }
.share-note-article[data-share-note-theme="typora-github"] :not(pre) > code { background: #f8f8f8; border: 1px solid #e7eaed; border-radius: 3px; padding: 2px 4px; font-size: .9em; }
.share-note-article[data-share-note-theme="typora-github"] pre { background: #f8f8f8; border: 1px solid #e7eaed; border-radius: 3px; padding: 12px 16px; font-size: .9em; line-height: 1.6; }
.share-note-article[data-share-note-theme="typora-github"] th { background: #ffffff; font-weight: 700; }
.share-note-article[data-share-note-theme="typora-github"] th,
.share-note-article[data-share-note-theme="typora-github"] td { border: 1px solid #dfe2e5; padding: 6px 13px; }
.share-note-article[data-share-note-theme="typora-github"] tr:nth-child(2n) { background: #f8f8f8; }
.share-note-article[data-share-note-theme="typora-github"] hr { border-top: 2px solid #e7e7e7; margin: 1.5em 0; }
@media (max-width: 640px) {
  .share-note-article[data-share-note-theme="typora-github"] { padding: 24px 18px 48px; }
  .share-note-article[data-share-note-theme="typora-github"] h1 { font-size: 1.9em; }
}
`
