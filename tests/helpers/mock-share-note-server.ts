import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { PROTOCOL_PROFILE, type NoteTemplate } from '../../src/protocol/profile.js'

export interface MockBehavior {
  dropCreateResponse: boolean
  createReturnsDifferentUrl: boolean
  deleteKeepsPage: boolean
  deleteCacheReads: number
  createDelayMilliseconds: number
}

export interface MockRequestLog {
  method: string
  path: string
  credentialed: boolean
  version?: string
}

interface StoredNote {
  filename: string
  html: string
  deleted: boolean
  cachedReadsRemaining: number
}

const DEFAULT_BEHAVIOR: MockBehavior = {
  dropCreateResponse: false,
  createReturnsDifferentUrl: false,
  deleteKeepsPage: false,
  deleteCacheReads: 0,
  createDelayMilliseconds: 0
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character] ?? character)
}

function renderPage(template: NoteTemplate): string {
  if (template.encrypted) {
    return `<!doctype html><html><head><title></title></head><body><main class="markdown-preview-sizer"><div id="template-user-data">Encrypted note</div></main><div id="encrypted-data" style="display:none">${template.content}</div></body></html>`
  }
  return `<!doctype html><html><head><title>${escapeHtml(template.title ?? '')}</title></head><body><main class="markdown-preview-sizer">${template.content}</main></body></html>`
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

export class MockShareNoteServer {
  readonly uid = 'mock-user'
  readonly apiKey = 'mock-api-key'
  readonly requestLog: MockRequestLog[] = []
  private readonly notes = new Map<string, StoredNote>()
  private readonly server = createServer((request, response) => {
    void this.handle(request, response).catch((error: unknown) => {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'mock error' }))
    })
  })
  private behavior: MockBehavior = { ...DEFAULT_BEHAVIOR }
  private sequence = 0
  private origin = ''
  private activeCreateRequests = 0
  maximumConcurrentCreateRequests = 0

  get apiBaseUrl(): string {
    return this.origin
  }

  get webBaseUrl(): string {
    return this.origin
  }

  setBehavior(behavior: Partial<MockBehavior>): void {
    this.behavior = { ...this.behavior, ...behavior }
  }

  resetBehavior(): void {
    this.behavior = { ...DEFAULT_BEHAVIOR }
  }

  resetMetrics(): void {
    this.activeCreateRequests = 0
    this.maximumConcurrentCreateRequests = 0
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = this.server.address() as AddressInfo
    this.origin = `http://127.0.0.1:${address.port}`
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => error ? reject(error) : resolve())
    })
  }

  private isAuthenticated(request: IncomingMessage): boolean {
    const uid = request.headers['x-sharenote-id']
    const nonce = request.headers['x-sharenote-nonce']
    const key = request.headers['x-sharenote-key']
    const version = request.headers['x-sharenote-version']
    return uid === this.uid &&
      typeof nonce === 'string' &&
      key === sha256Hex(nonce + this.apiKey) &&
      version === PROTOCOL_PROFILE.headerVersion
  }

  private log(request: IncomingMessage, path: string): void {
    this.requestLog.push({
      method: request.method ?? 'GET',
      path,
      credentialed: typeof request.headers['x-sharenote-key'] === 'string',
      ...(typeof request.headers['x-sharenote-version'] === 'string'
        ? { version: request.headers['x-sharenote-version'] }
        : {})
    })
  }

  private json(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', this.origin || 'http://127.0.0.1')
    this.log(request, url.pathname)

    if (request.method === 'GET') {
      const filename = url.pathname.slice(1)
      const note = this.notes.get(filename)
      if (!note || (note.deleted && note.cachedReadsRemaining <= 0)) {
        response.writeHead(404)
        response.end('not found')
        return
      }
      if (note.deleted && note.cachedReadsRemaining > 0) note.cachedReadsRemaining -= 1
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(note.html)
      return
    }

    if (request.method !== 'POST' || !this.isAuthenticated(request)) {
      response.writeHead(401)
      response.end('unauthorized')
      return
    }

    if (url.pathname === PROTOCOL_PROFILE.routes.doctor) {
      await readJson(request)
      this.json(response, 200, { success: true, files: [] })
      return
    }

    if (url.pathname === PROTOCOL_PROFILE.routes.create) {
      this.activeCreateRequests += 1
      this.maximumConcurrentCreateRequests = Math.max(
        this.maximumConcurrentCreateRequests,
        this.activeCreateRequests
      )
      const body = await readJson(request)
      const template = body.template as NoteTemplate
      const requestedFilename = typeof body.filename === 'string' ? body.filename : undefined
      const filename = requestedFilename ?? `mocknote${++this.sequence}`
      this.notes.set(filename, {
        filename,
        html: renderPage(template),
        deleted: false,
        cachedReadsRemaining: 0
      })
      if (this.behavior.createDelayMilliseconds > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, this.behavior.createDelayMilliseconds))
      }
      this.activeCreateRequests -= 1
      if (this.behavior.dropCreateResponse) {
        request.socket.destroy()
        return
      }
      const returnedFilename = this.behavior.createReturnsDifferentUrl
        ? `diverted${++this.sequence}`
        : filename
      this.json(response, 200, { url: `${this.webBaseUrl}/${returnedFilename}` })
      return
    }

    if (url.pathname === PROTOCOL_PROFILE.routes.delete) {
      const body = await readJson(request)
      const filename = typeof body.filename === 'string' ? body.filename : ''
      const note = this.notes.get(filename)
      if (note && !this.behavior.deleteKeepsPage) {
        note.deleted = true
        note.cachedReadsRemaining = this.behavior.deleteCacheReads
      }
      this.json(response, 200, { success: true })
      return
    }

    response.writeHead(404)
    response.end('not found')
  }
}
