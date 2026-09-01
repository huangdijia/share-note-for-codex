import sanitizeHtml from 'sanitize-html'

export const ALLOWED_TAGS = [
  'article', 'section', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr', 'blockquote', 'pre', 'code', 'strong', 'em', 'del',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'a', 'span', 'div'
]

export function sanitizeStaticHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'title'],
      code: ['class'],
      th: ['align'],
      td: ['align']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    enforceHtmlBoundary: true,
    parser: {
      lowerCaseAttributeNames: true,
      lowerCaseTags: true
    },
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
