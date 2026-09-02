import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ShareNoteApplication } from '../../src/app.js'
import { ProjectStore, projectNoteKeyReference } from '../../src/project.js'
import { MemorySecretStore } from '../../src/secrets/store.js'
import { StateStore, type OperationRecord, type ShareRecord } from '../../src/state/store.js'

describe('project-scoped Share Note configuration', () => {
  let dataDirectory: string
  let project: string
  let secrets: MemorySecretStore
  let application: ShareNoteApplication

  beforeEach(async () => {
    dataDirectory = await mkdtemp(path.join(tmpdir(), 'share-note-project-data-'))
    project = await mkdtemp(path.join(tmpdir(), 'share-note-project-'))
    secrets = new MemorySecretStore()
    application = new ShareNoteApplication(dataDirectory, secrets, fetch, {
      FIRST_CREDENTIAL: JSON.stringify({ uid: 'first-user', apiKey: 'first-secret' }),
      SECOND_CREDENTIAL: JSON.stringify({ uid: 'second-user', apiKey: 'second-secret' })
    })
    await application.setup({
      profile: 'first',
      apiBaseUrl: 'https://api.first.example',
      webBaseUrl: 'https://share.first.example',
      allowedSourceRoots: [project],
      credentialEnvVar: 'FIRST_CREDENTIAL'
    })
    await application.setup({
      profile: 'second',
      apiBaseUrl: 'https://api.second.example',
      webBaseUrl: 'https://share.second.example',
      allowedSourceRoots: [project],
      credentialEnvVar: 'SECOND_CREDENTIAL'
    })
  })

  afterEach(async () => {
    await rm(dataDirectory, { recursive: true, force: true })
    await rm(project, { recursive: true, force: true })
  })

  it('creates an idempotent tracked manifest and ignored private key file boundary', async () => {
    const first = await application.configureProject({ projectRoot: project, profile: 'first' })
    const second = await application.configureProject({ projectRoot: project, profile: 'first' })
    expect(first).toMatchObject({ status: 'configured', profile: 'first', importedRecords: 0 })
    expect(second).toMatchObject({ status: 'configured', profile: 'first' })

    const manifestPath = path.join(project, '.openai', 'share-note.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    expect(manifest).toEqual({ schemaVersion: 1, profile: 'first', records: [], operations: [] })
    expect(await readFile(path.join(project, '.openai', '.gitignore'), 'utf8')).toBe('share-note.keys.json\n')
    expect((await stat(manifestPath)).isFile()).toBe(true)
  })

  it('allows changing an empty binding but blocks it after project state exists', async () => {
    await application.configureProject({ projectRoot: project, profile: 'first' })
    await application.configureProject({ projectRoot: project, profile: 'second' })
    const store = await ProjectStore.open(project, dataDirectory)
    const now = new Date().toISOString()
    await store.writeOperation({
      schemaVersion: 1,
      operationId: 'op-00000000-0000-4000-8000-000000000001',
      action: 'publish',
      recordId: 'note-00000000-0000-4000-8000-000000000001',
      profile: 'second',
      target: 'https://share.second.example',
      status: 'pending',
      createdAt: now,
      updatedAt: now
    })
    await expect(application.configureProject({ projectRoot: project, profile: 'first' }))
      .rejects.toMatchObject({ code: 'conflict' })
  })

  it('requires the exact project root and rejects legacy request overrides', async () => {
    await application.configureProject({ projectRoot: project, profile: 'first' })
    const child = path.join(project, 'child')
    await mkdir(child)
    await writeFile(path.join(child, 'note.md'), '# note')
    await expect(application.preview({ projectRoot: child, sourcePath: 'note.md' }))
      .rejects.toMatchObject({ code: 'configuration_missing' })
    await expect(application.preview({
      projectRoot: project,
      sourcePath: 'child/note.md',
      profile: 'first'
    } as never)).rejects.toMatchObject({ code: 'invalid_request' })
    await expect(application.preview({
      projectRoot: project,
      sourcePath: 'child/note.md',
      workspaceRoot: project
    } as never)).rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('enforces both project containment and the global allowed source roots', async () => {
    const restrictedData = await mkdtemp(path.join(tmpdir(), 'share-note-restricted-data-'))
    const restrictedSecrets = new MemorySecretStore()
    const docs = path.join(project, 'docs')
    await mkdir(docs)
    await writeFile(path.join(docs, 'ok.md'), '# ok')
    await writeFile(path.join(project, 'blocked.md'), '# blocked')
    const restricted = new ShareNoteApplication(restrictedData, restrictedSecrets, fetch, {
      RESTRICTED_CREDENTIAL: JSON.stringify({ uid: 'restricted', apiKey: 'secret' })
    })
    try {
      await restricted.setup({
        profile: 'restricted',
        apiBaseUrl: 'https://api.restricted.example',
        webBaseUrl: 'https://share.restricted.example',
        allowedSourceRoots: [docs],
        credentialEnvVar: 'RESTRICTED_CREDENTIAL'
      })
      await restricted.configureProject({ projectRoot: project, profile: 'restricted' })
      await expect(restricted.preview({ projectRoot: project, sourcePath: 'docs/ok.md' }))
        .resolves.toMatchObject({ sourcePath: 'docs/ok.md', status: 'previewed' })
      await expect(restricted.preview({ projectRoot: project, sourcePath: 'blocked.md' }))
        .rejects.toMatchObject({ code: 'source_blocked' })
      await expect(restricted.preview({ projectRoot: project, sourcePath: '../outside.md' }))
        .rejects.toMatchObject({ code: 'source_blocked' })
      await expect(restricted.preview({ projectRoot: project, sourcePath: path.join(docs, 'ok.md') }))
        .rejects.toMatchObject({ code: 'invalid_request' })
    } finally {
      await rm(restrictedData, { recursive: true, force: true })
    }
  })

  it('rejects symbolic project configuration and key files', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'share-note-project-outside-'))
    try {
      await mkdir(path.join(project, '.openai'))
      const externalManifest = path.join(outside, 'manifest.json')
      await writeFile(externalManifest, JSON.stringify({ schemaVersion: 1, profile: 'first', records: [], operations: [] }))
      await symlink(externalManifest, path.join(project, '.openai', 'share-note.json'))
      await expect(application.list({ projectRoot: project })).rejects.toMatchObject({ code: 'configuration_missing' })

      await rm(path.join(project, '.openai'), { recursive: true, force: true })
      await application.configureProject({ projectRoot: project, profile: 'first' })
      const externalKeys = path.join(outside, 'keys.json')
      await writeFile(externalKeys, JSON.stringify({ schemaVersion: 1, keys: {} }))
      await symlink(externalKeys, path.join(project, '.openai', 'share-note.keys.json'))
      const store = await ProjectStore.open(project, dataDirectory)
      await expect(store.storeNoteKey('note-00000000-0000-4000-8000-000000000002', 'secret-key'))
        .rejects.toMatchObject({ code: 'configuration_missing' })
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('imports matching legacy records and keys without deleting legacy state', async () => {
    const recordId = 'note-00000000-0000-4000-8000-000000000003'
    const operationId = 'op-00000000-0000-4000-8000-000000000003'
    const sourcePath = path.join(project, 'legacy.md')
    await writeFile(sourcePath, '# legacy')
    const noteKeyRef = await secrets.storeNoteKey('first', recordId, 'legacy-fragment-key')
    const now = new Date().toISOString()
    const record: ShareRecord = {
      schemaVersion: 1,
      recordId,
      profile: 'first',
      apiOrigin: 'https://api.first.example',
      webOrigin: 'https://share.first.example',
      identityRef: 'plaintext-file:credentials:first',
      sourcePath,
      remoteFilename: 'legacy123',
      shareUrl: 'https://share.first.example/legacy123',
      noteKeyRef,
      sourceHash: 'a'.repeat(64),
      contentHash: 'b'.repeat(64),
      title: 'Legacy',
      encrypted: true,
      status: 'verified',
      createdAt: now,
      updatedAt: now
    }
    const operation: OperationRecord = {
      schemaVersion: 1,
      operationId,
      action: 'publish',
      recordId,
      profile: 'first',
      target: 'https://share.first.example',
      status: 'verified',
      noteKeyRef,
      createdAt: now,
      updatedAt: now
    }
    const legacy = new StateStore(dataDirectory)
    await legacy.saveRecord(record)
    await legacy.writeOperation(operation)

    const configured = await application.configureProject({
      projectRoot: project,
      profile: 'first',
      importLegacyRecords: true
    })
    expect(configured).toMatchObject({ importedRecords: 1, importedOperations: 1, migrationAvailable: 1 })
    const store = await ProjectStore.open(project, dataDirectory)
    expect(await store.getRecord(recordId)).toMatchObject({
      sourcePath: 'legacy.md',
      noteKeyRef: projectNoteKeyReference(recordId)
    })
    await expect(store.readNoteKey(projectNoteKeyReference(recordId))).resolves.toBe('legacy-fragment-key')
    await expect(legacy.getRecord(recordId)).resolves.toMatchObject({ sourcePath })
  })
})
