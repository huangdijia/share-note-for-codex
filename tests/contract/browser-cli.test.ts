import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ShareNoteApplication } from '../../src/app.js'
import { PlaintextFileSecretStore } from '../../src/secrets/plaintext-file.js'
import { MockShareNoteServer } from '../helpers/mock-share-note-server.js'

const execute = promisify(execFile)
const bundle = path.resolve('plugins/share-note/skills/share-note/scripts/share-note.mjs')

describe('one-command browser setup in the shipped CLI', () => {
  let directory: string
  let server: MockShareNoteServer

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'share-note-browser-cli-'))
    server = new MockShareNoteServer()
    await server.start()
  })

  afterEach(async () => {
    await server.close()
    await rm(directory, { recursive: true, force: true })
  })

  it('rejects the no-request shortcut without a TTY before creating authorization state', async () => {
    const data = path.join(directory, 'data')
    await expect(execute(process.execPath, [bundle, 'setup-browser'], {
      cwd: directory,
      env: { ...process.env, SHARE_NOTE_DATA_DIR: data, SHARE_NOTE_BROWSER_API_KEY: '' }
    })).rejects.toMatchObject({
      stdout: expect.stringContaining('"code":"secure_store_unavailable"')
    })
    await expect(stat(path.join(data, 'pending-setups', 'public.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(path.join(directory, '.openai'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(server.requestLog).toHaveLength(0)
  })

  it('prepares Codex authorization without a TTY and completes through the shipped CLI', async () => {
    const data = path.join(directory, 'codex-data')
    const request = {
      profile: 'codex', service: 'self-hosted', projectRoot: directory,
      apiBaseUrl: server.apiBaseUrl, webBaseUrl: server.webBaseUrl,
      confirmedApiOrigin: server.apiBaseUrl, confirmedWebOrigin: server.webBaseUrl,
      allowInsecureLoopback: true
    }
    const requestPath = path.join(directory, 'codex.json')
    await writeFile(requestPath, JSON.stringify(request))
    const env = { ...process.env, SHARE_NOTE_DATA_DIR: data, SHARE_NOTE_BROWSER_API_KEY: '' }
    const prepared = await execute(process.execPath, [bundle, 'setup-codex-browser', '--request', requestPath], { env })
    const session = JSON.parse(prepared.stdout)
    expect(session).toMatchObject({ status: 'awaiting_user', apiOrigin: server.apiBaseUrl })
    // The mock accepts one configured identity; align it with the CLI's cryptographic UID.
    Object.defineProperty(server, 'uid', { value: new URL(session.authorizationUrl).searchParams.get('id')! })
    await writeFile(requestPath, JSON.stringify({ ...request, sessionId: session.sessionId }))
    const args = [bundle, 'setup-codex-browser-complete', '--request', requestPath]
    await expect(execute(process.execPath, args, { env })).rejects.toMatchObject({
      stdout: expect.stringContaining('"code":"credential_missing"')
    })
    const completed = await execute(process.execPath, args, {
      env: { ...env, SHARE_NOTE_BROWSER_API_KEY: server.apiKey }
    })
    expect(JSON.parse(completed.stdout)).toMatchObject({ status: 'configured', authentication: 'accepted' })
    expect(completed.stdout + completed.stderr).not.toContain(server.apiKey)
    expect(completed.stdout + completed.stderr).not.toContain(server.uid)
    expect(await readFile(requestPath, 'utf8')).not.toContain(server.apiKey)
    expect(server.requestLog.map((entry) => entry.path)).toEqual(['/v1/file/check-files'])
    await expect(execute(process.execPath, args, { env })).rejects.toMatchObject({
      stdout: expect.stringContaining('"code":"conflict"')
    })
  })

  it('supports the public Codex shortcut and rejects credentials in its request file', async () => {
    const data = path.join(directory, 'public-data')
    const env = { ...process.env, SHARE_NOTE_DATA_DIR: data, SHARE_NOTE_BROWSER_API_KEY: '' }
    const prepared = await execute(process.execPath, [bundle, 'setup-codex-browser'], { cwd: directory, env })
    expect(JSON.parse(prepared.stdout)).toMatchObject({ status: 'awaiting_user', apiOrigin: 'https://api.note.sx' })
    const requestPath = path.join(directory, 'unsafe.json')
    await writeFile(requestPath, JSON.stringify({ profile: 'public', service: 'public', projectRoot: directory, apiKey: 'do-not-print' }))
    const error = await execute(process.execPath, [bundle, 'setup-codex-browser', '--request', requestPath], { env }).catch((error: unknown) => error)
    expect(error).toMatchObject({ stdout: expect.stringContaining('"code":"invalid_request"') })
    expect(JSON.stringify(error)).not.toContain('do-not-print')
  })

  it('requires a real terminal for explicit Codex hidden input and never silently uses an environment key', async () => {
    const requestPath = path.join(directory, 'tty.json')
    await writeFile(requestPath, JSON.stringify({ profile: 'public', service: 'public', projectRoot: directory, sessionId: '0'.repeat(64) }))
    await expect(execute(process.execPath, [bundle, 'setup-codex-browser-complete', '--request', requestPath, '--key-tty'], {
      env: { ...process.env, SHARE_NOTE_DATA_DIR: path.join(directory, 'tty-data'), SHARE_NOTE_BROWSER_API_KEY: server.apiKey }
    })).rejects.toMatchObject({ stdout: expect.stringContaining('"code":"secure_store_unavailable"') })
    expect(server.requestLog).toEqual([])
  })

  it('resumes with a process-scoped key, binds the project and reuses credentials without a TTY', async () => {
    const data = path.join(directory, 'data')
    const application = new ShareNoteApplication(data, new PlaintextFileSecretStore(data), fetch, {}, {
      now: Date.now,
      createUid: () => server.uid,
      openBrowser: async () => {}
    })
    const request = {
      profile: 'cli',
      service: 'self-hosted' as const,
      apiBaseUrl: server.apiBaseUrl,
      webBaseUrl: server.webBaseUrl,
      confirmedApiOrigin: server.apiBaseUrl,
      confirmedWebOrigin: server.webBaseUrl,
      allowInsecureLoopback: true,
      projectRoot: directory,
      allowedSourceRoots: [directory]
    }
    await application.setupBrowserStart(request)
    const requestPath = path.join(directory, 'request.json')
    await writeFile(requestPath, JSON.stringify(request))
    const arguments_ = [bundle, 'setup-browser', '--request', requestPath]
    const first = await execute(process.execPath, arguments_, {
      env: { ...process.env, SHARE_NOTE_DATA_DIR: data, SHARE_NOTE_BROWSER_API_KEY: server.apiKey }
    })
    expect(JSON.parse(first.stdout)).toMatchObject({
      action: 'setup-browser', status: 'configured', authentication: 'accepted', resumed: true, reusedCredential: false
    })
    const second = await execute(process.execPath, arguments_, {
      env: { ...process.env, SHARE_NOTE_DATA_DIR: data, SHARE_NOTE_BROWSER_API_KEY: '' }
    })
    expect(JSON.parse(second.stdout)).toMatchObject({
      action: 'setup-browser', status: 'configured', authentication: 'accepted', reusedCredential: true
    })
    for (const secret of [server.uid, server.apiKey]) {
      expect(first.stdout + first.stderr + second.stdout + second.stderr).not.toContain(secret)
    }
    expect(JSON.parse(await readFile(path.join(directory, '.openai', 'share-note.json'), 'utf8')))
      .toMatchObject({ profile: 'cli', records: [], operations: [] })
    expect(server.requestLog.map((entry) => entry.path)).toEqual(['/v1/file/check-files', '/v1/file/check-files'])
  })
})
