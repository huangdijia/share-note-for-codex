import type { CredentialReference } from '../config.js'
import type { ShareNoteCredential } from '../protocol/auth.js'

export interface SecretStore {
  storeCredential(profile: string, credential: ShareNoteCredential): Promise<CredentialReference>
  readCredential(reference: CredentialReference): Promise<ShareNoteCredential>
  readNoteKey(reference: string): Promise<string>
}
