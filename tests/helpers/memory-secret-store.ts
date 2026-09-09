import type { CredentialReference } from '../../src/config.js'
import type { ShareNoteCredential } from '../../src/protocol/auth.js'
import type { SecretStore } from '../../src/secrets/store.js'

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>()

  async storeCredential(profile: string, credential: ShareNoteCredential): Promise<CredentialReference> {
    const reference: CredentialReference = {
      type: 'plaintext-file',
      id: `credentials:${profile}`
    }
    this.values.set(`${reference.type}:${reference.id}`, JSON.stringify(credential))
    return reference
  }

  async readCredential(reference: CredentialReference): Promise<ShareNoteCredential> {
    const value = this.values.get(`${reference.type}:${reference.id}`)
    if (!value) throw new Error('Credential not found')
    return JSON.parse(value) as ShareNoteCredential
  }

  async storeNoteKey(profile: string, recordId: string, key: string): Promise<string> {
    const reference = `plaintext-file:notes:${profile}:${recordId}`
    this.values.set(reference, key)
    return reference
  }

  async readNoteKey(reference: string): Promise<string> {
    const value = this.values.get(reference)
    if (!value) throw new Error('Note key not found')
    return value
  }
}
