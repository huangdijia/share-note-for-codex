import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAuthHeaders } from '../../src/protocol/auth.js'
import { PROTOCOL_PROFILE } from '../../src/protocol/profile.js'
import { MockShareNoteServer } from '../helpers/mock-share-note-server.js'

describe('M0 mock service contract', () => {
  let server: MockShareNoteServer

  beforeEach(async () => {
    server = new MockShareNoteServer()
    await server.start()
  })

  afterEach(async () => {
    await server.close()
  })

  it('requires the frozen header version and nonce digest', async () => {
    const response = await fetch(server.apiBaseUrl + PROTOCOL_PROFILE.routes.doctor, {
      method: 'POST',
      headers: {
        ...createAuthHeaders({ uid: server.uid, apiKey: server.apiKey }, '1720000000000'),
        'content-type': 'application/json'
      },
      body: JSON.stringify({ files: [] })
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, files: [] })
    expect(server.requestLog[0]).toMatchObject({
      credentialed: true,
      version: '1.5.5'
    })
  })

  it('rejects a Codex plugin semver used as the protocol version', async () => {
    const headers = createAuthHeaders({ uid: server.uid, apiKey: server.apiKey })
    headers['x-sharenote-version'] = '0.1.0'
    const response = await fetch(server.apiBaseUrl + PROTOCOL_PROFILE.routes.doctor, {
      method: 'POST',
      headers,
      body: JSON.stringify({ files: [] })
    })
    expect(response.status).toBe(401)
  })
})
