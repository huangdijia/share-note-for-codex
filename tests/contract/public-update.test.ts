import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ShareNoteApplication } from '../../src/app.js'
import { MemorySecretStore } from '../helpers/memory-secret-store.js'
import { MockShareNoteServer } from '../helpers/mock-share-note-server.js'

const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6GkAAAAASUVORK5CYII=', 'base64')
describe('explicit public updates with independently uploaded images', () => {
  let server: MockShareNoteServer
  let dataDirectory: string
  let workspace: string
  let application: ShareNoteApplication
  let afterImageRead: (() => Promise<void>) | undefined
  let published: Awaited<ReturnType<ShareNoteApplication['publish']>>
  beforeEach(async () => {
    server = new MockShareNoteServer()
    await server.start()
    dataDirectory = await mkdtemp(path.join(tmpdir(), 'share-note-public-data-'))
    workspace = await mkdtemp(path.join(tmpdir(), 'share-note-public-source-'))
    afterImageRead = undefined
    application = new ShareNoteApplication(dataDirectory, new MemorySecretStore(), async (input, init) => {
      const response = await fetch(input, init)
      if (String(input).includes('/files/') && afterImageRead) await afterImageRead()
      return response
    }, {
      MOCK_CREDENTIAL: JSON.stringify({ uid: server.uid, apiKey: server.apiKey })
    })
    await application.setup({ profile: 'mock', apiBaseUrl: server.apiBaseUrl, webBaseUrl: server.webBaseUrl, allowedSourceRoots: [workspace], allowInsecureLoopback: true, credentialEnvVar: 'MOCK_CREDENTIAL' })
    await application.configureProject({ projectRoot: workspace, profile: 'mock' })
    await writeFile(path.join(workspace, 'note.md'), '# Public candidate\n\n![Banner](banner.png)')
    await writeFile(path.join(workspace, 'banner.png'), image)
    const preview = await application.preview({ projectRoot: workspace, sourcePath: 'note.md', theme: 'github' })
    published = await application.publish({ projectRoot: workspace, previewId: preview.previewId, expectedContentHash: preview.contentHash, authorization: { granted: true, action: 'publish', profile: 'mock', projectBindingHash: preview.projectBindingHash, contentHash: preview.contentHash, encryption: 'encrypted' }, returnShareUrl: true })
    expect(published.ok).toBe(true)
  })
  afterEach(async () => {
    await server.close()
    await rm(dataDirectory, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  })
  async function preview() {
    return application.preview({ projectRoot: workspace, sourcePath: 'note.md', recordId: published.recordId, encryption: 'public', imageMode: 'upload' })
  }
  function request(value: Awaited<ReturnType<typeof preview>>) {
    return { projectRoot: workspace, recordId: published.recordId, previewId: value.previewId, expectedContentHash: value.contentHash, authorization: { granted: true as const, action: 'update' as const, profile: 'mock', projectBindingHash: value.projectBindingHash, recordId: published.recordId, contentHash: value.contentHash, encryption: 'public' as 'public' | 'encrypted', imageMode: 'upload' as 'upload' | 'inline' }, returnShareUrl: true }
  }
  function count(route: string) { return server.requestLog.filter((entry) => entry.path === route).length }

  it('updates to public images, reads anonymously, inherits mode, deduplicates and deletes without a fragment key', async () => {
    const before = server.requestLog.length
    const local = await preview()
    expect(server.requestLog).toHaveLength(before)
    const result = await application.update(request(local))
    expect(result).toMatchObject({ ok: true, verification: { fetched: true, decrypted: false, contentMatched: true } })
    expect(result.shareUrl).toBe(published.shareUrl!.split('#')[0])
    expect(count('/v1/file/upload')).toBe(1)
    const page = await (await fetch(result.shareUrl!)).text()
    expect(page).not.toContain('encrypted-data')
    expect(page).not.toContain('data:image/')
    expect(page).toContain('/files/abc/')
    const read = await application.read({ projectRoot: workspace, recordId: published.recordId, outputFormat: 'html' })
    expect(read.encrypted).toBe(false)
    expect(read.content).toContain('/files/abc/')
    expect(server.requestLog.filter((entry) => entry.method === 'GET').every((entry) => !entry.credentialed)).toBe(true)
    const next = await application.preview({ projectRoot: workspace, sourcePath: 'note.md', recordId: published.recordId })
    expect(next).toMatchObject({ encryption: 'public', imageMode: 'upload' })
    expect((await application.update(request(next))).ok).toBe(true)
    expect(count('/v1/file/upload')).toBe(1)
    const deleted = await application.delete({ projectRoot: workspace, recordId: published.recordId, authorization: { granted: true, action: 'delete', recordId: published.recordId }, verificationDelayMilliseconds: 0 })
    expect(deleted.ok).toBe(true)
  })

  it.each(['encryption', 'imageMode'] as const)('rejects mismatched %s authorization before network access', async (field) => {
    const local = await preview()
    const update = request(local)
    if (field === 'encryption') update.authorization.encryption = 'encrypted'
    else update.authorization.imageMode = 'inline'
    const before = server.requestLog.length
    await expect(application.update(update)).rejects.toMatchObject({ code: 'content_blocked' })
    expect(server.requestLog).toHaveLength(before)
  })

  it.each(['source', 'image'])('blocks changed %s before uploading', async (kind) => {
    const local = await preview()
    if (kind === 'source') await writeFile(path.join(workspace, 'note.md'), '# Changed')
    else await writeFile(path.join(workspace, 'banner.png'), Buffer.concat([image, Buffer.from('changed')]))
    await expect(application.update(request(local))).rejects.toMatchObject({ code: 'content_blocked' })
    expect(count('/v1/file/upload')).toBe(0)
  })

  it('preserves matching data URI literals in code while replacing only image sources', async () => {
    const uri = `data:image/png;base64,${image.toString('base64')}`
    await writeFile(path.join(workspace, 'note.md'), `# Public candidate\n\n![Banner](banner.png)\n\n\`\`\`text\n${uri}\n\`\`\``)
    const result = await application.update(request(await preview()))
    expect(result.ok).toBe(true)
    const page = await (await fetch(result.shareUrl!)).text()
    expect(page).toContain(`<code class="language-text">${uri}`)
    expect(page).toContain('<img src="' + server.webBaseUrl + '/files/')
  })

  it('rechecks source after uploads and keeps the verified upload ledger when source changed', async () => {
    const local = await preview()
    afterImageRead = async () => { await writeFile(path.join(workspace, 'note.md'), '# Changed during upload') }
    const creates = count('/v1/file/create-note')
    const result = await application.update(request(local))
    expect(result.status).toBe('failed')
    expect(count('/v1/file/create-note')).toBe(creates)
    expect(result.warnings.join(' ')).toContain('may remain public')
    const manifest = JSON.parse(await readFile(path.join(workspace, '.openai/share-note.json'), 'utf8'))
    expect(manifest.operations.at(-1).imageUploads[0]).toMatchObject({ status: 'verified', url: expect.stringContaining('/files/') })
  })

  it('records an ambiguous upload, does not write the note and blocks blind retries', async () => {
    server.setBehavior({ dropUploadResponse: true })
    const local = await preview()
    const creates = count('/v1/file/create-note')
    const result = await application.update(request(local))
    expect(result.status).toBe('unknown')
    expect(count('/v1/file/create-note')).toBe(creates)
    expect(count('/v1/file/upload')).toBe(1)
    await expect(application.update(request(local))).rejects.toMatchObject({ code: 'content_blocked' })
    expect(count('/v1/file/upload')).toBe(1)
    const manifest = JSON.parse(await readFile(path.join(workspace, '.openai/share-note.json'), 'utf8'))
    expect(manifest.operations.at(-1).imageUploads[0].status).toBe('unknown')
  })

  it('rejects foreign asset URLs without fetching them or changing the note', async () => {
    server.setBehavior({ uploadReturnsDifferentOrigin: true })
    const creates = count('/v1/file/create-note')
    expect((await application.update(request(await preview()))).ok).toBe(false)
    expect(count('/v1/file/create-note')).toBe(creates)
    expect(server.requestLog.some((entry) => entry.path.startsWith('/files/'))).toBe(false)
  })

  it('keeps new public publishing unsupported', async () => {
    await expect(application.preview({ projectRoot: workspace, sourcePath: 'note.md', encryption: 'public', imageMode: 'upload' })).rejects.toMatchObject({ code: 'invalid_request' })
  })
})
