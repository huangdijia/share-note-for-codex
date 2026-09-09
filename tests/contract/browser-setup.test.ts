import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BROWSER_API_KEY_ENV_VAR,
  ShareNoteApplication,
  type BrowserSetupDependencies
} from '../../src/app.js'
import { PlaintextFileSecretStore } from '../../src/secrets/plaintext-file.js'
import { MemorySecretStore } from '../helpers/memory-secret-store.js'
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
    workspace = await realpath(await mkdtemp(path.join(tmpdir(), 'share-note-browser-workspace-')))
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

  function selfHostedRequest(profile = 'private', allowedSourceRoots?: string[]) {
    return {
      profile,
      service: 'self-hosted' as const,
      projectRoot: workspace,
      apiBaseUrl: server.apiBaseUrl,
      webBaseUrl: server.webBaseUrl,
      confirmedApiOrigin: server.apiBaseUrl,
      confirmedWebOrigin: server.webBaseUrl,
      ...(allowedSourceRoots === undefined ? {} : { allowedSourceRoots }),
      allowInsecureLoopback: true,
      expiresInSeconds: 60
    }
  }

  async function expectNotConfigured(profile = 'private'): Promise<void> {
    await expect(stat(path.join(dataDirectory, 'profiles', `${profile}.json`)))
      .rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(path.join(workspace, '.openai', 'share-note.json')))
      .rejects.toMatchObject({ code: 'ENOENT' })
    expect(await filesBelow(path.join(dataDirectory, 'secrets', 'credentials'))).toEqual([])
  }

  it('hands authorization to Codex, resumes it and completes a verified project binding', async () => {
    const application = memoryApplication()
    const request = selfHostedRequest()
    const first = await application.setupCodexBrowser(request)
    expect(first).toMatchObject({ status: 'awaiting_user', resumed: false, apiOrigin: server.apiBaseUrl })
    expect(new URL(first.authorizationUrl!).searchParams.get('id')).toBe(server.uid)
    expect(first.sessionId).toMatch(/^[a-f0-9]{64}$/)
    expect(opened).toEqual([])
    expect(server.requestLog).toEqual([])
    await expectNotConfigured()
    const second = await application.setupCodexBrowser(request)
    expect(second).toMatchObject({ sessionId: first.sessionId, authorizationUrl: first.authorizationUrl, resumed: true })
    environment[BROWSER_API_KEY_ENV_VAR] = server.apiKey
    const result = await application.setupCodexBrowserComplete({ ...request, sessionId: first.sessionId! })
    expect(result).toMatchObject({ action: 'setup-codex-browser-complete', status: 'configured', authentication: 'accepted' })
    expect(JSON.stringify(result)).not.toContain(server.apiKey)
    expect(JSON.stringify(result)).not.toContain(server.uid)
    expect(environment[BROWSER_API_KEY_ENV_VAR]).toBeUndefined()
    expect(server.requestLog.map((entry) => entry.path)).toEqual(['/v1/file/check-files'])
    expect(JSON.parse(await readFile(path.join(workspace, '.openai', 'share-note.json'), 'utf8')).profile).toBe('private')
    await expect(stat(path.join(dataDirectory, 'pending-setups', 'private.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(application.setupCodexBrowserComplete({ ...request, sessionId: first.sessionId! })).rejects.toMatchObject({ code: 'conflict' })
    expect(await application.setupCodexBrowser(request)).toMatchObject({ status: 'configured', reusedCredential: true })
    expect(opened).toEqual([])
  })

  it('rejects missing, incorrect and cross-project Codex sessions before authentication', async () => {
    const application = memoryApplication()
    const request = selfHostedRequest()
    const prepared = await application.setupCodexBrowser(request)
    for (const sessionId of ['', '0'.repeat(64)]) {
      environment[BROWSER_API_KEY_ENV_VAR] = server.apiKey
      await expect(application.setupCodexBrowserComplete({ ...request, sessionId })).rejects.toBeInstanceOf(Error)
      expect(environment[BROWSER_API_KEY_ENV_VAR]).toBeUndefined()
    }
    const other = path.join(workspace, 'other')
    await mkdir(other)
    await expect(application.setupCodexBrowserComplete({
      ...request, projectRoot: other, allowedSourceRoots: [workspace], sessionId: prepared.sessionId!
    })).rejects.toMatchObject({ code: 'conflict' })
    expect(server.requestLog).toEqual([])
    await expectNotConfigured()
  })

  it('does not create a replacement pending session on expired or cancelled Codex completion', async () => {
    const application = memoryApplication()
    const request = selfHostedRequest()
    const prepared = await application.setupCodexBrowser(request)
    now += 61_000
    environment[BROWSER_API_KEY_ENV_VAR] = server.apiKey
    await expect(application.setupCodexBrowserComplete({ ...request, sessionId: prepared.sessionId! })).rejects.toMatchObject({ code: 'conflict' })
    await expect(stat(path.join(dataDirectory, 'pending-setups', 'private.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    const replacement = await application.setupCodexBrowser(request)
    expect(replacement.sessionId).not.toBe(prepared.sessionId)
    await expect(application.setupCodexBrowserComplete({ ...request, sessionId: prepared.sessionId! })).rejects.toMatchObject({ code: 'conflict' })
    await application.setupBrowserComplete({ profile: 'private', cancel: true })
    await expect(application.setupCodexBrowserComplete({ ...request, sessionId: replacement.sessionId! })).rejects.toMatchObject({ code: 'conflict' })
    expect(opened).toEqual([])
    expect(server.requestLog).toEqual([])
    await expectNotConfigured()
  })

  it('retains the Codex session after missing or rejected tokens and validates before saving', async () => {
    const application = new ShareNoteApplication(dataDirectory, new PlaintextFileSecretStore(dataDirectory), fetch, environment, dependencies)
    const request = selfHostedRequest()
    const prepared = await application.setupCodexBrowser(request)
    const complete = { ...request, sessionId: prepared.sessionId! }
    for (const apiKey of ['', 'wrong-key']) {
      environment[BROWSER_API_KEY_ENV_VAR] = apiKey
      await expect(application.setupCodexBrowserComplete(complete)).rejects.toBeInstanceOf(Error)
      expect(environment[BROWSER_API_KEY_ENV_VAR]).toBeUndefined()
      await expectNotConfigured()
      expect(await application.setupCodexBrowser(request)).toMatchObject({ sessionId: prepared.sessionId })
    }
    environment[BROWSER_API_KEY_ENV_VAR] = server.apiKey
    await expect(application.setupCodexBrowserComplete(complete)).resolves.toMatchObject({ status: 'configured' })
  })

  it('rejects changed Codex source configuration without opening or contacting a service', async () => {
    const application = memoryApplication()
    const request = selfHostedRequest()
    const prepared = await application.setupCodexBrowser(request)
    environment[BROWSER_API_KEY_ENV_VAR] = server.apiKey
    await expect(application.setupCodexBrowserComplete({ ...request, maxSourceBytes: 1024, sessionId: prepared.sessionId! }))
      .rejects.toMatchObject({ code: 'source_blocked' })
    expect(server.requestLog).toEqual([])
    expect(opened).toEqual([])
    await expectNotConfigured()
  })

  it('allows only one concurrent Codex completion to consume a session', async () => {
    const application = memoryApplication()
    const request = selfHostedRequest()
    const prepared = await application.setupCodexBrowser(request)
    const complete = { ...request, sessionId: prepared.sessionId! }
    environment[BROWSER_API_KEY_ENV_VAR] = server.apiKey
    const first = application.setupCodexBrowserComplete(complete)
    environment[BROWSER_API_KEY_ENV_VAR] = server.apiKey
    const second = application.setupCodexBrowserComplete(complete)
    const results = await Promise.allSettled([first, second])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(server.requestLog.map((entry) => entry.path)).toEqual(['/v1/file/check-files'])
  })

  it('can finish a Codex pending session through manual input without changing identity', async () => {
    const application = memoryApplication()
    const request = selfHostedRequest()
    await application.setupCodexBrowser(request)
    const readKey = vi.fn(async () => server.apiKey)
    await expect(application.setupBrowser(request, readKey)).resolves.toMatchObject({ status: 'configured', resumed: true })
    expect(readKey).toHaveBeenCalledOnce()
    expect(opened).toEqual([])
  })

  it('rejects a project rebound after Codex prepare before authentication', async () => {
    const application = memoryApplication()
    const request = selfHostedRequest()
    const prepared = await application.setupCodexBrowser(request)
    environment.EXISTING_KEY = JSON.stringify({ uid: server.uid, apiKey: server.apiKey })
    await application.setup({ ...request, profile: 'other', allowedSourceRoots: [workspace], credentialEnvVar: 'EXISTING_KEY' })
    await application.configureProject({ projectRoot: workspace, profile: 'other' })
    environment[BROWSER_API_KEY_ENV_VAR] = server.apiKey
    await expect(application.setupCodexBrowserComplete({ ...request, sessionId: prepared.sessionId! })).rejects.toMatchObject({ code: 'conflict' })
    expect(server.requestLog).toEqual([])
    expect(JSON.parse(await readFile(path.join(workspace, '.openai', 'share-note.json'), 'utf8')).profile).toBe('other')
    await expect(stat(path.join(dataDirectory, 'profiles', 'private.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('configures and binds a project in one call, then reuses the verified credential', async () => {
    const order: string[] = []
    dependencies.openBrowser = async (url, approvedOrigin) => {
      order.push('browser')
      opened.push({ url, approvedOrigin })
    }
    const application = new ShareNoteApplication(
      dataDirectory,
      new PlaintextFileSecretStore(dataDirectory),
      fetch,
      environment,
      dependencies
    )
    const prepareInput = vi.fn(() => { order.push('prepare') })
    const readApiKey = vi.fn(async () => {
      order.push('read')
      return server.apiKey
    })

    await expect(application.setupBrowser(selfHostedRequest(), readApiKey, prepareInput)).resolves.toMatchObject({
      action: 'setup-browser',
      status: 'configured',
      profile: 'private',
      projectRoot: workspace,
      authentication: 'accepted',
      reusedCredential: false,
      resumed: false,
      warnings: expect.any(Array)
    })
    expect(order).toEqual(['prepare', 'browser', 'read'])
    expect(opened).toHaveLength(1)
    expect(JSON.parse(await readFile(path.join(workspace, '.openai', 'share-note.json'), 'utf8')))
      .toMatchObject({ schemaVersion: 1, profile: 'private' })
    expect(JSON.parse(await readFile(path.join(dataDirectory, 'profiles', 'private.json'), 'utf8')))
      .toMatchObject({ name: 'private', allowedSourceRoots: [workspace] })

    const unexpectedRead = vi.fn(async () => { throw new Error('must not read a replacement key') })
    const unexpectedPrepare = vi.fn(() => { throw new Error('must not prepare hidden input') })
    await expect(application.setupBrowser(selfHostedRequest(), unexpectedRead, unexpectedPrepare)).resolves.toMatchObject({
      action: 'setup-browser',
      status: 'configured',
      profile: 'private',
      projectRoot: workspace,
      authentication: 'accepted',
      reusedCredential: true,
      resumed: false
    })
    expect(unexpectedPrepare).not.toHaveBeenCalled()
    expect(unexpectedRead).not.toHaveBeenCalled()
    expect(opened).toHaveLength(1)
  })

  it('resumes a matching pending setup without opening a second browser', async () => {
    const application = memoryApplication()
    await startSelfHosted(application)
    const prepareInput = vi.fn()
    const readApiKey = vi.fn(async () => server.apiKey)

    await expect(application.setupBrowser(selfHostedRequest(), readApiKey, prepareInput)).resolves.toMatchObject({
      action: 'setup-browser',
      status: 'configured',
      profile: 'private',
      projectRoot: workspace,
      authentication: 'accepted',
      reusedCredential: false,
      resumed: true
    })
    expect(prepareInput).toHaveBeenCalledOnce()
    expect(readApiKey).toHaveBeenCalledOnce()
    expect(opened).toHaveLength(1)
    await expect(stat(path.join(dataDirectory, 'pending-setups', 'private.json')))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps a matching pending setup after a wrong key and succeeds on retry without partial writes', async () => {
    const application = new ShareNoteApplication(
      dataDirectory,
      new PlaintextFileSecretStore(dataDirectory),
      fetch,
      environment,
      dependencies
    )

    await expect(application.setupBrowser(
      selfHostedRequest(),
      async () => 'wrong-browser-api-key',
      vi.fn()
    )).rejects.toMatchObject({ code: 'authentication_failed' })
    await expectNotConfigured()
    expect((await stat(path.join(dataDirectory, 'pending-setups', 'private.json'))).isFile()).toBe(true)
    expect(opened).toHaveLength(1)

    await expect(application.setupBrowser(
      selfHostedRequest(),
      async () => server.apiKey,
      vi.fn()
    )).resolves.toMatchObject({
      status: 'configured',
      authentication: 'accepted',
      reusedCredential: false,
      resumed: true
    })
    expect(opened).toHaveLength(1)
    await expect(application.doctor({ profile: 'private' })).resolves.toMatchObject({ status: 'healthy' })
  })

  it('keeps the same pending identity after an ambiguous 403 and succeeds when the service recovers', async () => {
    const secrets = new PlaintextFileSecretStore(dataDirectory)
    const privateResponseBody = 'private edge rejection detail'
    let serviceBlocked = true
    const controlledFetch = vi.fn(async (...arguments_: Parameters<typeof fetch>) => {
      if (serviceBlocked) return new Response(privateResponseBody, { status: 403 })
      return fetch(...arguments_)
    }) as typeof fetch
    const application = new ShareNoteApplication(dataDirectory, secrets, controlledFetch, environment, dependencies)

    const error = await application.setupBrowser(
      selfHostedRequest(),
      async () => server.apiKey,
      vi.fn()
    ).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'network_error', details: { status: 403 } })
    expect(JSON.stringify(error)).not.toContain(privateResponseBody)
    await expectNotConfigured()

    const pendingPath = path.join(dataDirectory, 'pending-setups', 'private.json')
    const pending = JSON.parse(await readFile(pendingPath, 'utf8')) as { uid: string; bindingHash: string }
    expect(pending.uid).toBe(server.uid)
    expect(new URL(opened[0]!.url).searchParams.get('id')).toBe(pending.uid)

    serviceBlocked = false
    await expect(application.setupBrowser(
      selfHostedRequest(),
      async () => server.apiKey,
      vi.fn()
    )).resolves.toMatchObject({
      status: 'configured',
      authentication: 'accepted',
      reusedCredential: false,
      resumed: true
    })
    expect(opened).toHaveLength(1)
    await expect(stat(pendingPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(secrets.readCredential({ type: 'plaintext-file', id: 'credentials:private' }))
      .resolves.toEqual({ uid: pending.uid, apiKey: server.apiKey })
  })

  it('rejects source changes while a setup is pending', async () => {
    const application = memoryApplication()
    await expect(application.setupBrowser(
      selfHostedRequest(),
      async () => 'wrong-browser-api-key',
      vi.fn()
    )).rejects.toMatchObject({ code: 'authentication_failed' })
    const differentRoot = path.join(workspace, 'different-root')
    await mkdir(differentRoot)
    const prepareInput = vi.fn()
    const readApiKey = vi.fn(async () => server.apiKey)

    await expect(application.setupBrowser(
      selfHostedRequest('private', [differentRoot]),
      readApiKey,
      prepareInput
    )).rejects.toMatchObject({ code: 'source_blocked' })
    expect(prepareInput).not.toHaveBeenCalled()
    expect(readApiKey).not.toHaveBeenCalled()
    expect(opened).toHaveLength(1)
  })

  it('does not rotate an existing profile when its credential is rejected', async () => {
    environment.EXISTING_CREDENTIAL = JSON.stringify({
      uid: server.uid,
      apiKey: 'wrong-existing-api-key'
    })
    const application = memoryApplication()
    await application.setup({
      profile: 'private',
      apiBaseUrl: server.apiBaseUrl,
      webBaseUrl: server.webBaseUrl,
      allowedSourceRoots: [workspace],
      allowInsecureLoopback: true,
      credentialEnvVar: 'EXISTING_CREDENTIAL'
    })
    const prepareInput = vi.fn()
    const readApiKey = vi.fn(async () => server.apiKey)

    await expect(application.setupBrowser(selfHostedRequest(), readApiKey, prepareInput))
      .rejects.toMatchObject({ code: 'authentication_failed' })
    expect(prepareInput).not.toHaveBeenCalled()
    expect(readApiKey).not.toHaveBeenCalled()
    expect(opened).toHaveLength(0)
    await expect(stat(path.join(workspace, '.openai', 'share-note.json')))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects invalid or differently bound projects before input and browser side effects', async () => {
    const application = memoryApplication()
    const prepareInput = vi.fn()
    const readApiKey = vi.fn(async () => server.apiKey)
    await expect(application.setupBrowser(
      { ...selfHostedRequest(), projectRoot: path.join(workspace, 'missing') },
      readApiKey,
      prepareInput
    )).rejects.toMatchObject({ code: 'invalid_request' })

    environment.OTHER_CREDENTIAL = JSON.stringify({ uid: server.uid, apiKey: server.apiKey })
    await application.setup({
      profile: 'other',
      apiBaseUrl: server.apiBaseUrl,
      webBaseUrl: server.webBaseUrl,
      allowedSourceRoots: [workspace],
      allowInsecureLoopback: true,
      credentialEnvVar: 'OTHER_CREDENTIAL'
    })
    await application.configureProject({ projectRoot: workspace, profile: 'other' })
    await expect(application.setupBrowser(selfHostedRequest(), readApiKey, prepareInput))
      .rejects.toMatchObject({ code: 'conflict' })
    expect(prepareInput).not.toHaveBeenCalled()
    expect(readApiKey).not.toHaveBeenCalled()
    expect(opened).toHaveLength(0)
  })

  it('rejects an existing profile whose source roots do not cover the requested project', async () => {
    const otherProject = await realpath(await mkdtemp(path.join(tmpdir(), 'share-note-browser-other-project-')))
    try {
      environment.EXISTING_CREDENTIAL = JSON.stringify({ uid: server.uid, apiKey: server.apiKey })
      const application = memoryApplication()
      await application.setup({
        profile: 'private',
        apiBaseUrl: server.apiBaseUrl,
        webBaseUrl: server.webBaseUrl,
        allowedSourceRoots: [workspace],
        allowInsecureLoopback: true,
        credentialEnvVar: 'EXISTING_CREDENTIAL'
      })
      const prepareInput = vi.fn()
      const readApiKey = vi.fn(async () => server.apiKey)

      await expect(application.setupBrowser(
        { ...selfHostedRequest(), projectRoot: otherProject },
        readApiKey,
        prepareInput
      )).rejects.toMatchObject({ code: 'source_blocked' })
      expect(prepareInput).not.toHaveBeenCalled()
      expect(readApiKey).not.toHaveBeenCalled()
      expect(opened).toHaveLength(0)
      await expect(stat(path.join(otherProject, '.openai', 'share-note.json')))
        .rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(otherProject, { recursive: true, force: true })
    }
  })

  it('allows a project profile restricted to a source root inside that project', async () => {
    const docs = path.join(workspace, 'docs')
    await mkdir(docs)
    const application = memoryApplication()

    await expect(application.setupBrowser(
      selfHostedRequest('private', [docs]),
      async () => server.apiKey,
      vi.fn()
    )).resolves.toMatchObject({
      status: 'configured',
      profile: 'private',
      projectRoot: workspace,
      authentication: 'accepted'
    })
    expect(opened).toHaveLength(1)
    expect(JSON.parse(await readFile(path.join(dataDirectory, 'profiles', 'private.json'), 'utf8')))
      .toMatchObject({ allowedSourceRoots: [docs] })
  })

  it('does not overwrite a project binding that changes while browser input is pending', async () => {
    const secrets = new MemorySecretStore()
    const application = new ShareNoteApplication(dataDirectory, secrets, fetch, environment, dependencies)
    environment.OTHER_CREDENTIAL = JSON.stringify({ uid: server.uid, apiKey: server.apiKey })
    await application.setup({
      profile: 'other',
      apiBaseUrl: server.apiBaseUrl,
      webBaseUrl: server.webBaseUrl,
      allowedSourceRoots: [workspace],
      allowInsecureLoopback: true,
      credentialEnvVar: 'OTHER_CREDENTIAL'
    })

    await expect(application.setupBrowser(selfHostedRequest(), async () => {
      await application.configureProject({ projectRoot: workspace, profile: 'other' })
      return server.apiKey
    }, vi.fn())).rejects.toMatchObject({ code: 'conflict' })
    expect(JSON.parse(await readFile(path.join(workspace, '.openai', 'share-note.json'), 'utf8')))
      .toMatchObject({ profile: 'other' })
    await expect(stat(path.join(dataDirectory, 'profiles', 'private.json')))
      .rejects.toMatchObject({ code: 'ENOENT' })
    expect((await stat(path.join(dataDirectory, 'pending-setups', 'private.json'))).isFile()).toBe(true)
  })

  it('does not overwrite a same-name profile configured while browser input is pending', async () => {
    const secrets = new MemorySecretStore()
    const application = new ShareNoteApplication(dataDirectory, secrets, fetch, environment, dependencies)

    await expect(application.setupBrowser(selfHostedRequest(), async () => {
      environment.RACING_CREDENTIAL = JSON.stringify({ uid: 'racing-user', apiKey: 'racing-key' })
      await application.setup({
        profile: 'private',
        apiBaseUrl: server.apiBaseUrl,
        webBaseUrl: server.webBaseUrl,
        allowedSourceRoots: [workspace],
        allowInsecureLoopback: true,
        maxSourceBytes: 1234,
        credentialEnvVar: 'RACING_CREDENTIAL'
      })
      return server.apiKey
    }, vi.fn())).rejects.toMatchObject({ code: 'conflict' })
    expect(JSON.parse(await readFile(path.join(dataDirectory, 'profiles', 'private.json'), 'utf8')))
      .toMatchObject({ name: 'private', maxSourceBytes: 1234 })
    await expect(secrets.readCredential({ type: 'plaintext-file', id: 'credentials:private' }))
      .resolves.toEqual({ uid: 'racing-user', apiKey: 'racing-key' })
    await expect(stat(path.join(workspace, '.openai', 'share-note.json')))
      .rejects.toMatchObject({ code: 'ENOENT' })
    expect((await stat(path.join(dataDirectory, 'pending-setups', 'private.json'))).isFile()).toBe(true)
  })

  it('does not open the browser or write a profile when input preflight fails', async () => {
    const application = new ShareNoteApplication(
      dataDirectory,
      new PlaintextFileSecretStore(dataDirectory),
      fetch,
      environment,
      dependencies
    )
    const readApiKey = vi.fn(async () => server.apiKey)
    const prepareInput = vi.fn(() => { throw new Error('stdin is unavailable') })

    await expect(application.setupBrowser(selfHostedRequest(), readApiKey, prepareInput))
      .rejects.toThrow('stdin is unavailable')
    expect(readApiKey).not.toHaveBeenCalled()
    expect(opened).toHaveLength(0)
    await expectNotConfigured()
  })

  it('does not persist credentials, profiles, or project binding when input expires', async () => {
    const application = new ShareNoteApplication(
      dataDirectory,
      new PlaintextFileSecretStore(dataDirectory),
      fetch,
      environment,
      dependencies
    )

    await expect(application.setupBrowser(selfHostedRequest(), async () => {
      now += 60_001
      return server.apiKey
    }, vi.fn())).rejects.toMatchObject({ code: 'configuration_missing' })
    expect(opened).toHaveLength(1)
    await expectNotConfigured()
    await expect(stat(path.join(dataDirectory, 'pending-setups', 'private.json')))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

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

  it('validates the legacy completion key before persistence and keeps pending state for retry', async () => {
    const application = new ShareNoteApplication(
      dataDirectory,
      new PlaintextFileSecretStore(dataDirectory),
      fetch,
      environment,
      dependencies
    )
    await startSelfHosted(application)
    environment[BROWSER_API_KEY_ENV_VAR] = 'wrong-browser-api-key'
    await expect(application.setupBrowserComplete({ profile: 'private' }))
      .rejects.toMatchObject({ code: 'authentication_failed' })
    expect(environment[BROWSER_API_KEY_ENV_VAR]).toBeUndefined()
    await expectNotConfigured()
    expect((await stat(path.join(dataDirectory, 'pending-setups', 'private.json'))).isFile()).toBe(true)

    environment[BROWSER_API_KEY_ENV_VAR] = server.apiKey
    await expect(application.setupBrowserComplete({ profile: 'private' })).resolves.toMatchObject({
      action: 'setup-browser-complete',
      status: 'configured'
    })
    await expect(application.doctor({ profile: 'private' })).resolves.toMatchObject({ status: 'healthy' })
    expect(opened).toHaveLength(1)
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
