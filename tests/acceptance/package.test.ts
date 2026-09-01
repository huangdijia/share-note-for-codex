import { copyFile, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
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
    expect(manifest).toMatchObject({ name: 'share-note', version: '0.1.0', skills: './skills/' })
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
    const requestPath = path.join(clean, 'list.json')
    const dataPath = path.join(clean, 'data')
    await copyFile(bundle, cleanBundle)
    await writeFile(requestPath, '{}\n')
    const { stdout } = await execute(process.execPath, [cleanBundle, 'list', '--request', requestPath], {
      cwd: clean,
      env: { ...process.env, SHARE_NOTE_DATA_DIR: dataPath }
    })
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, action: 'list', scope: 'local', records: [] })
    expect(await readdir(clean)).not.toContain('node_modules')
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
    }
  })
})
