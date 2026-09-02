import { createHash } from 'node:crypto'
import path from 'node:path'
import type { CredentialReference } from '../config.js'
import { credentialIdentityReference, validateProfileName } from '../config.js'
import { ShareNoteError } from '../errors.js'
import type { ShareNoteCredential } from '../protocol/auth.js'
import { readJsonFile, writeJsonAtomic } from '../state/atomic.js'
import type { SecretStore } from './store.js'

interface PlaintextCredentialFile {
  schemaVersion: 1
  uid: string
  apiKey: string
}

interface PlaintextNoteKeyFile {
  schemaVersion: 1
  key: string
}

function credentialReference(profile: string): CredentialReference {
  return { type: 'plaintext-file', id: `credentials:${validateProfileName(profile)}` }
}

function assertCredentialReference(reference: CredentialReference): void {
  if (
    reference.type !== 'plaintext-file' ||
    !/^credentials:[a-z0-9][a-z0-9_-]{0,63}$/.test(reference.id)
  ) {
    throw new ShareNoteError('credential_missing', 'Plaintext credential reference is invalid')
  }
}

function noteKeyReference(profile: string, recordId: string): string {
  validateProfileName(profile)
  if (!/^note-[0-9a-f-]{36}$/.test(recordId)) {
    throw new ShareNoteError('invalid_request', 'Record identifier is invalid')
  }
  return `plaintext-file:notes:${profile}:${recordId}`
}

function assertNoteKeyReference(reference: string): void {
  if (!/^plaintext-file:notes:[a-z0-9][a-z0-9_-]{0,63}:note-[0-9a-f-]{36}$/.test(reference)) {
    throw new ShareNoteError('credential_missing', 'Plaintext note key reference is invalid')
  }
}

export class PlaintextFileSecretStore implements SecretStore {
  constructor(private readonly dataDirectory: string) {}

  async storeCredential(profile: string, credential: ShareNoteCredential): Promise<CredentialReference> {
    if (typeof credential.uid !== 'string' || typeof credential.apiKey !== 'string' || !credential.uid || !credential.apiKey) {
      throw new ShareNoteError('credential_missing', 'Credential must contain non-empty uid and apiKey strings')
    }
    const reference = credentialReference(profile)
    const file: PlaintextCredentialFile = {
      schemaVersion: 1,
      uid: credential.uid,
      apiKey: credential.apiKey
    }
    await writeJsonAtomic(this.pathFor(credentialIdentityReference(reference)), file)
    return reference
  }

  async readCredential(reference: CredentialReference): Promise<ShareNoteCredential> {
    assertCredentialReference(reference)
    const value = await this.readPlaintextFile(credentialIdentityReference(reference))
    if (!value || typeof value !== 'object') {
      throw new ShareNoteError('credential_missing', 'Plaintext credential file is invalid')
    }
    const credential = value as Partial<PlaintextCredentialFile>
    if (
      credential.schemaVersion !== 1 ||
      typeof credential.uid !== 'string' ||
      typeof credential.apiKey !== 'string' ||
      !credential.uid ||
      !credential.apiKey
    ) {
      throw new ShareNoteError('credential_missing', 'Plaintext credential file is invalid')
    }
    return { uid: credential.uid, apiKey: credential.apiKey }
  }

  async storeNoteKey(profile: string, recordId: string, key: string): Promise<string> {
    if (typeof key !== 'string' || !key) throw new ShareNoteError('credential_missing', 'Note key cannot be empty')
    const reference = noteKeyReference(profile, recordId)
    const file: PlaintextNoteKeyFile = { schemaVersion: 1, key }
    await writeJsonAtomic(this.pathFor(reference), file)
    return reference
  }

  async readNoteKey(reference: string): Promise<string> {
    assertNoteKeyReference(reference)
    const value = await this.readPlaintextFile(reference)
    if (!value || typeof value !== 'object') {
      throw new ShareNoteError('credential_missing', 'Plaintext note key file is invalid')
    }
    const noteKey = value as Partial<PlaintextNoteKeyFile>
    if (noteKey.schemaVersion !== 1 || typeof noteKey.key !== 'string' || !noteKey.key) {
      throw new ShareNoteError('credential_missing', 'Plaintext note key file is invalid')
    }
    return noteKey.key
  }

  private pathFor(reference: string): string {
    const category = reference.startsWith('plaintext-file:credentials:') ? 'credentials' : 'note-keys'
    const digest = createHash('sha256').update(reference).digest('hex')
    return path.join(this.dataDirectory, 'secrets', category, `${digest}.json`)
  }

  private async readPlaintextFile(reference: string): Promise<unknown> {
    return readJsonFile(this.pathFor(reference)).catch(() => {
      throw new ShareNoteError('credential_missing', 'Plaintext secret was not found; rerun setup or republish the note')
    })
  }
}
