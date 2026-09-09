import { githubCss } from './themes/github.js'
import { typoraGithubCss } from './themes/typora-github.js'
import { typoraNewsprintCss } from './themes/typora-newsprint.js'
import { typoraNightCss } from './themes/typora-night.js'
import { obsidianCss } from './themes/obsidian.js'
import { obsidianDarkCss } from './themes/obsidian-dark.js'
import { ShareNoteError } from '../errors.js'

export const THEME_IDS = ['simple', 'technical', 'reading', 'dark',
  'github', 'typora-github', 'typora-newsprint', 'typora-night', 'obsidian', 'obsidian-dark'] as const

export type ThemeId = typeof THEME_IDS[number]

export interface ThemeDefinition {
  id: ThemeId
  name: string
  description: string
  systemDefault: boolean
}

export const DEFAULT_THEME: ThemeId = 'simple'

export const THEMES: readonly ThemeDefinition[] = [
  { id: 'simple', name: '简洁', description: '白底、系统无衬线字体和蓝色链接。', systemDefault: true },
  { id: 'technical', name: '技术', description: '更宽正文，并强化代码块和表格。', systemDefault: false },
  { id: 'reading', name: '阅读', description: '暖白背景、系统衬线字体、窄栏宽和宽松行距。', systemDefault: false },
  { id: 'dark', name: '深色', description: '深色正文阅读区域和浅色文字。', systemDefault: false },
  { id: 'github', name: 'GitHub', description: 'GitHub 浅色 Markdown 排版，适合技术文档。', systemDefault: false },
  { id: 'typora-github', name: 'Typora GitHub', description: 'Typora GitHub 适配版：白底、宽松留白和标题分隔线。', systemDefault: false },
  { id: 'typora-newsprint', name: 'Typora Newsprint', description: 'Typora Newsprint 适配版：暖纸色、衬线字体和报刊排版。', systemDefault: false },
  { id: 'typora-night', name: 'Typora Night', description: 'Typora Night 适配版：蓝灰背景和柔和文字。', systemDefault: false },
  { id: 'obsidian', name: 'Obsidian', description: 'Obsidian 默认浅色适配版：紧凑阅读栏和紫色强调。', systemDefault: false },
  { id: 'obsidian-dark', name: 'Obsidian 深色', description: 'Obsidian 默认深色适配版：深灰正文和紫色强调。', systemDefault: false }
]

const THEME_BY_ID = new Map(THEMES.map((theme) => [theme.id, theme]))

export function parseTheme(value: unknown, fieldName = 'theme'): ThemeId {
  if (typeof value !== 'string' || !THEME_BY_ID.has(value as ThemeId)) {
    throw new ShareNoteError('invalid_request', `${fieldName} must be one of: ${THEME_IDS.join(', ')}`)
  }
  return value as ThemeId
}

export function themeDefinition(id: ThemeId): ThemeDefinition {
  return THEME_BY_ID.get(id)!
}

const COMMON_CSS = `
.share-note-article {
  box-sizing: border-box;
  display: block;
  margin: 0 auto;
  padding: 2rem 1.25rem 3rem;
  width: 100%;
  overflow-wrap: break-word;
  text-rendering: optimizeLegibility;
}
.share-note-article *, .share-note-article *::before, .share-note-article *::after { box-sizing: border-box; }
.share-note-article .share-note-content { min-width: 0; }
.share-note-article h1, .share-note-article h2, .share-note-article h3,
.share-note-article h4, .share-note-article h5, .share-note-article h6 {
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-weight: 650;
  line-height: 1.25;
  margin: 1.6em 0 .65em;
}
.share-note-article h1 { font-size: 2em; margin-top: 0; }
.share-note-article h2 { font-size: 1.5em; }
.share-note-article h3 { font-size: 1.25em; }
.share-note-article h4 { font-size: 1.1em; }
.share-note-article h5 { font-size: 1em; }
.share-note-article h6 { font-size: .9em; }
.share-note-article p, .share-note-article ul, .share-note-article ol,
.share-note-article blockquote, .share-note-article pre, .share-note-article table { margin: 0 0 1.1em; }
.share-note-article p, .share-note-article ul, .share-note-article ol,
.share-note-article li, .share-note-article table, .share-note-article th,
.share-note-article td, .share-note-article strong, .share-note-article em,
.share-note-article del, .share-note-article a, .share-note-article blockquote {
  background: transparent;
  color: inherit;
  font-family: inherit;
  line-height: inherit;
}
.share-note-article ul, .share-note-article ol { padding-left: 1.6em; }
.share-note-article li + li { margin-top: .3em; }
.share-note-article a { color: #0969da; text-decoration: underline; text-underline-offset: .15em; }
.share-note-article a:hover { text-decoration-thickness: 2px; }
.share-note-article blockquote {
  border-left: 4px solid #d0d7de;
  color: #57606a;
  margin-left: 0;
  padding: .15em 1em;
}
.share-note-article code, .share-note-article pre {
  color: inherit;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  line-height: inherit;
}
.share-note-article :not(pre) > code {
  background: rgba(175, 184, 193, .2);
  border-radius: .3em;
  font-size: .9em;
  padding: .15em .35em;
}
.share-note-article pre {
  background: #f6f8fa;
  border: 1px solid #d8dee4;
  border-radius: .5rem;
  line-height: 1.5;
  max-width: 100%;
  overflow-x: auto;
  padding: 1rem;
  white-space: pre;
}
.share-note-article pre code { background: transparent; color: inherit; padding: 0; }
.share-note-article table {
  border-collapse: collapse;
  display: block;
  max-width: 100%;
  overflow-x: auto;
  width: max-content;
}
.share-note-article th, .share-note-article td {
  border: 1px solid #d0d7de;
  padding: .45rem .65rem;
  text-align: left;
  white-space: normal;
}
.share-note-article th { background: #f6f8fa; font-weight: 650; }
.share-note-article hr { border: 0; border-top: 1px solid #d8dee4; margin: 2em 0; }
@media (max-width: 640px) {
  .share-note-article { padding: 1.25rem .9rem 2rem; }
  .share-note-article h1 { font-size: 1.7em; }
  .share-note-article h2 { font-size: 1.35em; }
  .share-note-article pre { padding: .8rem; }
}
`

