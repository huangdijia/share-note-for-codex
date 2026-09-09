import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const execute = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const pluginRoot = path.join(root, 'plugins', 'share-note')
const bundle = path.join(pluginRoot, 'skills', 'share-note', 'scripts', 'share-note.mjs')
const temporaryDirectories: string[] = []
const EXPECTED_THEMES = [
  { id: 'simple', name: '简洁', description: '白底、系统无衬线字体和蓝色链接。', systemDefault: true },
  { id: 'technical', name: '技术', description: '更宽正文，并强化代码块和表格。', systemDefault: false },
  { id: 'reading', name: '阅读', description: '暖白背景、系统衬线字体、窄栏宽和宽松行距。', systemDefault: false },
  { id: 'dark', name: '深色', description: '深色正文阅读区域和浅色文字。', systemDefault: false },
  { id: 'github', name: 'GitHub', description: 'GitHub 浅色 Markdown 排版，适合技术文档。', systemDefault: false },
  { id: 'typora-github', name: 'Typora GitHub', description: 'Typora GitHub 适配版：白底、宽松留白和标题分隔线。', systemDefault: false },
  { id: 'typora-newsprint', name: 'Typora Newsprint', description: 'Typora Newsprint 适配版：暖纸色、衬线字体和报刊排版。', systemDefault: false },
  { id: 'typora-night', name: 'Typora Night', description: 'Typora Night 适配版：蓝灰背景和柔和文字。', systemDefault: false },
  { id: 'obsidian', name: 'Obsidian', description: 'Obsidian 默认浅色适配版：紧凑阅读栏和紫色强调。', systemDefault: false },
  { id: 'obsidian-dark', name: 'Obsidian 深色', description: 'Obsidian 默认深色适配版：深灰正文和紫色强调。', systemDefault: false }
] as const

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    await rm(directory, { recursive: true, force: true })
  }))
})

async function filesBelow(directory: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(directory)) {
    const candidate = path.join(directory, entry)
    if ((await stat(candidate)).isDirectory()) result.push(...await filesBelow(candidate))
    else result.push(candidate)
  }
  return result
}

