// Adapted from sindresorhus/github-markdown-css, github-markdown-light.css
// Commit e49401776c9d581ad42367fc4ea3d677d13e2e39 (MIT; see THIRD_PARTY_NOTICES.md).
// Only sanitized article elements are retained. The article wrapper supplies
// containment/host-style isolation; unsupported controls and image masks are omitted.
export const githubCss = `
/*!
 * github-markdown-css — MIT License
 * Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
.share-note-article[data-share-note-theme="github"] {
  color-scheme: light;
  -webkit-text-size-adjust: 100%;
  font-weight: 400;
  color: #1f2328;
  background-color: #ffffff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
  font-size: 16px;
  line-height: 1.5;
  max-width: 980px;
  padding: 40px 45px;
}
.share-note-article[data-share-note-theme="github"] a { color: #0969da; text-decoration: none; text-underline-offset: .2rem; }
.share-note-article[data-share-note-theme="github"] a:hover { text-decoration: underline; }
.share-note-article[data-share-note-theme="github"] a:focus-visible { outline: 2px solid #0969da; outline-offset: 2px; }
.share-note-article[data-share-note-theme="github"] strong { font-weight: 600; }
.share-note-article[data-share-note-theme="github"] h1,
.share-note-article[data-share-note-theme="github"] h2,
.share-note-article[data-share-note-theme="github"] h3,
.share-note-article[data-share-note-theme="github"] h4,
.share-note-article[data-share-note-theme="github"] h5,
.share-note-article[data-share-note-theme="github"] h6 { margin-top: 1.5rem; margin-bottom: 1rem; font-weight: 600; line-height: 1.25; }
.share-note-article[data-share-note-theme="github"] h1 { padding-bottom: .3em; font-size: 2em; border-bottom: 1px solid #d1d9e0b3; }
.share-note-article[data-share-note-theme="github"] h2 { padding-bottom: .3em; font-size: 1.5em; border-bottom: 1px solid #d1d9e0b3; }
.share-note-article[data-share-note-theme="github"] h3 { font-size: 1.25em; }
.share-note-article[data-share-note-theme="github"] h4 { font-size: 1em; }
.share-note-article[data-share-note-theme="github"] h5 { font-size: .875em; }
.share-note-article[data-share-note-theme="github"] h6 { font-size: .85em; color: #59636e; }
.share-note-article[data-share-note-theme="github"] .share-note-content > :first-child { margin-top: 0; }
.share-note-article[data-share-note-theme="github"] .share-note-content > :last-child { margin-bottom: 0; }
.share-note-article[data-share-note-theme="github"] p,
.share-note-article[data-share-note-theme="github"] blockquote,
.share-note-article[data-share-note-theme="github"] ul,
.share-note-article[data-share-note-theme="github"] ol,
.share-note-article[data-share-note-theme="github"] table,
.share-note-article[data-share-note-theme="github"] pre { margin-top: 0; margin-bottom: 1rem; }
.share-note-article[data-share-note-theme="github"] blockquote { padding: 0 1em; color: #59636e; border-left: .25em solid #d1d9e0; }
.share-note-article[data-share-note-theme="github"] blockquote > :first-child { margin-top: 0; }
.share-note-article[data-share-note-theme="github"] blockquote > :last-child { margin-bottom: 0; }
.share-note-article[data-share-note-theme="github"] ul,
.share-note-article[data-share-note-theme="github"] ol { padding-left: 2em; }
.share-note-article[data-share-note-theme="github"] ol ol,
.share-note-article[data-share-note-theme="github"] ul ol { list-style-type: lower-roman; }
.share-note-article[data-share-note-theme="github"] ul ul ol,
.share-note-article[data-share-note-theme="github"] ul ol ol,
.share-note-article[data-share-note-theme="github"] ol ul ol,
.share-note-article[data-share-note-theme="github"] ol ol ol { list-style-type: lower-alpha; }
.share-note-article[data-share-note-theme="github"] ul ul,
.share-note-article[data-share-note-theme="github"] ul ol,
.share-note-article[data-share-note-theme="github"] ol ol,
.share-note-article[data-share-note-theme="github"] ol ul { margin-top: 0; margin-bottom: 0; }
.share-note-article[data-share-note-theme="github"] li > p { margin-top: 1rem; }
.share-note-article[data-share-note-theme="github"] li + li { margin-top: .25em; }
.share-note-article[data-share-note-theme="github"] table { border-spacing: 0; font-variant: tabular-nums; }
.share-note-article[data-share-note-theme="github"] th { background: transparent; font-weight: 600; }
.share-note-article[data-share-note-theme="github"] th,
.share-note-article[data-share-note-theme="github"] td { padding: 6px 13px; border: 1px solid #d1d9e0; }
.share-note-article[data-share-note-theme="github"] tr { background-color: #ffffff; border-top: 1px solid #d1d9e0b3; }
.share-note-article[data-share-note-theme="github"] tr:nth-child(2n) { background-color: #f6f8fa; }
.share-note-article[data-share-note-theme="github"] code,
.share-note-article[data-share-note-theme="github"] pre { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; }
.share-note-article[data-share-note-theme="github"] :not(pre) > code { padding: .2em .4em; margin: 0; font-size: 85%; white-space: break-spaces; background-color: #818b981f; border-radius: 6px; }
.share-note-article[data-share-note-theme="github"] h1 code,
.share-note-article[data-share-note-theme="github"] h2 code,
.share-note-article[data-share-note-theme="github"] h3 code,
.share-note-article[data-share-note-theme="github"] h4 code,
.share-note-article[data-share-note-theme="github"] h5 code,
.share-note-article[data-share-note-theme="github"] h6 code { padding: 0 .2em; font-size: inherit; }
.share-note-article[data-share-note-theme="github"] pre { padding: 1rem; font-size: 85%; line-height: 1.45; color: #1f2328; background-color: #f6f8fa; border: 0; border-radius: 6px; word-wrap: normal; }
.share-note-article[data-share-note-theme="github"] pre code { display: inline; padding: 0; margin: 0; font-size: 100%; overflow: visible; line-height: inherit; word-wrap: normal; white-space: pre; background: transparent; border: 0; }
.share-note-article[data-share-note-theme="github"] hr { height: .25em; padding: 0; margin: 1.5rem 0; background-color: #d1d9e0; border: 0; }
@media (max-width: 640px) {
  .share-note-article[data-share-note-theme="github"] { padding: 24px 16px; }
}
`
