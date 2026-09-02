import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback
} from 'node:crypto'
import path from 'node:path'
import type { CredentialReference } from '../config.js'
import { credentialIdentityReference, validateProfileName } from '../config.js'
import { ShareNoteError } from '../errors.js'
import type { ShareNoteCredential } from '../protocol/auth.js'
import { readJsonFile, writeJsonAtomic } from '../state/atomic.js'
import type { SecretStore } from './store.js'

const MASTER_PASSWORD_ENV_VAR = 'SHARE_NOTE_MASTER_PASSWORD'
const AAD_PREFIX = 'share-note-secret:v1:'
const SCRYPT_N = 32_768
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LENGTH = 32
const SCRYPT_MAX_MEMORY = 128 * 1024 * 1024

interface EncryptedSecretEnvelope {
  schemaVersion: 1
  algorithm: 'aes-256-gcm'
  kdf: {
    name: 'scrypt'
    N: typeof SCRYPT_N
    r: typeof SCRYPT_R
    p: typeof SCRYPT_P
    keyLength: typeof KEY_LENGTH
    salt: string
  }
  iv: string
  tag: string
  ciphertext: string
}

export interface MasterPasswordProvider {
  getMasterPassword(): Promise<string>
}

export class EnvironmentMasterPasswordProvider implements MasterPasswordProvider {
  private cachedPassword?: string

  constructor(
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly variableName = MASTER_PASSWORD_ENV_VAR
  ) {}

  async getMasterPassword(): Promise<string> {
    if (this.cachedPassword) return this.cachedPassword
    const password = this.environment[this.variableName]
    delete this.environment[this.variableName]
    if (!password) {
      throw new ShareNoteError(
        'secure_store_unavailable',
        `${this.variableName} must be set for actions that access encrypted secrets`
      )
    }
    if (password.length < 16) {
      throw new ShareNoteError(
        'secure_store_unavailable',
        `${this.variableName} must contain at least 16 characters`
      )
    }
    this.cachedPassword = password
    return password
  }
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      KEY_LENGTH,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAX_MEMORY },
      (error, key) => error ? reject(error) : resolve(key as Buffer)
    )
  })
}

function decodeBase64(value: unknown, expectedBytes?: number): Buffer {
  if (typeof value !== 'string' || value.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('Invalid encrypted secret encoding')
  }
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value || (expectedBytes !== undefined && decoded.length !== expectedBytes)) {
    throw new Error('Invalid encrypted secret encoding')
  }
  return decoded
}

function assertEnvelope(value: unknown): EncryptedSecretEnvelope {
  if (!value || typeof value !== 'object') throw new Error('Invalid encrypted secret envelope')
  const envelope = value as Partial<EncryptedSecretEnvelope>
  if (
    envelope.schemaVersion !== 1 ||
    envelope.algorithm !== 'aes-256-gcm' ||
    !envelope.kdf ||
    envelope.kdf.name !== 'scrypt' ||
    envelope.kdf.N !== SCRYPT_N ||
    envelope.kdf.r !== SCRYPT_R ||
    envelope.kdf.p !== SCRYPT_P ||
    envelope.kdf.keyLength !== KEY_LENGTH
  ) {
    throw new Error('Unsupported encrypted secret envelope')
  }
  decodeBase64(envelope.kdf.salt, 16)
  decodeBase64(envelope.iv, 12)
  decodeBase64(envelope.tag, 16)
  decodeBase64(envelope.ciphertext)
  return envelope as EncryptedSecretEnvelope
}

function credentialReference(profile: string): CredentialReference {
  return { type: 'encrypted-file', id: `credentials:${validateProfileName(profile)}` }
}

function assertCredentialReference(reference: CredentialReference): void {
  if (
    reference.type !== 'encrypted-file' ||
    !/^credentials:[a-z0-9][a-z0-9_-]{0,63}$/.test(reference.id)
  ) {
    throw new ShareNoteError('credential_missing', 'Encrypted credential reference is invalid')
  }
}

function noteKeyReference(profile: string, recordId: string): string {
  validateProfileName(profile)
  if (!/^note-[0-9a-f-]{36}$/.test(recordId)) {
    throw new ShareNoteError('invalid_request', 'Record identifier is invalid')
  }
  return `encrypted-file:notes:${profile}:${recordId}`
}

