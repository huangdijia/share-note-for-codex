import { parse, serialize, type DefaultTreeAdapterMap } from 'parse5'
import TurndownService from 'turndown'
import { decryptSupported, detectReadCodec, type SupportedCiphertext } from '../crypto/codecs.js'
import { ShareNoteError } from '../errors.js'
import { sanitizeStaticHtml } from '../render/sanitize.js'

type Node = DefaultTreeAdapterMap['node']
type ParentNode = DefaultTreeAdapterMap['parentNode']
type Element = DefaultTreeAdapterMap['element']

function childNodes(node: Node): Node[] {
  return 'childNodes' in node ? node.childNodes : []
}

function findElement(node: Node, predicate: (element: Element) => boolean): Element | undefined {
  if ('tagName' in node && predicate(node)) return node
  for (const child of childNodes(node)) {
    const match = findElement(child, predicate)
    if (match) return match
  }
  return undefined
}

function attribute(element: Element, name: string): string | undefined {
  return element.attrs.find((item) => item.name === name)?.value
}

function textContent(node: Node): string {
  if (node.nodeName === '#text' && 'value' in node) return node.value
  return childNodes(node).map(textContent).join('')
}

function hasClass(element: Element, name: string): boolean {
  return (attribute(element, 'class') ?? '').split(/\s+/).includes(name)
}

function safeBodyHtml(html: string): string {
  return sanitizeStaticHtml(html)
}

export interface DecodedPage {
  title: string
  html: string
  markdown: string
  encrypted: boolean
  codec?: ReturnType<typeof detectReadCodec>
}

export async function decodeSharePage(
  pageHtml: string,
  fragmentKey: string
): Promise<DecodedPage> {
  const document = parse(pageHtml)
  const encryptedElement = findElement(document, (element) => attribute(element, 'id') === 'encrypted-data')
  let title: string
  let html: string
  let codec: ReturnType<typeof detectReadCodec> | undefined
  if (encryptedElement) {
    if (!fragmentKey) throw new ShareNoteError('credential_missing', 'Encrypted Share Note URL is missing its fragment key')
    let payload: unknown
    try {
      payload = JSON.parse(textContent(encryptedElement).trim()) as unknown
      codec = detectReadCodec(payload)
    } catch (error) {
      throw new ShareNoteError('protocol_error', 'Encrypted page payload is malformed or unsupported', undefined, { cause: error })
    }
    let plaintext: string
    try {
      plaintext = await decryptSupported(payload as SupportedCiphertext, fragmentKey)
    } catch (error) {
      throw new ShareNoteError('credential_missing', 'Unable to decrypt Share Note with the supplied key', undefined, { cause: error })
    }
    let data: unknown
    try {
      data = JSON.parse(plaintext) as unknown
    } catch (error) {
      throw new ShareNoteError('protocol_error', 'Decrypted Share Note payload is invalid', undefined, { cause: error })
    }
    if (!data || typeof data !== 'object') throw new ShareNoteError('protocol_error', 'Decrypted Share Note payload is invalid')
    const fields = data as Record<string, unknown>
    if (typeof fields.content !== 'string' || typeof fields.basename !== 'string') {
      throw new ShareNoteError('protocol_error', 'Decrypted Share Note is missing title or content')
    }
    title = fields.basename
    html = safeBodyHtml(fields.content)
  } else {
    const titleElement = findElement(document, (element) => element.tagName === 'title')
    const contentElement = findElement(document, (element) => hasClass(element, 'markdown-preview-sizer'))
    if (!contentElement) throw new ShareNoteError('protocol_error', 'Share page does not contain a supported note payload')
    title = titleElement ? textContent(titleElement).trim() : 'Untitled'
    html = safeBodyHtml(serialize(contentElement as ParentNode))
  }
  const turndown = new TurndownService({ codeBlockStyle: 'fenced', headingStyle: 'atx' })
  return {
    title,
    html,
    markdown: turndown.turndown(html),
    encrypted: Boolean(encryptedElement),
    ...(codec ? { codec } : {})
  }
}
