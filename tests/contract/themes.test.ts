import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ShareNoteApplication } from '../../src/app.js'
import { decryptSupported, encryptModern, type SupportedCiphertext } from '../../src/crypto/codecs.js'
import { loadPreview } from '../../src/preview.js'
import { ProjectStore } from '../../src/project.js'
import { createAuthHeaders } from '../../src/protocol/auth.js'
import { PROTOCOL_PROFILE, type NoteTemplate } from '../../src/protocol/profile.js'
import { decodeSharePage } from '../../src/read/page.js'
import { renderDocument } from '../../src/render/renderer.js'
import { THEME_IDS, THEMES } from '../../src/render/themes.js'
import { MemorySecretStore } from '../../src/secrets/store.js'
import { MockShareNoteServer } from '../helpers/mock-share-note-server.js'

const THEME_FIXTURE = `# 中英文 Theme

Paragraph with a [link](https://example.com) and \`inline code\`.

- first
- 第二项

> quoted text

| name | value |
| --- | --- |
| long | ${'table-value-'.repeat(20)} |

\`\`\`text
${'long-code-'.repeat(40)}
\`\`\`
`

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

describe('built-in article themes', () => {
  let server: MockShareNoteServer
  let dataDirectory: string
  let project: string
  let application: ShareNoteApplication
  let afterCreateResponse: (() => Promise<void>) | undefined

  beforeEach(async () => {
    server = new MockShareNoteServer()
    await server.start()
    dataDirectory = await mkdtemp(path.join(tmpdir(), 'share-note-theme-data-'))
    project = await mkdtemp(path.join(tmpdir(), 'share-note-theme-project-'))
    await writeFile(path.join(project, 'theme.md'), THEME_FIXTURE)
    const interceptedFetch = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1]
    ) => {
      const response = await fetch(input, init)
      const requestUrl = new URL(input instanceof Request ? input.url : input.toString())
      if (requestUrl.pathname === PROTOCOL_PROFILE.routes.create && afterCreateResponse) {
        const callback = afterCreateResponse
        afterCreateResponse = undefined
        await callback()
      }
      return response
    }) as typeof fetch
    application = new ShareNoteApplication(dataDirectory, new MemorySecretStore(), interceptedFetch, {
      MOCK_CREDENTIAL: JSON.stringify({ uid: server.uid, apiKey: server.apiKey })
    })
    await application.setup({
      profile: 'mock',
      apiBaseUrl: server.apiBaseUrl,
      webBaseUrl: server.webBaseUrl,
      allowedSourceRoots: [project],
      allowInsecureLoopback: true,
      credentialEnvVar: 'MOCK_CREDENTIAL'
    })
    await application.configureProject({ projectRoot: project, profile: 'mock' })
  })

  afterEach(async () => {
    await server.close()
    await rm(dataDirectory, { recursive: true, force: true })
    await rm(project, { recursive: true, force: true })
  })

  async function publish(theme?: typeof THEME_IDS[number]) {
    const preview = await application.preview({ projectRoot: project, sourcePath: 'theme.md', ...(theme ? { theme } : {}) })
    const result = await application.publish({
      projectRoot: project,
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
    return { preview, result }
  }

  function updateRequest(
    preview: Awaited<ReturnType<ShareNoteApplication['preview']>>,
    recordId: string
  ) {
    return {
      projectRoot: project,
      recordId,
      previewId: preview.previewId,
      expectedContentHash: preview.contentHash,
      authorization: {
        granted: true as const,
        action: 'update' as const,
        profile: 'mock',
        projectBindingHash: preview.projectBindingHash,
        recordId,
        contentHash: preview.contentHash,
        encryption: 'encrypted' as const
      }
    }
  }

  async function writeRemote(filename: string, content: string, title: string, key?: string): Promise<string> {
    const encrypted = await encryptModern(JSON.stringify({ content, basename: title }), key)
    const template: NoteTemplate = {
      filename,
      width: '',
      elements: [],
      encrypted: true,
      content: JSON.stringify(encrypted.payload),
      mathJax: false
    }
    const response = await fetch(server.apiBaseUrl + PROTOCOL_PROFILE.routes.create, {
      method: 'POST',
      headers: {
        ...createAuthHeaders({ uid: server.uid, apiKey: server.apiKey }),
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        filename,
        filetype: 'html',
        hash: createHash('sha1').update(template.content).digest('hex'),
        template
      })
    })
    expect(response.status).toBe(200)
    return encrypted.key
  }

  it('lists the four built-in themes and identifies the system default', () => {
    expect(application.themes()).toEqual({
      ok: true,
      action: 'themes',
      status: 'verified',
      defaultTheme: 'simple',
      themes: THEMES,
      warnings: []
    })
    expect(THEMES.map((theme) => theme.id)).toEqual(THEME_IDS)
  })

  it('renders scoped, self-contained fragments and hashes the selected CSS with the body', () => {
    const outputs = THEME_IDS.map((theme) => renderDocument(THEME_FIXTURE, 'markdown', 'fixture', theme))
    expect(new Set(outputs.map((output) => output.contentHash)).size).toBe(4)
    for (const [index, output] of outputs.entries()) {
      const theme = THEME_IDS[index]
      expect(output.bodyHtml).toContain(`<article class="share-note-article" data-share-note-theme="${theme}">`)
      expect(output.bodyHtml).toContain('<style>')
      expect(output.bodyHtml).toContain('.share-note-article pre')
      expect(output.bodyHtml).toContain('overflow-x: auto')
      expect(output.bodyHtml).not.toMatch(/@import|url\s*\(|<script|<link/i)
      expect(sha256(output.bodyHtml)).toBe(output.contentHash)
      expect(output.documentHtml).toContain(output.bodyHtml)
    }
  })

  it('uses a project default, allows one preview override, and rejects unknown themes', async () => {
    const configured = await application.configureProject({ projectRoot: project, defaultTheme: 'technical' })
    expect(configured).toMatchObject({ profile: 'mock', defaultTheme: 'technical' })
    await expect(application.preview({ projectRoot: project, sourcePath: 'theme.md' }))
      .resolves.toMatchObject({ theme: 'technical', themeName: '技术' })
    await expect(application.preview({ projectRoot: project, sourcePath: 'theme.md', theme: 'reading' }))
      .resolves.toMatchObject({ theme: 'reading', themeName: '阅读' })
    await expect(application.preview({ projectRoot: project, sourcePath: 'theme.md', theme: 'unknown' as never }))
      .rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('changes only the default theme while preserving the project binding and audit state', async () => {
    const { result } = await publish('simple')
    const before = await (await ProjectStore.open(project, dataDirectory)).load()
    await application.configureProject({ projectRoot: project, defaultTheme: 'reading' })
    const after = await (await ProjectStore.open(project, dataDirectory)).load()
    expect(after.profile).toBe(before.profile)
    expect(after.records).toEqual(before.records)
    expect(after.operations).toEqual(before.operations)
    expect(after.defaultTheme).toBe('reading')
    expect(after.records[0]?.recordId).toBe(result.recordId)
  })

  it('encrypts the complete themed fragment and removes trusted CSS from read output', async () => {
    const { preview, result } = await publish('dark')
    expect(result).toMatchObject({ status: 'verified', theme: 'dark' })
    const [baseUrl, key] = result.shareUrl!.split('#') as [string, string]
    const pageHtml = await (await fetch(baseUrl)).text()
    expect(pageHtml).not.toContain('share-note-theme')
    const decoded = await decodeSharePage(pageHtml, key!)
    expect(decoded.rawHtml).toContain('data-share-note-theme="dark"')
    expect(decoded.rawHtml).toContain('<style>')
    expect(sha256(decoded.rawHtml)).toBe(preview.contentHash)
    expect(decoded.html).not.toContain('<style>')
    expect(decoded.html).not.toContain('.share-note-article')
    expect(decoded.markdown).not.toContain('share-note-article')
    expect(decoded.markdown).toContain('中英文 Theme')
  })

  it('binds update previews to the record and preserves or explicitly changes its theme', async () => {
    const { result } = await publish('reading')
    await application.configureProject({ projectRoot: project, defaultTheme: 'technical' })
    await writeFile(path.join(project, 'theme.md'), '# Updated\n\nversion two')
    const unbound = await application.preview({ projectRoot: project, sourcePath: 'theme.md' })
    await expect(application.update(updateRequest(unbound, result.recordId)))
      .rejects.toMatchObject({ code: 'content_blocked' })
    await writeFile(path.join(project, 'other.md'), '# Other source')
    await expect(application.preview({
      projectRoot: project,
      sourcePath: 'other.md',
      recordId: result.recordId
    })).rejects.toMatchObject({ code: 'content_blocked' })
    const preserved = await application.preview({
      projectRoot: project,
      sourcePath: 'theme.md',
      recordId: result.recordId
    })
    expect(preserved).toMatchObject({ recordId: result.recordId, theme: 'reading' })
    await expect(application.update(updateRequest(preserved, result.recordId)))
      .resolves.toMatchObject({ status: 'verified', theme: 'reading' })

    await writeFile(path.join(project, 'theme.md'), '# Updated again\n\nversion three')
    const changed = await application.preview({
      projectRoot: project,
      sourcePath: 'theme.md',
      recordId: result.recordId,
      theme: 'technical'
    })
    await expect(application.update(updateRequest(changed, result.recordId)))
      .resolves.toMatchObject({ status: 'verified', theme: 'technical' })
    await expect((await ProjectStore.open(project, dataDirectory)).getRecord(result.recordId))
      .resolves.toMatchObject({ theme: 'technical' })
  })

  it('rejects locally tampered preview body before publish writes a key, operation, or remote note', async () => {
    const preview = await application.preview({ projectRoot: project, sourcePath: 'theme.md', theme: 'simple' })
    const metadataPath = path.join(dataDirectory, 'previews', `${preview.previewId}.json`)
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as { bodyHtml: string }
    metadata.bodyHtml = metadata.bodyHtml.replace('中英文 Theme', 'Tampered local body')
    await writeFile(metadataPath, JSON.stringify(metadata))
    await expect(application.publish({
      projectRoot: project,
      previewId: preview.previewId,
      expectedContentHash: preview.contentHash,
      authorization: {
        granted: true,
        action: 'publish',
        profile: 'mock',
        projectBindingHash: preview.projectBindingHash,
        contentHash: preview.contentHash,
        encryption: 'encrypted'
      }
    })).rejects.toThrow('Invalid preview metadata')
    expect(server.requestLog.filter((entry) => entry.path === PROTOCOL_PROFILE.routes.create)).toHaveLength(0)
    const manifest = await (await ProjectStore.open(project, dataDirectory)).load()
    expect(manifest.records).toEqual([])
    expect(manifest.operations).toEqual([])
  })

  it('rejects preview metadata whose theme label does not match its hashed fragment', async () => {
    const preview = await application.preview({ projectRoot: project, sourcePath: 'theme.md', theme: 'simple' })
    const metadataPath = path.join(dataDirectory, 'previews', `${preview.previewId}.json`)
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as { theme: string; themeName: string }
    metadata.theme = 'dark'
    metadata.themeName = '深色'
    await writeFile(metadataPath, JSON.stringify(metadata))
    await expect(application.publish({
      projectRoot: project,
      previewId: preview.previewId,
      expectedContentHash: preview.contentHash,
      authorization: {
        granted: true,
        action: 'publish',
        profile: 'mock',
        projectBindingHash: preview.projectBindingHash,
        contentHash: preview.contentHash,
        encryption: 'encrypted'
      }
    })).rejects.toThrow('Invalid preview metadata')
    expect(server.requestLog.filter((entry) => entry.path === PROTOCOL_PROFILE.routes.create)).toHaveLength(0)
  })

  it('rejects locally tampered preview CSS before update creates an operation or remote request', async () => {
    const { result } = await publish('simple')
    await writeFile(path.join(project, 'theme.md'), '# Update\n\nnext')
    const preview = await application.preview({ projectRoot: project, sourcePath: 'theme.md', recordId: result.recordId })
    const metadataPath = path.join(dataDirectory, 'previews', `${preview.previewId}.json`)
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as { bodyHtml: string }
    metadata.bodyHtml = metadata.bodyHtml.replace('color: #202124', 'color: #ff00ff')
    await writeFile(metadataPath, JSON.stringify(metadata))
    const store = await ProjectStore.open(project, dataDirectory)
    const operationsBefore = await store.listOperations()
    const createsBefore = server.requestLog.filter((entry) => entry.path === PROTOCOL_PROFILE.routes.create).length
    await expect(application.update(updateRequest(preview, result.recordId)))
      .rejects.toThrow('Invalid preview metadata')
    expect(server.requestLog.filter((entry) => entry.path === PROTOCOL_PROFILE.routes.create)).toHaveLength(createsBefore)
    expect(await store.listOperations()).toEqual(operationsBefore)
  })

  it('rejects an update if the record source binding changes after its preview', async () => {
    const { result } = await publish('simple')
    await writeFile(path.join(project, 'theme.md'), '# Update\n\nnext')
    await writeFile(path.join(project, 'other.md'), '# Other')
    const preview = await application.preview({ projectRoot: project, sourcePath: 'theme.md', recordId: result.recordId })
    const store = await ProjectStore.open(project, dataDirectory)
    const record = await store.getRecord(result.recordId)
    record.sourcePath = 'other.md'
    await store.saveRecord(record)
    const createsBefore = server.requestLog.filter((entry) => entry.path === PROTOCOL_PROFILE.routes.create).length
    await expect(application.update(updateRequest(preview, result.recordId)))
      .rejects.toMatchObject({ code: 'content_blocked' })
    expect(server.requestLog.filter((entry) => entry.path === PROTOCOL_PROFILE.routes.create)).toHaveLength(createsBefore)
  })

  it('does not verify an update whose complete fragment is altered before read-back', async () => {
    const { result } = await publish('simple')
    const [, key] = result.shareUrl!.split('#') as [string, string]
    const store = await ProjectStore.open(project, dataDirectory)
    const record = await store.getRecord(result.recordId)
    const previousContentHash = record.contentHash
    const previousTheme = record.theme
    await writeFile(path.join(project, 'theme.md'), '# Read back\n\nnext')
    const preview = await application.preview({ projectRoot: project, sourcePath: 'theme.md', recordId: result.recordId })
    afterCreateResponse = async () => {
      const pageHtml = await (await fetch(record.shareUrl)).text()
      const decoded = await decodeSharePage(pageHtml, key)
      const tampered = decoded.rawHtml.replace('color: #202124', 'color: #ff00ff')
      await writeRemote(record.remoteFilename, tampered, preview.title, key)
    }
    const updated = await application.update(updateRequest(preview, result.recordId))
    expect(updated).toMatchObject({
      ok: false,
      status: 'submitted_unverified',
      verification: { fetched: true, decrypted: true, contentMatched: false }
    })
    await expect(store.getRecord(result.recordId)).resolves.toMatchObject({
      contentHash: previousContentHash,
      theme: previousTheme
    })
  })

  it('preserves legacy unthemed records unless an update explicitly selects a theme', async () => {
    const filename = 'legacytheme1'
    const legacyHtml = '<h1>Legacy</h1>\n<p>Version one.</p>\n'
    const key = await writeRemote(filename, legacyHtml, 'Legacy')
    const store = await ProjectStore.open(project, dataDirectory)
    const recordId = 'note-00000000-0000-4000-8000-000000000099'
    const noteKeyRef = await store.storeNoteKey(recordId, key)
    const now = new Date().toISOString()
    await store.saveRecord({
      schemaVersion: 1,
      recordId,
      profile: 'mock',
      apiOrigin: new URL(server.apiBaseUrl).origin,
      webOrigin: new URL(server.webBaseUrl).origin,
      identityRef: 'plaintext-file:credentials:mock',
      sourcePath: 'theme.md',
      remoteFilename: filename,
      shareUrl: `${server.webBaseUrl}/${filename}`,
      noteKeyRef,
      sourceHash: '0'.repeat(64),
      contentHash: sha256(legacyHtml),
      title: 'Legacy',
      encrypted: true,
      status: 'verified',
      createdAt: now,
      updatedAt: now
    })
    await writeFile(path.join(project, 'theme.md'), '# Legacy\n\nVersion two.')
    const legacyPreview = await application.preview({ projectRoot: project, sourcePath: 'theme.md', recordId })
    expect(legacyPreview).toMatchObject({ theme: null, themeName: '旧版（无主题）' })
    const metadata = await loadPreview(dataDirectory, legacyPreview.previewId)
    expect(metadata.bodyHtml).not.toContain('share-note-article')
    await expect(application.update(updateRequest(legacyPreview, recordId)))
      .resolves.toMatchObject({ status: 'verified', theme: null })
    expect(await store.getRecord(recordId)).not.toHaveProperty('theme')

    await writeFile(path.join(project, 'theme.md'), '# Legacy\n\nVersion three.')
    const migrated = await application.preview({ projectRoot: project, sourcePath: 'theme.md', recordId, theme: 'simple' })
    await expect(application.update(updateRequest(migrated, recordId)))
      .resolves.toMatchObject({ status: 'verified', theme: 'simple' })
    await expect(store.getRecord(recordId)).resolves.toMatchObject({ theme: 'simple' })
  })

  it.each(['body', 'css'] as const)('detects remote %s tampering before an update', async (part) => {
    const { result } = await publish('simple')
    const [baseUrl, key] = result.shareUrl!.split('#') as [string, string]
    const originalPage = await (await fetch(baseUrl)).text()
    const encodedPayload = originalPage.match(/id="encrypted-data"[^>]*>([^<]+)</)?.[1]
    expect(encodedPayload).toBeTruthy()
    const plaintext = await decryptSupported(JSON.parse(encodedPayload!) as SupportedCiphertext, key!)
    const data = JSON.parse(plaintext) as { content: string; basename: string }
    const tampered = part === 'body'
      ? data.content.replace('中英文 Theme', 'Tampered body')
      : data.content.replace('color: #202124', 'color: #ff00ff')
    const record = await (await ProjectStore.open(project, dataDirectory)).getRecord(result.recordId)
    await writeRemote(record.remoteFilename, tampered, data.basename, key)
    await writeFile(path.join(project, 'theme.md'), '# Next\n\nnew content')
    const preview = await application.preview({ projectRoot: project, sourcePath: 'theme.md', recordId: result.recordId })
    const createsBefore = server.requestLog.filter((entry) => entry.path === PROTOCOL_PROFILE.routes.create).length
    await expect(application.update(updateRequest(preview, result.recordId)))
      .rejects.toMatchObject({ code: 'conflict' })
    expect(server.requestLog.filter((entry) => entry.path === PROTOCOL_PROFILE.routes.create)).toHaveLength(createsBefore)
  })

  it('rejects old preview metadata so theme selection must be regenerated', async () => {
    const preview = await application.preview({ projectRoot: project, sourcePath: 'theme.md' })
    const metadataPath = path.join(dataDirectory, 'previews', `${preview.previewId}.json`)
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as { schemaVersion: number }
    metadata.schemaVersion = 2
    await writeFile(metadataPath, JSON.stringify(metadata))
    await expect(loadPreview(dataDirectory, preview.previewId)).rejects.toThrow('Invalid preview metadata')
  })
})
