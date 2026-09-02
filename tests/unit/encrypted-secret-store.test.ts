import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ConfigStore } from '../../src/config.js'
import {
  EncryptedFileSecretStore,
  EnvironmentMasterPasswordProvider,
  type MasterPasswordProvider
} from '../../src/secrets/encrypted-file.js'

const temporaryDirectories: string[] = []
const recordId = 'note-12345678-1234-4abc-8def-1234567890ab'

class StaticMasterPasswordProvider implements MasterPasswordProvider {
  constructor(private readonly password: string) {}
  async getMasterPassword(): Promise<string> {
    return this.password
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    await rm(directory, { recursive: true, force: true })
  }))
})

async function dataDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'share-note-encrypted-store-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('encrypted file secret store', () => {
  it('round-trips credentials and note keys without persisting plaintext', async () => {
    const directory = await dataDirectory()
    const password = 'correct horse battery staple'
    const store = new EncryptedFileSecretStore(directory, new StaticMasterPasswordProvider(password))
    const reference = await store.storeCredential('default', { uid: 'user-123', apiKey: 'api-secret-456' })
    const noteReference = await store.storeNoteKey('default', recordId, 'note-secret-789')

    await expect(store.readCredential(reference)).resolves.toEqual({ uid: 'user-123', apiKey: 'api-secret-456' })
    await expect(store.readNoteKey(noteReference)).resolves.toBe('note-secret-789')

    const credentialDirectory = path.join(directory, 'secrets', 'credentials')
    const noteKeyDirectory = path.join(directory, 'secrets', 'note-keys')
    const files = [
      path.join(credentialDirectory, (await readdir(credentialDirectory))[0]!),
      path.join(noteKeyDirectory, (await readdir(noteKeyDirectory))[0]!)
    ]
    const persisted = (await Promise.all(files.map(async (file) => readFile(file, 'utf8')))).join('\n')
    expect(persisted).toContain('"algorithm": "aes-256-gcm"')
    expect(persisted).toContain('"name": "scrypt"')
    for (const secret of ['user-123', 'api-secret-456', 'note-secret-789', password]) {
      expect(persisted).not.toContain(secret)
    }
    if (process.platform !== 'win32') {
      for (const file of files) expect((await stat(file)).mode & 0o777).toBe(0o600)
    }
  })

  it('fails closed for a wrong password or tampered ciphertext', async () => {
    const directory = await dataDirectory()
    const reference = await new EncryptedFileSecretStore(
      directory,
      new StaticMasterPasswordProvider('correct-password-1234')
    ).storeCredential('default', { uid: 'user', apiKey: 'api-key' })

    const wrongPasswordStore = new EncryptedFileSecretStore(
      directory,
      new StaticMasterPasswordProvider('different-password-1')
    )
    await expect(wrongPasswordStore.readCredential(reference)).rejects.toMatchObject({
      code: 'credential_missing',
      message: expect.not.stringContaining('Unsupported')
    })

    const secretsDirectory = path.join(directory, 'secrets', 'credentials')
    const secretPath = path.join(secretsDirectory, (await readdir(secretsDirectory))[0]!)
    const envelope = JSON.parse(await readFile(secretPath, 'utf8')) as { ciphertext: string }
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -2)}AA`
    await writeFile(secretPath, JSON.stringify(envelope))
    const originalPasswordStore = new EncryptedFileSecretStore(
      directory,
      new StaticMasterPasswordProvider('correct-password-1234')
    )
    await expect(originalPasswordStore.readCredential(reference)).rejects.toMatchObject({ code: 'credential_missing' })
  })

  it('requires a process-scoped master password and removes it from the environment', async () => {
    const missingEnvironment: NodeJS.ProcessEnv = {}
    await expect(new EnvironmentMasterPasswordProvider(missingEnvironment).getMasterPassword())
      .rejects.toMatchObject({ code: 'secure_store_unavailable' })

    const environment: NodeJS.ProcessEnv = { SHARE_NOTE_MASTER_PASSWORD: 'environment-secret-1234' }
    const provider = new EnvironmentMasterPasswordProvider(environment)
    await expect(provider.getMasterPassword()).resolves.toBe('environment-secret-1234')
    expect(environment).not.toHaveProperty('SHARE_NOTE_MASTER_PASSWORD')
    await expect(provider.getMasterPassword()).resolves.toBe('environment-secret-1234')
  })

  it('rejects legacy Keychain profile schema instead of silently falling back', async () => {
    const directory = await dataDirectory()
    const profileDirectory = path.join(directory, 'profiles')
    await mkdir(profileDirectory, { recursive: true })
    await writeFile(path.join(profileDirectory, 'default.json'), JSON.stringify({
      schemaVersion: 1,
      name: 'default',
      credentialRef: { type: 'macos-keychain', service: 'legacy', account: 'default' }
    }))
    await expect(new ConfigStore(directory).load('default')).rejects.toMatchObject({
      code: 'configuration_missing'
    })
  })
})
