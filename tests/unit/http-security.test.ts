import { describe, expect, it, vi } from 'vitest'
import type { ProfileConfig } from '../../src/config.js'
import { ShareNoteHttpClient } from '../../src/http/client.js'
import { PROTOCOL_PROFILE } from '../../src/protocol/profile.js'

const profile: ProfileConfig = {
  schemaVersion: 3,
  name: 'enterprise',
  apiBaseUrl: 'https://api.enterprise.example',
  webBaseUrl: 'https://share.enterprise.example',
  credentialRef: {
    type: 'plaintext-file',
    id: 'credentials:enterprise'
  },
  protocolProfile: PROTOCOL_PROFILE.id,
  defaultEncryption: true,
  allowedSourceRoots: ['/approved'],
  embeddedAssetsPolicy: 'block',
  allowUnencryptedPublish: false,
  allowInsecureLoopback: false,
  maxSourceBytes: 1024,
  maxResponseBytes: 1024
}

describe('HTTP origin isolation', () => {
  it('rejects a credentialed redirect without following it', async () => {
    const mockFetch = vi.fn(async (..._arguments: Parameters<typeof fetch>) => new Response(null, {
      status: 302,
      headers: { location: 'https://public.example/v1/file/check-files' }
    }))
    const client = new ShareNoteHttpClient(
      profile,
      { uid: 'uid', apiKey: 'secret' },
      mockFetch as typeof fetch
    )
    await expect(client.postJson(PROTOCOL_PROFILE.routes.doctor, { files: [] }))
      .rejects.toMatchObject({ code: 'network_error' })
    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, options] = mockFetch.mock.calls[0]!
    expect(String(url)).toBe('https://api.enterprise.example/v1/file/check-files')
    expect((options?.headers as Record<string, string>)['x-sharenote-key']).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects a share-page redirect to another origin without credentials or fallback', async () => {
    const mockFetch = vi.fn(async (..._arguments: Parameters<typeof fetch>) => new Response(null, {
      status: 302,
      headers: { location: 'https://public.example/note' }
    }))
    const client = new ShareNoteHttpClient(profile, undefined, mockFetch as typeof fetch)
    await expect(client.getPage('https://share.enterprise.example/note'))
      .rejects.toMatchObject({ code: 'network_error' })
    expect(mockFetch).toHaveBeenCalledOnce()
    const [, options] = mockFetch.mock.calls[0]!
    expect(options?.headers).toEqual({ accept: 'text/html' })
  })
})