describe('M4 packaged plugin acceptance', () => {
  it('has a standard manifest with no undeclared MCP, app, or hook', async () => {
    const manifest = JSON.parse(await readFile(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), 'utf8')) as Record<string, unknown>
    expect(manifest).toMatchObject({ name: 'share-note', skills: './skills/' })
    expect(manifest.version).toMatch(/^0\.1\.0(?:\+codex\.[a-z0-9-]+)?$/)
    expect(manifest).not.toHaveProperty('mcpServers')
    expect(manifest).not.toHaveProperty('apps')
    expect(manifest).not.toHaveProperty('hooks')
    expect(await readdir(pluginRoot)).not.toContain('.mcp.json')
  })

  it('has one local marketplace entry with required policy metadata', async () => {
    const marketplace = JSON.parse(await readFile(path.join(root, '.agents', 'plugins', 'marketplace.json'), 'utf8')) as {
      plugins: unknown[]
    }
    expect(marketplace.plugins).toEqual([{
      name: 'share-note',
      source: { source: 'local', path: './plugins/share-note' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
      category: 'Productivity'
    }])
  })

  it('ships one routing Skill and task references', async () => {
    const skill = await readFile(path.join(pluginRoot, 'skills', 'share-note', 'SKILL.md'), 'utf8')
    expect(skill).toContain('name: share-note')
    expect(skill).toContain('A request to create content is not permission to upload it')
    for (const reference of ['setup.md', 'publish.md', 'read.md', 'manage.md', 'security.md']) {
      await expect(stat(path.join(pluginRoot, 'skills', 'share-note', 'references', reference))).resolves.toBeDefined()
    }
  })

  it('executes the precompiled bundle in a clean directory without node_modules', async () => {
    const clean = await mkdtemp(path.join(tmpdir(), 'share-note-clean-bundle-'))
    temporaryDirectories.push(clean)
    const cleanBundle = path.join(clean, 'share-note.mjs')
    const projectPath = path.join(clean, 'project')
    const setupPath = path.join(clean, 'setup.json')
    const configurePath = path.join(clean, 'configure.json')
    const requestPath = path.join(clean, 'list.json')
    const dataPath = path.join(clean, 'data')
    await copyFile(bundle, cleanBundle)
    await mkdir(projectPath)
    await writeFile(setupPath, JSON.stringify({
      profile: 'clean',
      apiBaseUrl: 'https://api.example.invalid',
      webBaseUrl: 'https://share.example.invalid',
      allowedSourceRoots: [projectPath],
      credentialEnvVar: 'CLEAN_CREDENTIAL'
    }))
    await execute(process.execPath, [cleanBundle, 'setup', '--request', setupPath], {
      cwd: clean,
      env: {
        ...process.env,
        SHARE_NOTE_DATA_DIR: dataPath,
        CLEAN_CREDENTIAL: JSON.stringify({ uid: 'clean-user', apiKey: 'clean-key' })
      }
    })
    await writeFile(configurePath, JSON.stringify({ projectRoot: projectPath, profile: 'clean' }))
    await execute(process.execPath, [cleanBundle, 'configure-project', '--request', configurePath], {
      cwd: clean,
      env: { ...process.env, SHARE_NOTE_DATA_DIR: dataPath }
    })
    await writeFile(requestPath, JSON.stringify({ projectRoot: projectPath }))
    const { stdout } = await execute(process.execPath, [cleanBundle, 'list', '--request', requestPath], {
      cwd: clean,
      env: { ...process.env, SHARE_NOTE_DATA_DIR: dataPath }
    })
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, action: 'list', scope: 'project', records: [] })
    expect(JSON.parse(await readFile(path.join(projectPath, '.openai', 'share-note.json'), 'utf8')))
      .toMatchObject({ schemaVersion: 1, profile: 'clean', records: [], operations: [] })
    expect(await readdir(clean)).not.toContain('node_modules')
  })

  it('lists the exact theme catalog from the precompiled bundle without credentials or node_modules', async () => {
    const clean = await mkdtemp(path.join(tmpdir(), 'share-note-clean-themes-'))
    temporaryDirectories.push(clean)
    const cleanBundle = path.join(clean, 'share-note.mjs')
    await copyFile(bundle, cleanBundle)
    const { stdout } = await execute(process.execPath, [cleanBundle, 'themes'], {
      cwd: clean,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        SHARE_NOTE_DATA_DIR: path.join(clean, 'data')
      }
    })
    expect(JSON.parse(stdout)).toEqual({
      ok: true,
      action: 'themes',
      status: 'verified',
      defaultTheme: 'simple',
      themes: EXPECTED_THEMES,
      warnings: []
    })
    expect(await readdir(clean)).toEqual(['share-note.mjs'])
  })

  it('reports offline capabilities from the packaged client without initializing state', async () => {
    const clean = await mkdtemp(path.join(tmpdir(), 'share-note-capabilities-'))
    temporaryDirectories.push(clean)
    const cleanBundle = path.join(clean, 'share-note.mjs')
    await copyFile(bundle, cleanBundle)
    const { stdout } = await execute(process.execPath, [cleanBundle, 'capabilities'], { cwd: clean, env: { PATH: process.env.PATH, SHARE_NOTE_DATA_DIR: path.join(clean, 'data') } })
    expect(JSON.parse(stdout)).toMatchObject({ action: 'capabilities', protocolProfile: 'note-sx-client-1.5.5', previewSchemaVersion: 5, actions: expect.arrayContaining(['link', 'update', 'capabilities']), modes: [{ encryption: 'encrypted', imageMode: 'inline', actions: ['publish', 'update'] }, { encryption: 'public', imageMode: 'upload', actions: ['update'] }] })
    expect(await readdir(clean)).toEqual(['share-note.mjs'])
  })

  it('uses private plaintext secret files from the precompiled bundle', async () => {
    const clean = await mkdtemp(path.join(tmpdir(), 'share-note-clean-plaintext-store-'))
    temporaryDirectories.push(clean)
    const requestPath = path.join(clean, 'setup.json')
    const dataPath = path.join(clean, 'data')
    await writeFile(requestPath, JSON.stringify({
      profile: 'default',
      apiBaseUrl: 'https://api.example.invalid',
      webBaseUrl: 'https://share.example.invalid',
      allowedSourceRoots: [clean],
      credentialEnvVar: 'SHARE_NOTE_CREDENTIAL'
    }))
    const { stdout } = await execute(process.execPath, [bundle, 'setup', '--request', requestPath], {
      cwd: clean,
      env: {
        ...process.env,
        SHARE_NOTE_DATA_DIR: dataPath,
        SHARE_NOTE_CREDENTIAL: JSON.stringify({ uid: 'bundle-user', apiKey: 'bundle-api-secret' })
      }
    })
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, action: 'setup', status: 'configured' })
    const persistedFiles = await filesBelow(dataPath)
    const persisted = (await Promise.all(persistedFiles.map(async (file) => readFile(file, 'utf8')))).join('\n')
    expect(persisted).toContain('"type": "plaintext-file"')
    expect(persisted).toContain('bundle-user')
    expect(persisted).toContain('bundle-api-secret')
    expect(persisted).not.toContain('SHARE_NOTE_MASTER_PASSWORD')
    if (process.platform !== 'win32') {
      for (const file of persistedFiles) expect((await stat(file)).mode & 0o777).toBe(0o600)
    }
  })

  it('ships browser-assisted setup rather than leaving it only in TypeScript source', async () => {
    const bundled = await readFile(bundle, 'utf8')
    for (const requiredImplementation of [
      'setup-browser-start',
      'setup-browser-complete',
      'SHARE_NOTE_BROWSER_API_KEY',
      'xdg-open',
      'rundll32.exe',
      '/v1/account/get-key'
    ]) {
      expect(bundled).toContain(requiredImplementation)
    }
    expect(bundled).not.toContain('obsidian://')
    expect(bundled).not.toMatch(/clipboard\.read/i)
  })

  it('ships project-scoped configuration and key storage', async () => {
    const bundled = await readFile(bundle, 'utf8')
    for (const requiredImplementation of [
      'configure-project',
      'share-note.json',
      'share-note.keys.json',
      'projectBindingHash',
      'scope: "project"'
    ]) {
      expect(bundled).toContain(requiredImplementation)
    }
  })

  it('contains no Obsidian integration or resident-service implementation', async () => {
    const sourceFiles = (await filesBelow(path.join(root, 'src'))).filter((file) => file.endsWith('.ts'))
    const source = (await Promise.all(sourceFiles.map(async (file) => readFile(file, 'utf8')))).join('\n')
    const bundled = await readFile(bundle, 'utf8')
    for (const implementation of [source, bundled]) {
      expect(implementation).not.toMatch(/from\s+['"]obsidian['"]/i)
      expect(implementation).not.toContain('obsidian://')
      expect(implementation).not.toContain('.obsidian')
      expect(implementation).not.toMatch(/createServer\s*\(/)
      expect(implementation).not.toContain('mcpServers')
      expect(implementation).not.toContain('/usr/bin/security')
      expect(implementation).not.toContain('MacOsKeychainSecretStore')
    }
  })
})
