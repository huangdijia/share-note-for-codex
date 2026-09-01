import { randomBytes, webcrypto } from 'node:crypto'
import { PROTOCOL_PROFILE } from '../protocol/profile.js'

const subtle = webcrypto.subtle

export interface ModernCiphertext {
  ciphertext: string[]
  ivs: string[]
}

export interface Historical142Ciphertext {
  ciphertext: string[]
}

export interface Historical113Ciphertext {
  ciphertext: string[]
  iv?: string
}

export type SupportedCiphertext =
  | ModernCiphertext
  | Historical142Ciphertext
  | Historical113Ciphertext

export interface EncryptResult {
  key: string
  payload: ModernCiphertext
}

export type RandomSource = (length: number) => Uint8Array

function encodeBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return Buffer.from(view).toString('base64')
}

function decodeBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) {
    throw new Error('Invalid base64 data')
  }
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4)
  return new Uint8Array(Buffer.from(padded, 'base64'))
}

function validateKey(key: Uint8Array): void {
  if (key.byteLength !== 16 && key.byteLength !== 32) {
    throw new Error('Unsupported Share Note key length')
  }
}

function chunksWithoutSplittingSurrogates(input: string, maximum: number): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < input.length) {
    let end = Math.min(start + maximum, input.length)
    if (
      end < input.length &&
      end > start &&
      input.charCodeAt(end - 1) >= 0xd800 &&
      input.charCodeAt(end - 1) <= 0xdbff &&
      input.charCodeAt(end) >= 0xdc00 &&
      input.charCodeAt(end) <= 0xdfff
    ) {
      end -= 1
    }
    chunks.push(input.slice(start, end))
    start = end
  }
  return chunks
}

function copiedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer
}

async function importKey(
  key: Uint8Array,
  usage: webcrypto.KeyUsage[]
): Promise<webcrypto.CryptoKey> {
  validateKey(key)
  return subtle.importKey('raw', copiedArrayBuffer(key), { name: 'AES-GCM' }, false, usage)
}

export async function encryptModern(
  plaintext: string,
  existingKey?: string,
  random: RandomSource = (length) => new Uint8Array(randomBytes(length))
): Promise<EncryptResult> {
  const keyBytes = existingKey ? decodeBase64(existingKey) : random(16)
  validateKey(keyBytes)
  const aesKey = await importKey(keyBytes, ['encrypt'])
  const ciphertext: string[] = []
  const ivs: string[] = []
  const chunks = chunksWithoutSplittingSurrogates(
    plaintext,
    PROTOCOL_PROFILE.chunkSizeUtf16
  )
  for (const chunk of chunks) {
    const iv = random(12)
    if (iv.byteLength !== 12) throw new Error('Random source returned an invalid IV')
    const encrypted = await subtle.encrypt(
      { name: 'AES-GCM', iv: copiedArrayBuffer(iv) },
      aesKey,
      new TextEncoder().encode(chunk)
    )
    ciphertext.push(encodeBase64(encrypted))
    ivs.push(encodeBase64(iv))
  }
  return {
    key: encodeBase64(keyBytes).replace(/=+$/, ''),
    payload: { ciphertext, ivs }
  }
}

function isModern(payload: SupportedCiphertext): payload is ModernCiphertext {
  return 'ivs' in payload
}

function isHistorical113(payload: SupportedCiphertext): payload is Historical113Ciphertext {
  return 'iv' in payload
}

function deterministicIv(index: number): Uint8Array {
  const iv = new Uint8Array(12)
  let remaining = index
  for (let offset = 0; offset < iv.length; offset += 1) {
    iv[offset] = remaining % 256
    remaining = Math.floor(remaining / 256)
  }
  return iv
}

export function detectReadCodec(payload: unknown):
  | 'aes-gcm-random-ivs-v1.5'
  | 'aes-gcm-index-iv-v1.4.2'
  | 'aes-gcm-legacy-v1.1.3' {
  if (!payload || typeof payload !== 'object') throw new Error('Unknown Share Note codec')
  const candidate = payload as Record<string, unknown>
  if (!Array.isArray(candidate.ciphertext)) throw new Error('Unknown Share Note codec')
  if (Array.isArray(candidate.ivs)) return 'aes-gcm-random-ivs-v1.5'
  if (typeof candidate.iv === 'string') return 'aes-gcm-legacy-v1.1.3'
  if (!('iv' in candidate)) return 'aes-gcm-index-iv-v1.4.2'
  throw new Error('Unknown Share Note codec')
}

export async function decryptSupported(payload: SupportedCiphertext, key: string): Promise<string> {
  const keyBytes = decodeBase64(key)
  const aesKey = await importKey(keyBytes, ['decrypt'])
  if (!Array.isArray(payload.ciphertext) || payload.ciphertext.length > 10_000) {
    throw new Error('Invalid Share Note ciphertext')
  }
  if (isModern(payload) && payload.ivs.length !== payload.ciphertext.length) {
    throw new Error('Ciphertext and IV counts do not match')
  }
  const plaintext: string[] = []
  for (let index = 0; index < payload.ciphertext.length; index += 1) {
    let iv: Uint8Array
    if (isModern(payload)) {
      const encodedIv = payload.ivs[index]
      if (typeof encodedIv !== 'string') throw new Error('Missing ciphertext IV')
      iv = decodeBase64(encodedIv)
      if (iv.byteLength !== 12) throw new Error('Invalid modern ciphertext IV')
    } else if (isHistorical113(payload)) {
      iv = payload.iv ? decodeBase64(payload.iv) : new Uint8Array([index & 0xff])
    } else {
      iv = deterministicIv(index)
    }
    const encodedCiphertext = payload.ciphertext[index]
    if (typeof encodedCiphertext !== 'string') throw new Error('Invalid ciphertext chunk')
    const decrypted = await subtle.decrypt(
      { name: 'AES-GCM', iv: copiedArrayBuffer(iv) },
      aesKey,
      copiedArrayBuffer(decodeBase64(encodedCiphertext))
    )
    plaintext.push(new TextDecoder('utf-8', { fatal: true }).decode(decrypted))
  }
  return plaintext.join('')
}
