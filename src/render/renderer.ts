import { marked, Renderer, type Token } from 'marked'
import { createHash } from 'node:crypto'
import { escapeHtml, sanitizeStaticHtml } from './sanitize.js'
import { DEFAULT_THEME, themedArticle, type ThemeId } from './themes.js'

export type SourceFormat = 'markdown' | 'html'

export interface RenderedDocument {
  title: string
  bodyHtml: string
  documentHtml: string
  contentHash: string
  wordCount: number
  resources: string[]
  warnings: string[]
  publishable: boolean
  theme: ThemeId | null
}

const ACTIVE_HTML_PATTERN = /<(?:img|picture|source|video|audio|iframe|object|embed|script|link)\b|\burl\s*\(/gi

function resourceDescriptions(raw: string): string[] {
  return [...raw.matchAll(ACTIVE_HTML_PATTERN)].map((match) => match[0].trim())
}

function sensitiveFindings(raw: string): string[] {
  const patterns: Array<[string, RegExp]> = [
    ['private key material', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
    ['GitHub token', /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{20,}\b/],
    ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/],
    ['assigned credential-like value', /\b(?:password|passwd|api[_-]?key|secret|token)\s*[:=]\s*["']?[A-Za-z0-9_+/=-]{16,}/i]
  ]
  return patterns.filter(([, pattern]) => pattern.test(raw)).map(([name]) => name)
}

function titleFromHtml(html: string, fallback: string): string {
  const heading = html.match(/<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/i)?.[1]
  if (!heading) return fallback
  const plain = sanitizeHtmlToText(heading).trim()
  return plain || fallback
}

function sanitizeHtmlToText(html: string): string {
  return sanitizeStaticHtml(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
}

function countWords(text: string): number {
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0
  const latin = text.match(/[\p{L}\p{N}]+/gu)?.filter((word) => !/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u.test(word)).length ?? 0
  return cjk + latin
}

function previewDocument(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>html,body{margin:0;min-height:100%}body{background:transparent}</style>
</head>
<body>${bodyHtml}</body>
</html>`
}

function markdownToHtml(markdown: string, resources: string[], images: ReadonlyMap<string, string>): string {
  const renderer = new Renderer()
  renderer.html = ({ text }) => escapeHtml(text)
  renderer.image = ({ href, text, title }) => {
    const src = images.get(href)
    return src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ''}>` : escapeHtml(text)
  }
  const output = marked.parse(markdown, {
    async: false,
    gfm: true,
    renderer,
    walkTokens(token: Token) {
      if (token.type === 'image') resources.push(token.href)
      if (token.type === 'html') resources.push(...resourceDescriptions(token.raw))
    }
  })
  return typeof output === 'string' ? output : ''
}

export function renderDocument(
  source: string,
  format: SourceFormat,
  fallbackTitle: string,
  theme: ThemeId | null = DEFAULT_THEME,
  images: ReadonlyMap<string, string> = new Map()
): RenderedDocument {
  const resources: string[] = []
  let rendered: string
  if (format === 'markdown') {
    rendered = markdownToHtml(source, resources, images)
  } else {
    resources.push(...resourceDescriptions(source))
    rendered = source
  }
  const safeHtml = sanitizeStaticHtml(rendered)
  const title = titleFromHtml(safeHtml, fallbackTitle)
  const sensitive = sensitiveFindings(source)
  const blockedResources = resources.filter((resource) => !images.has(resource))
  const warnings = [
    ...(blockedResources.length > 0
      ? ['Unsupported images or active resources are not uploaded or fetched; publication is blocked.']
      : []),
    ...(sensitive.length > 0
      ? [`Potential sensitive material was detected (${sensitive.join(', ')}); publication is blocked pending source cleanup.`]
      : [])
  ]
  const plainText = sanitizeHtmlToText(safeHtml)
  const bodyHtml = theme ? themedArticle(safeHtml, theme) : safeHtml
  return {
    title,
    bodyHtml,
    documentHtml: previewDocument(title, bodyHtml),
    contentHash: createHash('sha256').update(bodyHtml, 'utf8').digest('hex'),
    wordCount: countWords(plainText),
    resources: [...new Set(resources)],
    warnings,
    publishable: blockedResources.length === 0 && sensitive.length === 0,
    theme
  }
}
