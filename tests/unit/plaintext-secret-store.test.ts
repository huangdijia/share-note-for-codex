import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ConfigStore } from '../../src/config.js'
import { PlaintextFileSecretStore } from '../../src/secrets/plaintext-file.js'

const temporaryDirectories: string[] = []
const recordId = 'note-12345678-1234-4abc-8def-1234567890ab'

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    await rm(directory, { recursive: true, force: true })
  }))
})

async function dataDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'share-note-plaintext-store-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('plaintext file secret store', () => {
  it('round-trips credentials and note keys in private plaintext files', async () => {
    const directory = await dataDirectory()
    const store = new PlaintextFileSecretStore(directory)
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
    for (const secret of ['user-123', 'api-secret-456', 'note-secret-789']) {
      expect(persisted).toContain(secret)
    }
    expect(persisted).not.toContain('aes-256-gcm')
    expect(persisted).not.toContain('scrypt')
    if (process.platform !== 'win32') {
      for (const file of files) expect((await stat(file)).mode & 0o777).toBe(0o600)
      for (const directoryPath of [credentialDirectory, noteKeyDirectory]) {
        expect((await stat(directoryPath)).mode & 0o777).toBe(0o700)
      }
    }
  })

  it('rejects malformed plaintext credential and note-key files', async () => {
    const directory = await dataDirectory()
    const store = new PlaintextFileSecretStore(directory)
    const reference = await store.storeCredential('default', { uid: 'user', apiKey: 'api-key' })
    const noteReference = await store.storeNoteKey('default', recordId, 'note-key')

    const credentialDirectory = path.join(directory, 'secrets', 'credentials')
    const noteKeyDirectory = path.join(directory, 'secrets', 'note-keys')
    await writeFile(
      path.join(credentialDirectory, (await readdir(credentialDirectory))[0]!),
      JSON.stringify({ schemaVersion: 1, uid: 'user' })
    )
    await writeFile(
      path.join(noteKeyDirectory, (await readdir(noteKeyDirectory))[0]!),
      JSON.stringify({ schemaVersion: 1, key: '' })
    )

    await expect(store.readCredential(reference)).rejects.toMatchObject({ code: 'credential_missing' })
    await expect(store.readNoteKey(noteReference)).rejects.toMatchObject({ code: 'credential_missing' })
  })

  it('rejects legacy Keychain and encrypted-vault profile schemas', async () => {
    const directory = await dataDirectory()
    const profileDirectory = path.join(directory, 'profiles')
    await mkdir(profileDirectory, { recursive: true })
    const profilePath = path.join(profileDirectory, 'default.json')
    for (const profile of [
      {
        schemaVersion: 1,
        name: 'default',
        credentialRef: { type: 'macos-keychain', service: 'legacy', account: 'default' }
      },
      {
        schemaVersion: 2,
        name: 'default',
        credentialRef: { type: 'encrypted-file', id: 'credentials:default' }
      }
    ]) {
      await writeFile(profilePath, JSON.stringify(profile))
      await expect(new ConfigStore(directory).load('default')).rejects.toMatchObject({
        code: 'configuration_missing'
      })
    }
  })
})
