import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ShareNoteApplication } from '../../src/app.js'
import { PlaintextFileSecretStore } from '../../src/secrets/plaintext-file.js'
import { MockShareNoteServer } from '../helpers/mock-share-note-server.js'

describe('M2 encrypted publish and verification', () => {
  let server: MockShareNoteServer
  let dataDirectory: string
  let workspace: string
  let sourcePath: string
  let application: ShareNoteApplication

  beforeEach(async () => {
    server = new MockShareNoteServer()
    await server.start()
    dataDirectory = await mkdtemp(path.join(tmpdir(), 'share-note-m2-data-'))
    workspace = await mkdtemp(path.join(tmpdir(), 'share-note-m2-workspace-'))
    sourcePath = path.join(workspace, 'report.md')
    await writeFile(sourcePath, '# M2 secret 🚀\n\nOnly encrypted content may leave the client.')
    application = new ShareNoteApplication(
      dataDirectory,
      new PlaintextFileSecretStore(dataDirectory),
      fetch,
      { MOCK_CREDENTIAL: JSON.stringify({ uid: server.uid, apiKey: server.apiKey }) }
    )
    await application.setup({
      profile: 'mock',
      apiBaseUrl: server.apiBaseUrl,
      webBaseUrl: server.webBaseUrl,
      allowedSourceRoots: [workspace],
      allowInsecureLoopback: true,
      credentialEnvVar: 'MOCK_CREDENTIAL'
    })
    await application.configureProject({ projectRoot: workspace, profile: 'mock' })
  })

  afterEach(async () => {
    await server.close()
    await rm(dataDirectory, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  })

  async function preview() {
    return application.preview({
      sourcePath: 'report.md',
      projectRoot: workspace
    })
  }

  function publishRequest(result: Awaited<ReturnType<typeof preview>>, returnShareUrl = true) {
    return {
      projectRoot: workspace,
      previewId: result.previewId,
      expectedContentHash: result.contentHash,
      authorization: {
        granted: true as const,
        action: 'publish' as const,
        profile: 'mock',
        projectBindingHash: result.projectBindingHash,
        contentHash: result.contentHash,
        encryption: 'encrypted' as const
      },
      returnShareUrl
    }
  }

  it('publishes encrypted content and verifies title and body hash', async () => {
    const localPreview = await preview()
    const result = await application.publish(publishRequest(localPreview))
    expect(result).toMatchObject({
      ok: true,
      status: 'verified',
      encrypted: true,
      verification: { fetched: true, decrypted: true, contentMatched: true }
    })
    expect(result.shareUrl).toContain('#')
    const rawPage = await (await fetch(result.shareUrl!.split('#')[0]!)).text()
    expect(rawPage).toContain('encrypted-data')
    expect(rawPage).not.toContain('Only encrypted content may leave the client.')
    expect(server.requestLog.filter((entry) => entry.path === '/v1/file/create-note')).toHaveLength(1)
    expect(server.requestLog.at(-2)).toMatchObject({ method: 'GET', credentialed: false })
  })

  it('does not expose a full fragment URL unless requested', async () => {
    const localPreview = await preview()
    const result = await application.publish(publishRequest(localPreview, false))
    expect(result).not.toHaveProperty('shareUrl')
    const persisted = await readFile(path.join(workspace, '.openai', 'share-note.json'), 'utf8')
    expect(persisted).not.toContain('#')
    expect(persisted).not.toContain('Only encrypted content may leave the client.')
  })

  it('keeps fragment keys only in the ignored project key file', async () => {
    const localPreview = await preview()
    const result = await application.publish(publishRequest(localPreview, true))
    const fragmentKey = result.shareUrl!.split('#')[1]!
    const manifest = await readFile(path.join(workspace, '.openai', 'share-note.json'), 'utf8')
    const keyFile = path.join(workspace, '.openai', 'share-note.keys.json')
    const keys = await readFile(keyFile, 'utf8')
    const ignore = await readFile(path.join(workspace, '.openai', '.gitignore'), 'utf8')
    const userDataContents: string[] = []
    async function collect(directory: string): Promise<void> {
      for (const entry of await readdir(directory)) {
        const candidate = path.join(directory, entry)
        if ((await stat(candidate)).isDirectory()) await collect(candidate)
        else userDataContents.push(await readFile(candidate, 'utf8'))
      }
    }
    await collect(dataDirectory)
    expect(manifest).not.toContain(server.apiKey)
    expect(manifest).not.toContain(fragmentKey)
    expect(keys).toContain(fragmentKey)
    expect(userDataContents.join('\n')).toContain(server.apiKey)
    expect(userDataContents.join('\n')).not.toContain(fragmentKey)
    expect(ignore.split(/\r?\n/)).toContain('share-note.keys.json')
    if (process.platform !== 'win32') expect((await stat(keyFile)).mode & 0o777).toBe(0o600)
  })

  it('blocks changed source content before any create request', async () => {
    const localPreview = await preview()
    await writeFile(sourcePath, '# changed after preview')
    await expect(application.publish(publishRequest(localPreview)))
      .rejects.toMatchObject({ code: 'content_blocked' })
    expect(server.requestLog.filter((entry) => entry.path === '/v1/file/create-note')).toHaveLength(0)
  })

  it('blocks missing or mismatched explicit authorization', async () => {
    const localPreview = await preview()
    const request = publishRequest(localPreview)
    request.authorization.contentHash = '0'.repeat(64)
    await expect(application.publish(request)).rejects.toMatchObject({ code: 'content_blocked' })
    expect(server.requestLog.filter((entry) => entry.path === '/v1/file/create-note')).toHaveLength(0)
  })

  it('blocks a credential-like secret discovered during preview', async () => {
    await writeFile(sourcePath, '# Do not publish\n\napi_key = "abcdefghijklmnop123456"')
    const localPreview = await preview()
    expect(localPreview).toMatchObject({ status: 'blocked', publishable: false })
    await expect(application.publish(publishRequest(localPreview)))
      .rejects.toMatchObject({ code: 'content_blocked' })
    expect(server.requestLog.filter((entry) => entry.path === '/v1/file/create-note')).toHaveLength(0)
  })

  it('returns unknown and does not retry when the create response is lost', async () => {
    server.setBehavior({ dropCreateResponse: true })
    const localPreview = await preview()
    const result = await application.publish(publishRequest(localPreview))
    expect(result).toMatchObject({ ok: false, status: 'unknown' })
    expect(result).not.toHaveProperty('shareUrl')
    expect(server.requestLog.filter((entry) => entry.path === '/v1/file/create-note')).toHaveLength(1)
    const manifest = await readFile(path.join(workspace, '.openai', 'share-note.json'), 'utf8')
    expect(manifest).toContain('"status": "unknown"')
  })

  it('reports submitted_unverified when the returned page cannot be matched', async () => {
    server.setBehavior({ createReturnsDifferentUrl: true })
    const localPreview = await preview()
    const result = await application.publish(publishRequest(localPreview))
    expect(result).toMatchObject({
      ok: false,
      status: 'submitted_unverified',
      verification: { fetched: false, decrypted: false, contentMatched: false }
    })
  })
})
