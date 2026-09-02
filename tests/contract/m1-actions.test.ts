import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ShareNoteApplication } from '../../src/app.js'
import { encryptModern } from '../../src/crypto/codecs.js'
import { createAuthHeaders } from '../../src/protocol/auth.js'
import { PROTOCOL_PROFILE, type NoteTemplate } from '../../src/protocol/profile.js'
import { MemorySecretStore } from '../../src/secrets/store.js'
import { MockShareNoteServer } from '../helpers/mock-share-note-server.js'

describe('M1 setup, doctor, preview and read', () => {
  let server: MockShareNoteServer
  let dataDirectory: string
  let workspace: string
  let environment: NodeJS.ProcessEnv
  let application: ShareNoteApplication

  beforeEach(async () => {
    server = new MockShareNoteServer()
    await server.start()
    dataDirectory = await mkdtemp(path.join(tmpdir(), 'share-note-data-'))
    workspace = await mkdtemp(path.join(tmpdir(), 'share-note-workspace-'))
    environment = {
      MOCK_SHARE_NOTE_CREDENTIAL: JSON.stringify({ uid: server.uid, apiKey: server.apiKey })
    }
    application = new ShareNoteApplication(
      dataDirectory,
      new MemorySecretStore(),
      fetch,
      environment
    )
  })

  afterEach(async () => {
    await server.close()
    await rm(dataDirectory, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  })

  async function setup(): Promise<void> {
    await application.setup({
      profile: 'mock',
      apiBaseUrl: server.apiBaseUrl,
      webBaseUrl: server.webBaseUrl,
      allowedSourceRoots: [workspace],
      allowInsecureLoopback: true,
      credentialEnvVar: 'MOCK_SHARE_NOTE_CREDENTIAL'
    })
    await application.configureProject({ projectRoot: workspace, profile: 'mock' })
  }

  async function createRemote(template: NoteTemplate): Promise<string> {
    const response = await fetch(server.apiBaseUrl + PROTOCOL_PROFILE.routes.create, {
      method: 'POST',
      headers: {
        ...createAuthHeaders({ uid: server.uid, apiKey: server.apiKey }),
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        filetype: 'html',
        hash: createHash('sha1').update(template.content).digest('hex'),
        template
      })
    })
    return ((await response.json()) as { url: string }).url
  }

  it('imports a process-scoped credential and doctor performs no note write', async () => {
    const configured = await application.setup({
      profile: 'mock',
      apiBaseUrl: server.apiBaseUrl,
      webBaseUrl: server.webBaseUrl,
      allowedSourceRoots: [workspace],
      allowInsecureLoopback: true,
      credentialEnvVar: 'MOCK_SHARE_NOTE_CREDENTIAL'
    })
    expect(configured).not.toHaveProperty('credential')
    expect(environment.MOCK_SHARE_NOTE_CREDENTIAL).toBeUndefined()
    const doctor = await application.doctor({ profile: 'mock' })
    expect(doctor).toMatchObject({ ok: true, status: 'healthy', authentication: 'accepted' })
    expect(server.requestLog.map((entry) => entry.path)).toEqual(['/v1/file/check-files'])
  })

  it('fails safely when the setup credential is missing', async () => {
    delete environment.MOCK_SHARE_NOTE_CREDENTIAL
    await expect(application.setup({
      profile: 'mock',
      apiBaseUrl: server.apiBaseUrl,
      webBaseUrl: server.webBaseUrl,
      allowedSourceRoots: [workspace],
      allowInsecureLoopback: true,
      credentialEnvVar: 'MOCK_SHARE_NOTE_CREDENTIAL'
    })).rejects.toMatchObject({ code: 'credential_missing' })
    expect(server.requestLog).toHaveLength(0)
  })

  it('previews Chinese, emoji, table and code without network access', async () => {
    await setup()
    const sourcePath = path.join(workspace, 'report.md')
    await writeFile(sourcePath, '# 报告 🚀\n\n|列|值|\n|-|-|\n|中文|ok|\n\n```ts\nconst x = 1\n```\n')
    const before = server.requestLog.length
    const result = await application.preview({
      sourcePath: 'report.md',
      projectRoot: workspace
    })
    expect(result).toMatchObject({
      status: 'previewed',
      publishable: true,
      title: '报告 🚀',
      profile: 'mock',
      sourcePath: 'report.md'
    })
    expect(result.projectBindingHash).toMatch(/^[a-f0-9]{64}$/)
    const preview = await readFile(result.previewPath, 'utf8')
    expect(preview).toContain('<table>')
    expect(preview).toContain('const x = 1')
    expect(server.requestLog).toHaveLength(before)
  })

  it('escapes Markdown inline HTML and blocks embedded resources', async () => {
    await setup()
    const sourcePath = path.join(workspace, 'unsafe.md')
    await writeFile(sourcePath, '# Safe\n\n<script>steal()</script>\n\n![secret](private.png)')
    const result = await application.preview({
      sourcePath: 'unsafe.md',
      projectRoot: workspace
    })
    expect(result).toMatchObject({ status: 'blocked', publishable: false })
    expect(result.resources).toContain('private.png')
    const preview = await readFile(result.previewPath, 'utf8')
    expect(preview).not.toContain('<script>')
    expect(preview).toContain('&lt;script&gt;')
  })

  it('blocks a symlink whose real target leaves the allowed root', async () => {
    await setup()
    const outside = await mkdtemp(path.join(tmpdir(), 'share-note-outside-'))
    try {
      const target = path.join(outside, 'secret.md')
      const link = path.join(workspace, 'escape.md')
      await writeFile(target, '# secret')
      await symlink(target, link)
      await expect(application.preview({
        sourcePath: 'escape.md',
        projectRoot: workspace
      })).rejects.toMatchObject({ code: 'source_blocked' })
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('reads and sanitizes a modern encrypted page without sending API credentials', async () => {
    await setup()
    const plaintext = JSON.stringify({
      basename: 'Remote 🚀',
      content: '<h1>Remote 🚀</h1><p>Hello 世界</p><script>sendSecret()</script>'
    })
    const encrypted = await encryptModern(plaintext)
    const url = await createRemote({
      width: '',
      elements: [],
      encrypted: true,
      content: JSON.stringify(encrypted.payload),
      mathJax: false
    })
    const result = await application.read({ projectRoot: workspace, url: `${url}#${encrypted.key}` })
    expect(result).toMatchObject({ status: 'verified', encrypted: true, title: 'Remote 🚀' })
    expect(result.content).toContain('Hello 世界')
    expect(result.content).not.toContain('sendSecret')
    expect(server.requestLog.at(-1)).toMatchObject({ method: 'GET', credentialed: false })
  })

  it('reports a wrong key and unknown codec instead of returning an empty note', async () => {
    await setup()
    const encrypted = await encryptModern(JSON.stringify({ basename: 'x', content: '<p>x</p>' }))
    const encryptedUrl = await createRemote({
      width: '', elements: [], encrypted: true, content: JSON.stringify(encrypted.payload), mathJax: false
    })
    await expect(application.read({ projectRoot: workspace, url: `${encryptedUrl}#bad-key` }))
      .rejects.toMatchObject({ code: 'credential_missing' })

    const unknownUrl = await createRemote({
      width: '', elements: [], encrypted: true, content: JSON.stringify({ data: 'future' }), mathJax: false
    })
    await expect(application.read({ projectRoot: workspace, url: `${unknownUrl}#anything` }))
      .rejects.toMatchObject({ code: 'protocol_error' })
  })

  it('keeps user data outside the workspace and installation tree', async () => {
    await setup()
    await mkdir(path.join(workspace, 'docs'))
    const sourcePath = path.join(workspace, 'docs', 'note.md')
    await writeFile(sourcePath, '# Note')
    const result = await application.preview({ projectRoot: workspace, sourcePath: 'docs/note.md' })
    expect(result.previewPath.startsWith(dataDirectory + path.sep)).toBe(true)
  })
})