const THEME_CSS: Record<ThemeId, string> = {
  'github': githubCss,
  'typora-github': typoraGithubCss,
  'typora-newsprint': typoraNewsprintCss,
  'typora-night': typoraNightCss,
  'obsidian': obsidianCss,
  'obsidian-dark': obsidianDarkCss,

  simple: `
.share-note-article[data-share-note-theme="simple"] {
  background: #ffffff;
  color: #202124;
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 16px;
  line-height: 1.65;
  max-width: 860px;
}`,
  technical: `
.share-note-article[data-share-note-theme="technical"] {
  background: #ffffff;
  color: #172033;
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 15.5px;
  line-height: 1.6;
  max-width: 1080px;
}
.share-note-article[data-share-note-theme="technical"] pre { background: #0d1117; border-color: #30363d; color: #e6edf3; }
.share-note-article[data-share-note-theme="technical"] table { font-size: .94em; }
.share-note-article[data-share-note-theme="technical"] th { background: #eaeef2; }
.share-note-article[data-share-note-theme="technical"] th,
.share-note-article[data-share-note-theme="technical"] td { padding: .55rem .75rem; }`,
  reading: `
.share-note-article[data-share-note-theme="reading"] {
  background: #fbf7ef;
  color: #342e27;
  font-family: ui-serif, Georgia, Cambria, "Times New Roman", serif;
  font-size: 18px;
  line-height: 1.85;
  max-width: 740px;
}
.share-note-article[data-share-note-theme="reading"] a { color: #74512d; }
.share-note-article[data-share-note-theme="reading"] blockquote { border-left-color: #b89b75; color: #675848; }
.share-note-article[data-share-note-theme="reading"] pre,
.share-note-article[data-share-note-theme="reading"] th { background: #f1eadf; }
.share-note-article[data-share-note-theme="reading"] th,
.share-note-article[data-share-note-theme="reading"] td { border-color: #cdbfae; }`,
  dark: `
.share-note-article[data-share-note-theme="dark"] {
  background: #161b22;
  color: #e6edf3;
  color-scheme: dark;
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 16px;
  line-height: 1.7;
  max-width: 900px;
}
.share-note-article[data-share-note-theme="dark"] a { color: #58a6ff; }
.share-note-article[data-share-note-theme="dark"] blockquote { border-left-color: #6e7681; color: #b1bac4; }
.share-note-article[data-share-note-theme="dark"] :not(pre) > code { background: rgba(110, 118, 129, .4); }
.share-note-article[data-share-note-theme="dark"] pre,
.share-note-article[data-share-note-theme="dark"] th { background: #0d1117; border-color: #30363d; }
.share-note-article[data-share-note-theme="dark"] th,
.share-note-article[data-share-note-theme="dark"] td { border-color: #30363d; }
.share-note-article[data-share-note-theme="dark"] hr { border-top-color: #30363d; }`
}

export function themeCss(theme: ThemeId): string {
  return `${COMMON_CSS.trim()}\n${THEME_CSS[theme].trim()}`
}

export function themedArticle(bodyHtml: string, theme: ThemeId): string {
  return `<article class="share-note-article" data-share-note-theme="${theme}"><style>${themeCss(theme)}</style><div class="share-note-content">${bodyHtml}</div></article>`
}

export function matchesThemedArticle(fragment: string, theme: ThemeId): boolean {
  const prefix = `<article class="share-note-article" data-share-note-theme="${theme}"><style>${themeCss(theme)}</style><div class="share-note-content">`
  return fragment.startsWith(prefix) && fragment.endsWith('</div></article>')
}

export function hasThemedArticleWrapper(fragment: string): boolean {
  return THEME_IDS.some((theme) => fragment.startsWith(
    `<article class="share-note-article" data-share-note-theme="${theme}">`
  ))
}
