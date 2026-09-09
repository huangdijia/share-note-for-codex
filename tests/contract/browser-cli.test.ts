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
