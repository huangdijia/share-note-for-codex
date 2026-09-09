import { isHostedRasterUrl } from '../render/sanitize.js'
import type { ProfileConfig } from '../config.js'
import { ShareNoteError } from '../errors.js'
import { createAuthHeaders, type ShareNoteCredential } from '../protocol/auth.js'

export interface PageResponse {
  status: number
  url: string
  html?: string
}

export type FetchImplementation = typeof fetch

async function limitedText(response: Response, maximumBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new ShareNoteError('network_error', 'Response exceeds the configured size limit')
  }
  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > maximumBytes) {
    throw new ShareNoteError('network_error', 'Response exceeds the configured size limit')
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
}

function withTimeout(timeoutMilliseconds: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMilliseconds)
  timer.unref?.()
  return { signal: controller.signal, clear: () => clearTimeout(timer) }
}

function endpoint(baseUrl: string, route: string): URL {
  const base = new URL(baseUrl)
  const target = new URL(route, base.origin)
  if (target.origin !== base.origin) throw new ShareNoteError('network_error', 'API route changed origin')
  return target
}

function assertWebUrl(profile: ProfileConfig, value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ShareNoteError('invalid_request', 'Share URL is invalid')
  }
  const approved = new URL(profile.webBaseUrl)
  if (url.origin !== approved.origin || url.username || url.password) {
    throw new ShareNoteError('network_error', 'Share URL is outside the approved web origin')
  }
  return url
}

export class ShareNoteHttpClient {
  constructor(
    private readonly profile: ProfileConfig,
    private readonly credential: ShareNoteCredential | undefined,
    private readonly fetchImplementation: FetchImplementation = fetch
  ) {}

  async postJson<T>(route: string, body: unknown, timeoutMilliseconds = 10_000): Promise<T> {
    if (!this.credential) throw new ShareNoteError('credential_missing', 'Credential is required for this action')
    const target = endpoint(this.profile.apiBaseUrl, route)
    const timeout = withTimeout(timeoutMilliseconds)
    let response: Response
    try {
      response = await this.fetchImplementation(target, {
        method: 'POST',
        redirect: 'manual',
        signal: timeout.signal,
        headers: {
          ...createAuthHeaders(this.credential),
          'content-type': 'application/json'
        },
        body: JSON.stringify(body)
      })
    } catch (error) {
      throw new ShareNoteError('network_error', 'Share Note request did not return a response', undefined, { cause: error })
    } finally {
      timeout.clear()
    }
    if (response.status >= 300 && response.status < 400) {
      throw new ShareNoteError('network_error', 'Credentialed API redirect was rejected')
    }
    // The frozen protocol also uses 403 for resource ownership and registration policy,
    // so that status alone does not prove the credential was rejected.
    if (response.status === 401 || response.status === 462) {
      throw new ShareNoteError('authentication_failed', 'Share Note rejected the configured credential', {
        status: response.status
      })
    }
    if (!response.ok) {
      throw new ShareNoteError('network_error', 'Share Note API returned an error', { status: response.status })
    }
    const text = await limitedText(response, Math.min(this.profile.maxResponseBytes, 1024 * 1024))
    try {
      return JSON.parse(text) as T
    } catch (error) {
      throw new ShareNoteError('protocol_error', 'Share Note API returned invalid JSON', undefined, { cause: error })
    }
  }

  async uploadImage(bytes: Buffer, filetype: string, hash: string): Promise<{ url?: string }> {
    if (!this.credential) throw new ShareNoteError('credential_missing', 'Credential is required for upload')
    const timeout = withTimeout(10_000)
    try {
      const response = await this.fetchImplementation(endpoint(this.profile.apiBaseUrl, '/v1/file/upload'), {
        method: 'POST', redirect: 'manual', signal: timeout.signal,
        headers: {
          ...createAuthHeaders(this.credential),
          'content-type': 'application/octet-stream',
          'x-sharenote-filetype': filetype,
          'x-sharenote-hash': hash,
          'x-sharenote-bytelength': String(bytes.length)
        },
        body: new Uint8Array(bytes)
      })
      if (!response.ok || response.status >= 300) throw new ShareNoteError('network_error', 'Image upload did not return a successful response')
      return JSON.parse(await limitedText(response, Math.min(this.profile.maxResponseBytes, 1024 * 1024))) as { url?: string }
    } finally { timeout.clear() }
  }

  async getImage(value: string): Promise<Buffer> {
    if (!isHostedRasterUrl(value, this.profile.webBaseUrl)) throw new ShareNoteError('network_error', 'Image URL is outside the approved asset location')
    const timeout = withTimeout(10_000)
    try {
      const response = await this.fetchImplementation(value, { method: 'GET', redirect: 'manual', signal: timeout.signal, headers: { accept: 'image/*' } })
      if (!response.ok || response.status >= 300) throw new ShareNoteError('network_error', 'Image read-back failed')
      if (Number(response.headers.get('content-length') ?? 0) > this.profile.maxSourceBytes) throw new ShareNoteError('network_error', 'Image response exceeds size limit')
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length > this.profile.maxSourceBytes) throw new ShareNoteError('network_error', 'Image response exceeds size limit')
      return bytes
    } finally { timeout.clear() }
  }

  async getPage(value: string, maximumRedirects = 2): Promise<PageResponse> {
    let target = assertWebUrl(this.profile, value)
    target.hash = ''
    for (let redirect = 0; redirect <= maximumRedirects; redirect += 1) {
      const timeout = withTimeout(10_000)
      let response: Response
      try {
        response = await this.fetchImplementation(target, {
          method: 'GET',
          redirect: 'manual',
          signal: timeout.signal,
          headers: { accept: 'text/html' }
        })
      } catch (error) {
        throw new ShareNoteError('network_error', 'Share page request failed', undefined, { cause: error })
      } finally {
        timeout.clear()
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location || redirect === maximumRedirects) {
          throw new ShareNoteError('network_error', 'Share page redirect could not be followed safely')
        }
        target = assertWebUrl(this.profile, new URL(location, target).toString())
        target.hash = ''
        continue
      }
      if (response.status === 404 || response.status === 410) {
        return { status: response.status, url: target.toString() }
      }
      if (!response.ok) {
        throw new ShareNoteError('network_error', 'Share page returned an error', { status: response.status })
      }
      return {
        status: response.status,
        url: target.toString(),
        html: await limitedText(response, this.profile.maxResponseBytes)
      }
    }
    throw new ShareNoteError('network_error', 'Share page redirect limit exceeded')
  }
}
