// Independent visual adaptation: paper-like serif article, without Typora assets.
export const typoraNewsprintCss = `
.share-note-article[data-share-note-theme="typora-newsprint"] {
  color-scheme: light;
  background: #f3f2ee;
  color: #1f0909;
  font-family: "PT Serif", Georgia, "Songti SC", SimSun, serif;
  font-size: 16px;
  line-height: 1.5;
  max-width: 840px;
  padding: 36px 48px 72px;
}
.share-note-article[data-share-note-theme="typora-newsprint"] h1,
.share-note-article[data-share-note-theme="typora-newsprint"] h2,
.share-note-article[data-share-note-theme="typora-newsprint"] h3,
.share-note-article[data-share-note-theme="typora-newsprint"] h4,
.share-note-article[data-share-note-theme="typora-newsprint"] h5,
.share-note-article[data-share-note-theme="typora-newsprint"] h6 { font-weight: 700; line-height: 1.3; margin: 1.4em 0 .6em; }
.share-note-article[data-share-note-theme="typora-newsprint"] h1 { font-size: 2.5em; }
.share-note-article[data-share-note-theme="typora-newsprint"] h2 { font-size: 2em; }
.share-note-article[data-share-note-theme="typora-newsprint"] h3 { font-size: 1.5em; }
.share-note-article[data-share-note-theme="typora-newsprint"] h4 { font-size: 1.25em; }
.share-note-article[data-share-note-theme="typora-newsprint"] h5 { font-size: 1em; }
.share-note-article[data-share-note-theme="typora-newsprint"] h6 { font-size: .875em; }
.share-note-article[data-share-note-theme="typora-newsprint"] .share-note-content > :first-child { margin-top: 0; }
.share-note-article[data-share-note-theme="typora-newsprint"] a { color: #1f0909; text-decoration: underline; }
.share-note-article[data-share-note-theme="typora-newsprint"] blockquote { border-left: 4px solid #b9b4aa; color: #65615b; font-style: italic; padding: .2em 1.25em; }
.share-note-article[data-share-note-theme="typora-newsprint"] blockquote > :last-child { margin-bottom: 0; }
.share-note-article[data-share-note-theme="typora-newsprint"] code,
.share-note-article[data-share-note-theme="typora-newsprint"] pre { font-family: "Courier New", Courier, monospace; }
.share-note-article[data-share-note-theme="typora-newsprint"] :not(pre) > code { background: #e9e7e0; border-radius: 2px; padding: .1em .3em; font-size: .9em; }
.share-note-article[data-share-note-theme="typora-newsprint"] pre { background: #e9e7e0; border: 1px solid #dad7ce; border-radius: 0; padding: 14px 18px; font-size: .9em; line-height: 1.5; }
.share-note-article[data-share-note-theme="typora-newsprint"] th { background: #e5e2d9; font-weight: 700; }
.share-note-article[data-share-note-theme="typora-newsprint"] th,
.share-note-article[data-share-note-theme="typora-newsprint"] td { border: 1px solid #c8c4b9; padding: 6px 12px; }
.share-note-article[data-share-note-theme="typora-newsprint"] tr:nth-child(2n) { background: #eceae3; }
.share-note-article[data-share-note-theme="typora-newsprint"] hr { border-top: 1px solid #9b9589; margin: 2em 0; }
@media (max-width: 640px) {
  .share-note-article[data-share-note-theme="typora-newsprint"] { padding: 26px 20px 48px; }
  .share-note-article[data-share-note-theme="typora-newsprint"] h1 { font-size: 2em; }
  .share-note-article[data-share-note-theme="typora-newsprint"] h2 { font-size: 1.65em; }
}
`
