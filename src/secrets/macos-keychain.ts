import { spawn } from 'node:child_process'
import type { CredentialReference } from '../config.js'
import { ShareNoteError } from '../errors.js'
import type { ShareNoteCredential } from '../protocol/auth.js'
import type { SecretStore } from './store.js'

const CREDENTIAL_SERVICE = 'com.codex.share-note.credentials'
const NOTE_KEY_SERVICE = 'com.codex.share-note.note-keys'

function validateKeychainIdentifier(value: string): string {
  if (!/^[A-Za-z0-9._:-]{1,180}$/.test(value)) {
    throw new ShareNoteError('invalid_request', 'Invalid secure-store identifier')
  }
  return value
}

async function runSecurity(args: string[], stdin?: string): Promise<string> {
  if (process.platform !== 'darwin') {
    throw new ShareNoteError('secure_store_unavailable', 'macOS Keychain is unavailable on this platform')
  }
  return new Promise<string>((resolve, reject) => {
    const child = spawn('/usr/bin/security', args, {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.once('error', (error) => reject(new ShareNoteError(
      'secure_store_unavailable',
      'Unable to launch macOS Keychain',
      undefined,
      { cause: error }
    )))
    child.once('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString('utf8').trim())
      } else {
        reject(new ShareNoteError('credential_missing', 'macOS Keychain operation failed', {
          exitCode: code ?? -1,
          diagnostic: Buffer.concat(stderr).toString('utf8').trim().slice(0, 240)
        }))
      }
    })
    if (stdin !== undefined) child.stdin.end(stdin + '\n')
    else child.stdin.end()
  })
}

async function storeSecret(service: string, account: string, value: string): Promise<void> {
  // `security ... -w` reads a password and confirmation from stdin. Supplying
  // both keeps the secret out of argv and therefore out of process listings.
  await runSecurity([
    'add-generic-password',
    '-U',
    '-a', validateKeychainIdentifier(account),
    '-s', validateKeychainIdentifier(service),
    '-w'
  ], `${value}\n${value}`)
}

async function readSecret(service: string, account: string): Promise<string> {
  return runSecurity([
    'find-generic-password',
    '-a', validateKeychainIdentifier(account),
    '-s', validateKeychainIdentifier(service),
    '-w'
  ])
}

export class MacOsKeychainSecretStore implements SecretStore {
  async storeCredential(profile: string, credential: ShareNoteCredential): Promise<CredentialReference> {
    if (!credential.uid || !credential.apiKey) {
      throw new ShareNoteError('invalid_request', 'Imported credential must contain uid and apiKey')
    }
    const account = validateKeychainIdentifier(profile)
    await storeSecret(CREDENTIAL_SERVICE, account, JSON.stringify(credential))
    return { type: 'macos-keychain', service: CREDENTIAL_SERVICE, account }
  }

  async readCredential(reference: CredentialReference): Promise<ShareNoteCredential> {
    if (reference.type !== 'macos-keychain' || reference.service !== CREDENTIAL_SERVICE) {
      throw new ShareNoteError('credential_missing', 'Credential reference is not supported')
    }
    let value: unknown
    try {
      value = JSON.parse(await readSecret(reference.service, reference.account)) as unknown
    } catch (error) {
      if (error instanceof ShareNoteError) throw error
      throw new ShareNoteError('credential_missing', 'Credential stored in Keychain is invalid')
    }
    if (!value || typeof value !== 'object') {
      throw new ShareNoteError('credential_missing', 'Credential stored in Keychain is invalid')
    }
    const credential = value as Partial<ShareNoteCredential>
    if (typeof credential.uid !== 'string' || typeof credential.apiKey !== 'string') {
      throw new ShareNoteError('credential_missing', 'Credential stored in Keychain is incomplete')
    }
    return { uid: credential.uid, apiKey: credential.apiKey }
  }

  async storeNoteKey(profile: string, recordId: string, key: string): Promise<string> {
    const account = validateKeychainIdentifier(`${profile}:${recordId}`)
    await storeSecret(NOTE_KEY_SERVICE, account, key)
    return `macos-keychain:${NOTE_KEY_SERVICE}:${account}`
  }

  async readNoteKey(reference: string): Promise<string> {
    const prefix = `macos-keychain:${NOTE_KEY_SERVICE}:`
    if (!reference.startsWith(prefix)) {
      throw new ShareNoteError('credential_missing', 'Note-key reference is not supported')
    }
    return readSecret(NOTE_KEY_SERVICE, reference.slice(prefix.length))
  }
}
