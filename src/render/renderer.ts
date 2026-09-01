import { marked, Renderer, type Token } from 'marked'
import { createHash } from 'node:crypto'
import { escapeHtml, sanitizeStaticHtml } from './sanitize.js'

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
  <style>body{font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.65;max-width:860px;margin:2rem auto;padding:0 1.25rem;color:#202124}pre{overflow:auto;padding:1rem;background:#f6f8fa;border-radius:.5rem}code{font-family:ui-monospace,monospace}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d0d7de;padding:.4rem .6rem}blockquote{border-left:4px solid #d0d7de;margin-left:0;padding-left:1rem;color:#57606a}</style>
</head>
<body><article>${bodyHtml}</article></body>
</html>`
}

function markdownToHtml(markdown: string, resources: string[]): string {
  const renderer = new Renderer()
  renderer.html = ({ text }) => escapeHtml(text)
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
  fallbackTitle: string
): RenderedDocument {
  const resources: string[] = []
  let rendered: string
  if (format === 'markdown') {
    rendered = markdownToHtml(source, resources)
  } else {
    resources.push(...resourceDescriptions(source))
    rendered = source
  }
  const bodyHtml = sanitizeStaticHtml(rendered)
  const title = titleFromHtml(bodyHtml, fallbackTitle)
  const sensitive = sensitiveFindings(source)
  const warnings = [
    ...(resources.length > 0
      ? ['Embedded images or active resources are not uploaded or fetched; publication is blocked.']
      : []),
    ...(sensitive.length > 0
      ? [`Potential sensitive material was detected (${sensitive.join(', ')}); publication is blocked pending source cleanup.`]
      : [])
  ]
  const plainText = sanitizeHtmlToText(bodyHtml)
  return {
    title,
    bodyHtml,
    documentHtml: previewDocument(title, bodyHtml),
    contentHash: createHash('sha256').update(bodyHtml, 'utf8').digest('hex'),
    wordCount: countWords(plainText),
    resources: [...new Set(resources)],
    warnings,
    publishable: resources.length === 0 && sensitive.length === 0
  }
}
