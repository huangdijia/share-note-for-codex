# Third-party notices

The runtime bundle includes these packages under their stated licenses:

- `marked` 18.0.11 — MIT
- `parse5` 8.0.1 — MIT
- `sanitize-html` 2.17.7 — MIT
- `turndown` 7.2.4 — MIT
- `@mixmark-io/domino` 2.2.0 — BSD-2-Clause
- `dayjs` 1.11.23 — MIT
- `deepmerge` 4.3.1 — MIT
- `dom-serializer` 3.1.1 — MIT
- `domelementtype` 3.0.0 — BSD-2-Clause
- `domhandler` 6.0.1 — BSD-2-Clause
- `domutils` 4.0.2 — BSD-2-Clause
- `entities` 8.0.0 — BSD-2-Clause
- `escape-string-regexp` 4.0.0 — MIT
- `htmlparser2` 12.0.0 — MIT
- `is-plain-object` 5.1.0 — MIT
- `launder` 1.7.1 — MIT
- `nanoid` 3.3.18 — MIT
- `parse-srcset` 1.0.2 — MIT
- `picocolors` 1.1.1 — ISC
- `postcss` 8.5.26 — MIT
- `source-map-js` 1.2.1 — BSD-3-Clause

The Share Note wire-format review references `alangrainger/share-note` (MIT, copyright Alan Grainger, 2023) and `note-sx/server` (PolyForm Perimeter 1.0.0). The server implementation is not bundled or copied. The modern encryption implementation is an independent Node.js implementation of the audited public wire format; the upstream client attribution is retained here for clarity.

Complete license texts are available in each package's published distribution and source repository. The build keeps package legal comments in the generated bundle.

## GitHub article theme

The `github` theme adapts the supported article rules from
[sindresorhus/github-markdown-css](https://github.com/sindresorhus/github-markdown-css),
`github-markdown-light.css` at commit `e49401776c9d581ad42367fc4ea3d677d13e2e39`.
Selectors are scoped to the article; layout containment and local font fallbacks
are retained. Unsupported elements, image masks, controls and syntax highlighting
rules are omitted. The rendered CSS also carries the MIT notice so standalone
preview and published fragments retain attribution. This is an adaptation, not
an official GitHub integration.

MIT License

Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.


## Independently implemented article styles

`typora-github`, `typora-newsprint` and `typora-night` are independent visual
adaptations informed by the public Typora theme gallery:
[GitHub](https://theme.typora.io/theme/Github/),
[Newsprint](https://theme.typora.io/theme/Newsprint/) and
[Night](https://theme.typora.io/theme/Night/). No Typora CSS or font assets are bundled.

`obsidian` and `obsidian-dark` independently approximate the default light and dark
reading appearance described in [Obsidian Appearance](https://obsidian.md/help/appearance).
No Obsidian application CSS, assets, API or vault integration is included.

These styles cover sanitized article content only. Local font availability affects
typography, and editor controls, proprietary Markdown extensions and syntax
highlighting are not reproduced. Product names identify visual references, not
affiliation or endorsement.
