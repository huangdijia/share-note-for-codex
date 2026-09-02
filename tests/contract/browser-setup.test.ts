import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BROWSER_API_KEY_ENV_VAR,
  ShareNoteApplication,
  type BrowserSetupDependencies
} from '../../src/app.js'
import { PlaintextFileSecretStore } from '../../src/secrets/plaintext-file.js'
import { MemorySecretStore } from '../../src/secrets/store.js'
import { MockShareNoteServer } from '../helpers/mock-share-note-server.js'

async function filesBelow(directory: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(directory).catch(() => [])) {
    const candidate = path.join(directory, entry)
    if ((await stat(candidate)).isDirectory()) result.push(...await filesBelow(candidate))
    else result.push(candidate)
  }
  return result
}

describe('browser-assisted setup contract', () => {
  let server: MockShareNoteServer
  let dataDirectory: string
  let workspace: string
  let environment: NodeJS.ProcessEnv
  let now: number
  let opened: Array<{ url: string; approvedOrigin: string }>
  let dependencies: BrowserSetupDependencies

  beforeEach(async () => {
    server = new MockShareNoteServer()
    await server.start()
    dataDirectory = await mkdtemp(path.join(tmpdir(), 'share-note-browser-data-'))
    workspace = await mkdtemp(path.join(tmpdir(), 'share-note-browser-workspace-'))
    environment = {}
    now = Date.parse('2026-09-02T00:00:00.000Z')
    opened = []
    dependencies = {
      now: () => now,
      createUid: () => server.uid,
      openBrowser: async (url, approvedOrigin) => {
        opened.push({ url, approvedOrigin })
      }
    }
  })

  afterEach(async () => {
    await server.close()
    await rm(dataDirectory, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  })

  function memoryApplication(): ShareNoteApplication {
    return new ShareNoteApplication(dataDirectory, new MemorySecretStore(), fetch, environment, dependencies)
  }

  async function startSelfHosted(application: ShareNoteApplication, profile = 'private') {
    return application.setupBrowserStart({
      profile,
      service: 'self-hosted',
      apiBaseUrl: server.apiBaseUrl,
      webBaseUrl: server.webBaseUrl,
      confirmedApiOrigin: server.apiBaseUrl,
      confirmedWebOrigin: server.webBaseUrl,
      allowedSourceRoots: [workspace],
      allowInsecureLoopback: true,
      expiresInSeconds: 60
    })
  }

  it('opens the bound authorization page and completes from process-scoped hidden inputs', async () => {
    const application = memoryApplication()
    const started = await startSelfHosted(application)
    expect(started).toMatchObject({
      status: 'awaiting_user',
      service: 'self-hosted',
      apiOrigin: server.apiBaseUrl,
      webOrigin: server.webBaseUrl
    })
    expect(opened).toHaveLength(1)
    const authorization = new URL(opened[0]!.url)
    expect(authorization.origin).toBe(server.apiBaseUrl)
    expect(authorization.pathname).toBe('/v1/account/get-key')
    expect(authorization.searchParams.get('id')).toBe(server.uid)
    expect(opened[0]!.approvedOrigin).toBe(server.apiBaseUrl)

    environment[BROWSER_API_KEY_ENV_VAR] = server.apiKey
    const completed = await application.setupBrowserComplete({ profile: 'private' })
    expect(completed).toMatchObject({ status: 'configured', action: 'setup-browser-complete' })
    expect(environment[BROWSER_API_KEY_ENV_VAR]).toBeUndefined()
    expect(await application.doctor({ profile: 'private' })).toMatchObject({ status: 'healthy' })
    await expect(stat(path.join(dataDirectory, 'pending-setups', 'private.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uses frozen public origins and forbids public origin overrides', async () => {
    const application = memoryApplication()
    const started = await application.setupBrowserStart({
      profile: 'public',
      service: 'public',
      allowedSourceRoots: [workspace],
      expiresInSeconds: 60
    })
    expect(started).toMatchObject({
      apiOrigin: 'https://api.note.sx',
      webOrigin: 'https://share.note.sx'
    })
    expect(new URL(opened[0]!.url).origin).toBe('https://api.note.sx')
    await expect(application.setupBrowserStart({
      profile: 'override',
      service: 'public',
      apiBaseUrl: server.apiBaseUrl,
      allowedSourceRoots: [workspace]
    })).rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('requires independent self-hosted origin confirmations and detects pending source drift', async () => {
    const application = memoryApplication()
    await expect(application.setupBrowserStart({
      profile: 'private',
      service: 'self-hosted',
      apiBaseUrl: server.apiBaseUrl,
      webBaseUrl: server.webBaseUrl,
      confirmedApiOrigin: server.apiBaseUrl,
      confirmedWebOrigin: 'https://different.example',
      allowedSourceRoots: [workspace],
      allowInsecureLoopback: true
    })).rejects.toMatchObject({ code: 'source_blocked' })

    await startSelfHosted(application)
    const pendingPath = path.join(dataDirectory, 'pending-setups', 'private.json')
    const pending = JSON.parse(await readFile(pendingPath, 'utf8')) as Record<string, unknown>
    pending.webBaseUrl = 'https://different.example'
    await writeFile(pendingPath, JSON.stringify(pending))
    environment[BROWSER_API_KEY_ENV_VAR] = server.apiKey
    await expect(application.setupBrowserComplete({ profile: 'private' }))
      .rejects.toMatchObject({ code: 'source_blocked' })
    expect(environment[BROWSER_API_KEY_ENV_VAR]).toBeUndefined()
  })

  it('atomically deletes pending state on timeout or explicit cancellation and rejects repeats', async () => {
    const application = memoryApplication()
    await startSelfHosted(application, 'expired')
    now += 60_001
    environment[BROWSER_API_KEY_ENV_VAR] = server.apiKey
    await expect(application.setupBrowserComplete({ profile: 'expired' }))
      .rejects.toMatchObject({ code: 'configuration_missing' })
    await expect(stat(path.join(dataDirectory, 'pending-setups', 'expired.json'))).rejects.toMatchObject({ code: 'ENOENT' })

    now += 1
    await startSelfHosted(application, 'cancelled')
    expect(await application.setupBrowserComplete({ profile: 'cancelled', cancel: true }))
      .toMatchObject({ status: 'cancelled' })
    await expect(application.setupBrowserComplete({ profile: 'cancelled', cancel: true }))
      .rejects.toMatchObject({ code: 'configuration_missing' })
  })

  it('fails closed when the browser cannot open and never switches to public service', async () => {
    dependencies.openBrowser = vi.fn(async () => {
      throw new Error('launcher detail must not be surfaced')
    })
    const application = memoryApplication()
    await expect(startSelfHosted(application)).rejects.toMatchObject({ code: 'network_error' })
    expect(dependencies.openBrowser).toHaveBeenCalledOnce()
    await expect(stat(path.join(dataDirectory, 'pending-setups', 'private.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('configures an entered key once, then reports authentication failure without fallback or retry', async () => {
    const application = memoryApplication()
    await startSelfHosted(application)
    environment[BROWSER_API_KEY_ENV_VAR] = 'wrong-browser-api-key'
    await expect(application.setupBrowserComplete({ profile: 'private' })).resolves.toMatchObject({ status: 'configured' })
    await expect(application.setupBrowserComplete({ profile: 'private' }))
      .rejects.toMatchObject({ code: 'configuration_missing' })
    await expect(application.doctor({ profile: 'private' }))
      .rejects.toMatchObject({ code: 'authentication_failed' })
    expect(opened).toHaveLength(1)
    expect(server.requestLog.map((entry) => entry.path)).toEqual(['/v1/file/check-files'])
  })

  it('keeps setup secrets out of results while storing them in private plaintext files', async () => {
    const uid = server.uid
    const apiKey = server.apiKey
    environment[BROWSER_API_KEY_ENV_VAR] = apiKey
    const secrets = new PlaintextFileSecretStore(dataDirectory)
    const application = new ShareNoteApplication(dataDirectory, secrets, fetch, environment, dependencies)
    const started = await startSelfHosted(application)
    const completed = await application.setupBrowserComplete({ profile: 'private' })
    const publicOutput = JSON.stringify({ started, completed })
    for (const secret of [uid, apiKey, 'x-sharenote-key', opened[0]!.url]) {
      expect(publicOutput).not.toContain(secret)
    }
    expect(environment[BROWSER_API_KEY_ENV_VAR]).toBeUndefined()

    const persistedFiles = await filesBelow(dataDirectory)
    const persisted = (await Promise.all(persistedFiles.map((file) => readFile(file, 'utf8')))).join('\n')
    expect(persisted).toContain(uid)
    expect(persisted).toContain(apiKey)
    for (const secret of ['x-sharenote-key', opened[0]!.url]) {
      expect(persisted).not.toContain(secret)
    }
    if (process.platform !== 'win32') {
      for (const file of persistedFiles) {
        expect((await stat(file)).mode & 0o777).toBe(0o600)
      }
    }
    await expect(application.doctor({ profile: 'private' })).resolves.toMatchObject({ status: 'healthy' })
  })
})
