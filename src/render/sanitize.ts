import sanitizeHtml from 'sanitize-html'
import { isSafeRasterDataUri } from './raster.js'

export const ALLOWED_TAGS = [
  'article', 'section', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr', 'blockquote', 'pre', 'code', 'strong', 'em', 'del',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'a', 'span', 'div', 'img'
]

export function isHostedRasterUrl(value: string, webBaseUrl?: string): boolean {
  if (!webBaseUrl) return false
  try {
    const url = new URL(value)
    return url.origin === new URL(webBaseUrl).origin && !url.username && !url.password && !url.search && !url.hash &&
      /^\/files\/[a-z0-9]+\/[a-z0-9]+\.(?:png|jpg|jpeg|gif|webp)$/.test(url.pathname)
  } catch { return false }
}

export function sanitizeStaticHtml(html: string, webBaseUrl?: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'title'],
      img: ['src', 'alt', 'title'],
      code: ['class'],
      th: ['align'],
      td: ['align']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['data', 'https', 'http'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    enforceHtmlBoundary: true,
    parser: {
      lowerCaseAttributeNames: true,
      lowerCaseTags: true
    },
    exclusiveFilter: (frame) => frame.tag === 'img' && !isSafeRasterDataUri(frame.attribs.src ?? '') && !isHostedRasterUrl(frame.attribs.src ?? '', webBaseUrl),
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: 'a',
        attribs: {
          ...(attribs.href ? { href: attribs.href } : {}),
          ...(attribs.title ? { title: attribs.title } : {})
        }
      })
    }
  })
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character] ?? character)
}
