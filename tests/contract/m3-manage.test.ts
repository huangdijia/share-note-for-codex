import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ShareNoteApplication } from '../../src/app.js'
import { createAuthHeaders } from '../../src/protocol/auth.js'
import { PROTOCOL_PROFILE } from '../../src/protocol/profile.js'
import { MemorySecretStore } from '../../src/secrets/store.js'
import { ProjectStore } from '../../src/project.js'
import { MockShareNoteServer } from '../helpers/mock-share-note-server.js'

describe('M3 update, list, delete and local locking', () => {
  let server: MockShareNoteServer
  let dataDirectory: string
  let workspace: string
  let sourcePath: string
  let application: ShareNoteApplication
  let published: Awaited<ReturnType<ShareNoteApplication['publish']>>

  beforeEach(async () => {
    server = new MockShareNoteServer()
    await server.start()
    dataDirectory = await mkdtemp(path.join(tmpdir(), 'share-note-m3-data-'))
    workspace = await mkdtemp(path.join(tmpdir(), 'share-note-m3-workspace-'))
    sourcePath = path.join(workspace, 'managed.md')
    await writeFile(sourcePath, '# Managed note\n\nVersion one.')
    application = new ShareNoteApplication(
      dataDirectory,
      new MemorySecretStore(),
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
    const preview = await application.preview({ projectRoot: workspace, sourcePath: 'managed.md' })
    published = await application.publish({
      projectRoot: workspace,
      previewId: preview.previewId,
      expectedContentHash: preview.contentHash,
      authorization: {
        granted: true,
        action: 'publish',
        profile: 'mock',
        projectBindingHash: preview.projectBindingHash,
        contentHash: preview.contentHash,
        encryption: 'encrypted'
      },
      returnShareUrl: true
    })
    expect(published.status).toBe('verified')
    server.resetMetrics()
  })

  afterEach(async () => {
    await server.close()
    await rm(dataDirectory, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  })

  async function nextPreview(body = 'Version two. 🚀') {
    await writeFile(sourcePath, `# Managed note\n\n${body}`)
    return application.preview({ projectRoot: workspace, sourcePath: 'managed.md' })
  }

  function updateRequest(preview: Awaited<ReturnType<typeof nextPreview>>) {
    return {
      projectRoot: workspace,
      recordId: published.recordId,
      previewId: preview.previewId,
      expectedContentHash: preview.contentHash,
      authorization: {
        granted: true as const,
        action: 'update' as const,
        profile: 'mock',
        projectBindingHash: preview.projectBindingHash,
        recordId: published.recordId,
        contentHash: preview.contentHash,
        encryption: 'encrypted' as const
      },
      returnShareUrl: true
    }
  }

  function encryptedPayload(page: string): { ciphertext: string[]; ivs: string[] } {
    const value = page.match(/id="encrypted-data"[^>]*>([^<]+)</)?.[1]
    if (!value) throw new Error('missing encrypted payload')
    return JSON.parse(value) as { ciphertext: string[]; ivs: string[] }
  }

  async function deleteDirectly(): Promise<void> {
    const record = await (await ProjectStore.open(workspace, dataDirectory)).getRecord(published.recordId)
    await fetch(server.apiBaseUrl + PROTOCOL_PROFILE.routes.delete, {
      method: 'POST',
      headers: {
        ...createAuthHeaders({ uid: server.uid, apiKey: server.apiKey }),
        'content-type': 'application/json'
      },
      body: JSON.stringify({ filename: record.remoteFilename, filetype: 'html' })
    })
  }

  it('updates in place, preserves URL and key, and rotates every IV', async () => {
    const baseUrl = published.shareUrl!.split('#')[0]!
    const before = encryptedPayload(await (await fetch(baseUrl)).text())
    const preview = await nextPreview()
    const result = await application.update(updateRequest(preview))
    expect(result).toMatchObject({
      ok: true,
      status: 'verified',
      verification: { fetched: true, decrypted: true, contentMatched: true }
    })
    expect(result.shareUrl).toBe(published.shareUrl)
    const after = encryptedPayload(await (await fetch(baseUrl)).text())
    expect(after.ivs).not.toEqual(before.ivs)
    expect(after.ciphertext).not.toEqual(before.ciphertext)
    expect(await readFile(sourcePath, 'utf8')).toContain('Version two')
  })

  it('does not submit an update when the original remote target is absent', async () => {
    await deleteDirectly()
    const preview = await nextPreview()
    const createsBefore = server.requestLog.filter((entry) => entry.path === '/v1/file/create-note').length
    await expect(application.update(updateRequest(preview))).rejects.toMatchObject({ code: 'not_found' })
    expect(server.requestLog.filter((entry) => entry.path === '/v1/file/create-note')).toHaveLength(createsBefore)
  })

  it('does not claim success if update returns a different URL', async () => {
    server.setBehavior({ createReturnsDifferentUrl: true })
    const preview = await nextPreview()
    const result = await application.update(updateRequest(preview))
    expect(result).toMatchObject({ ok: false, status: 'failed' })
    expect(result.warnings.join(' ')).toContain('different URL')
  })

  it('lists only local records and exposes pending crash-recovery state', async () => {
    const now = new Date().toISOString()
    await (await ProjectStore.open(workspace, dataDirectory)).writeOperation({
      schemaVersion: 1,
      operationId: 'op-00000000-0000-4000-8000-000000000000',
      action: 'update',
      recordId: published.recordId,
      profile: 'mock',
      target: 'local-recovery-marker',
      status: 'pending',
      createdAt: now,
      updatedAt: now
    })
    const result = await application.list({ projectRoot: workspace })
    expect(result).toMatchObject({ scope: 'project', pendingOperations: 1 })
    expect(result.records).toHaveLength(1)
    expect(result.records[0]).not.toHaveProperty('noteKeyRef')
    expect(result.warnings.join(' ')).toContain('not a complete remote account inventory')
  })

  it('reads a managed encrypted note by local record ID', async () => {
    const result = await application.read({ projectRoot: workspace, recordId: published.recordId })
    expect(result).toMatchObject({ status: 'verified', title: 'Managed note', encrypted: true })
    expect(result.content).toContain('Version one')
  })

  it('isolates records and keys between projects that share one profile', async () => {
    const otherProject = await mkdtemp(path.join(tmpdir(), 'share-note-m3-other-project-'))
    try {
      await application.configureProject({ projectRoot: otherProject, profile: 'mock' })
      await expect(application.list({ projectRoot: otherProject }))
        .resolves.toMatchObject({ scope: 'project', records: [] })
      await expect(application.read({ projectRoot: otherProject, recordId: published.recordId }))
        .rejects.toMatchObject({ code: 'not_found' })
      await expect(application.delete({
        projectRoot: otherProject,
        recordId: published.recordId,
        authorization: { granted: true, action: 'delete', recordId: published.recordId }
      })).rejects.toMatchObject({ code: 'not_found' })
    } finally {
      await rm(otherProject, { recursive: true, force: true })
    }
  })

  it('does not report deletion when success=true but the page remains', async () => {
    server.setBehavior({ deleteKeepsPage: true })
    const result = await application.delete({
      projectRoot: workspace,
      recordId: published.recordId,
      authorization: { granted: true, action: 'delete', recordId: published.recordId },
      verificationAttempts: 2,
      verificationDelayMilliseconds: 0
    })
    expect(result).toMatchObject({
      ok: false,
      status: 'submitted_unverified',
      requestStatus: 'submitted',
      verificationStatus: 'still_present',
      sourceFilePreserved: true
    })
    await expect(readFile(sourcePath, 'utf8')).resolves.toContain('Version one')
  })

  it('returns already_absent without sending another delete', async () => {
    await deleteDirectly()
    const deletesBefore = server.requestLog.filter((entry) => entry.path === '/v1/file/delete').length
    const result = await application.delete({
      projectRoot: workspace,
      recordId: published.recordId,
      authorization: { granted: true, action: 'delete', recordId: published.recordId }
    })
    expect(result).toMatchObject({ status: 'already_absent', requestStatus: 'not_sent' })
    expect(server.requestLog.filter((entry) => entry.path === '/v1/file/delete')).toHaveLength(deletesBefore)
  })

  it('handles bounded cache lag and verifies absence on a later read', async () => {
    server.setBehavior({ deleteCacheReads: 2 })
    const result = await application.delete({
      projectRoot: workspace,
      recordId: published.recordId,
      authorization: { granted: true, action: 'delete', recordId: published.recordId },
      verificationAttempts: 3,
      verificationDelayMilliseconds: 0
    })
    expect(result).toMatchObject({ ok: true, status: 'verified', verificationStatus: 'verified_absent' })
  })

  it('serializes concurrent updates for the same record and keeps state valid', async () => {
    server.setBehavior({ createDelayMilliseconds: 50 })
    const preview = await nextPreview('Concurrent content.')
    const [first, second] = await Promise.all([
      application.update(updateRequest(preview)),
      application.update(updateRequest(preview))
    ])
    expect(first.status).toBe('verified')
    expect(second.status).toBe('verified')
    expect(server.maximumConcurrentCreateRequests).toBe(1)
    const records = JSON.parse(await readFile(path.join(workspace, '.openai', 'share-note.json'), 'utf8')) as { records: unknown[] }
    expect(records.records).toHaveLength(1)
  })
})
