import { createHash } from 'node:crypto'
import { PROTOCOL_PROFILE } from './profile.js'

export interface ShareNoteCredential {
  uid: string
  apiKey: string
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function createAuthHeaders(
  credential: ShareNoteCredential,
  nonce = Date.now().toString()
): Record<string, string> {
  if (!credential.uid || !credential.apiKey) {
    throw new Error('Share Note credential is incomplete')
  }
  if (!/^\d+$/.test(nonce)) {
    throw new Error('Share Note nonce must contain decimal digits only')
  }
  return {
    'x-sharenote-id': credential.uid,
    'x-sharenote-key': sha256Hex(nonce + credential.apiKey),
    'x-sharenote-nonce': nonce,
    'x-sharenote-version': PROTOCOL_PROFILE.headerVersion
  }
}
