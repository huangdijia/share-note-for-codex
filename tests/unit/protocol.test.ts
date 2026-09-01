import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createAuthHeaders, sha256Hex } from '../../src/protocol/auth.js'
import {
  decryptSupported,
  detectReadCodec,
  encryptModern,
  type SupportedCiphertext
} from '../../src/crypto/codecs.js'
import { PROTOCOL_PROFILE } from '../../src/protocol/profile.js'

interface FixtureCase {
  key: string
  payload: SupportedCiphertext
}

async function loadFixtures(): Promise<Record<string, unknown>> {
  const path = fileURLToPath(new URL('../fixtures/protocol-ciphertexts.json', import.meta.url))
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
}

describe('M0 protocol profile', () => {
  it('keeps plugin and protocol versions separate', () => {
    expect(PROTOCOL_PROFILE.headerVersion).toBe('1.5.5')
    expect(PROTOCOL_PROFILE.headerVersion).not.toBe('0.1.0')
  })

  it('builds the audited nonce authentication headers', () => {
    const headers = createAuthHeaders({ uid: 'fixture-user', apiKey: 'fixture-key' }, '1720000000000')
    expect(headers).toEqual({
      'x-sharenote-id': 'fixture-user',
      'x-sharenote-key': sha256Hex('1720000000000fixture-key'),
      'x-sharenote-nonce': '1720000000000',
      'x-sharenote-version': '1.5.5'
    })
  })

  it('decrypts the frozen modern and historical fixtures', async () => {
    const fixtures = await loadFixtures()
    const plaintext = fixtures.plaintext as string
    for (const name of ['modern', 'historical142', 'historical113']) {
      const fixture = fixtures[name] as FixtureCase
      expect(detectReadCodec(fixture.payload)).toBe((fixtures[name] as { codec: string }).codec)
      await expect(decryptSupported(fixture.payload, fixture.key)).resolves.toBe(plaintext)
    }
  })

  it('never splits a surrogate pair at the 2000-code-unit boundary', async () => {
    const plaintext = `${'a'.repeat(1_999)}🚀${'b'.repeat(2_100)}`
    let counter = 0
    const deterministicRandom = (length: number): Uint8Array => {
      const result = new Uint8Array(length)
      result.fill(counter)
      counter += 1
      return result
    }
    const encrypted = await encryptModern(plaintext, undefined, deterministicRandom)
    expect(encrypted.payload.ciphertext).toHaveLength(3)
    await expect(decryptSupported(encrypted.payload, encrypted.key)).resolves.toBe(plaintext)
  })

  it('uses new IVs when re-encrypting with the same key', async () => {
    const first = await encryptModern('same plaintext')
    const second = await encryptModern('same plaintext', first.key)
    expect(second.payload.ivs[0]).not.toBe(first.payload.ivs[0])
    expect(second.payload.ciphertext[0]).not.toBe(first.payload.ciphertext[0])
  })

  it('rejects an unknown codec instead of treating it as empty content', () => {
    expect(() => detectReadCodec({ data: 'unknown' })).toThrow('Unknown Share Note codec')
  })
})