function assertNoteKeyReference(reference: string): void {
  if (!/^encrypted-file:notes:[a-z0-9][a-z0-9_-]{0,63}:note-[0-9a-f-]{36}$/.test(reference)) {
    throw new ShareNoteError('credential_missing', 'Encrypted note key reference is invalid')
  }
}

export class EncryptedFileSecretStore implements SecretStore {
  constructor(
    private readonly dataDirectory: string,
    private readonly passwords: MasterPasswordProvider
  ) {}

  async storeCredential(profile: string, credential: ShareNoteCredential): Promise<CredentialReference> {
    if (typeof credential.uid !== 'string' || typeof credential.apiKey !== 'string' || !credential.uid || !credential.apiKey) {
      throw new ShareNoteError('credential_missing', 'Credential must contain non-empty uid and apiKey strings')
    }
    const reference = credentialReference(profile)
    await this.writeSecret(credentialIdentityReference(reference), JSON.stringify(credential))
    return reference
  }

  async readCredential(reference: CredentialReference): Promise<ShareNoteCredential> {
    assertCredentialReference(reference)
    const plaintext = await this.readSecret(credentialIdentityReference(reference))
    try {
      const credential = JSON.parse(plaintext) as Partial<ShareNoteCredential>
      if (typeof credential.uid !== 'string' || typeof credential.apiKey !== 'string' || !credential.uid || !credential.apiKey) {
        throw new Error('Invalid credential')
      }
      return { uid: credential.uid, apiKey: credential.apiKey }
    } catch {
      throw new ShareNoteError('credential_missing', 'Encrypted credential payload is invalid')
    }
  }

  async storeNoteKey(profile: string, recordId: string, key: string): Promise<string> {
    if (typeof key !== 'string' || !key) throw new ShareNoteError('credential_missing', 'Note key cannot be empty')
    const reference = noteKeyReference(profile, recordId)
    await this.writeSecret(reference, key)
    return reference
  }

  async readNoteKey(reference: string): Promise<string> {
    assertNoteKeyReference(reference)
    return this.readSecret(reference)
  }

  private pathFor(reference: string): string {
    const category = reference.startsWith('encrypted-file:credentials:') ? 'credentials' : 'note-keys'
    const digest = createHash('sha256').update(reference).digest('hex')
    return path.join(this.dataDirectory, 'secrets', category, `${digest}.json`)
  }

  private async writeSecret(reference: string, plaintext: string): Promise<void> {
    const password = await this.passwords.getMasterPassword()
    const salt = randomBytes(16)
    const iv = randomBytes(12)
    const key = await deriveKey(password, salt)
    try {
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      cipher.setAAD(Buffer.from(`${AAD_PREFIX}${reference}`, 'utf8'))
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      const envelope: EncryptedSecretEnvelope = {
        schemaVersion: 1,
        algorithm: 'aes-256-gcm',
        kdf: {
          name: 'scrypt',
          N: SCRYPT_N,
          r: SCRYPT_R,
          p: SCRYPT_P,
          keyLength: KEY_LENGTH,
          salt: salt.toString('base64')
        },
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64')
      }
      await writeJsonAtomic(this.pathFor(reference), envelope)
    } finally {
      key.fill(0)
    }
  }

  private async readSecret(reference: string): Promise<string> {
    const envelopeValue = await readJsonFile(this.pathFor(reference)).catch(() => {
      throw new ShareNoteError('credential_missing', 'Encrypted secret was not found; rerun setup or republish the note')
    })
    const password = await this.passwords.getMasterPassword()
    let key: Buffer | undefined
    try {
      const envelope = assertEnvelope(envelopeValue)
      const salt = decodeBase64(envelope.kdf.salt, 16)
      const iv = decodeBase64(envelope.iv, 12)
      const tag = decodeBase64(envelope.tag, 16)
      const ciphertext = decodeBase64(envelope.ciphertext)
      key = await deriveKey(password, salt)
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAAD(Buffer.from(`${AAD_PREFIX}${reference}`, 'utf8'))
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    } catch {
      throw new ShareNoteError(
        'credential_missing',
        `Encrypted secret could not be decrypted; check ${MASTER_PASSWORD_ENV_VAR} or rerun setup`
      )
    } finally {
      key?.fill(0)
    }
  }
}
