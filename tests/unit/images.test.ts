import { mkdtemp, writeFile, readFile, rm, mkdir, symlink } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { buildProfileConfig } from '../../src/config.js'
import { readSafeSource } from '../../src/source.js'
import { resolveImages, verifyImageDependencies } from '../../src/images.js'
import { renderDocument } from '../../src/render/renderer.js'
import { sanitizeStaticHtml } from '../../src/render/sanitize.js'
import { isSafeRasterDataUri, rasterMime } from '../../src/render/raster.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6GkAAAAASUVORK5CYII=', 'base64')
const uri = `data:image/png;base64,${png.toString('base64')}`
const directories: string[] = []
async function fixture(markdown: string, maxSourceBytes = 1024) {
  const root = await mkdtemp(path.join(tmpdir(), 'share-note-images-'))
  directories.push(root)
  await writeFile(path.join(root, 'note.md'), markdown)
  await writeFile(path.join(root, 'a.png'), png)
  const profile = await buildProfileConfig({ profile: 'test', apiBaseUrl: 'https://api.example.com', webBaseUrl: 'https://example.com', allowedSourceRoots: [root], maxSourceBytes }, { type: 'plaintext-file', id: 'credentials:test' })
  const source = await readSafeSource('note.md', root, [root], maxSourceBytes)
  return { root, profile, source }
}
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

describe('local embedded raster images', () => {
  it.each([['jpg', 'image/jpeg'], ['gif', 'image/gif'], ['webp', 'image/webp']])('embeds a real %s fixture and preserves it through sanitization', async (extension, mime) => {
    const { root, profile, source } = await fixture(`![fixture](pixel.${extension})`)
    const bytes = await readFile(new URL(`../fixtures/images/pixel.${extension}`, import.meta.url))
    await writeFile(path.join(root, `pixel.${extension}`), bytes)
    const assets = await resolveImages(source, 'markdown', root, profile)
    const rendered = renderDocument(source.content, 'markdown', 'Images', 'github', assets.images)
    expect(rendered.publishable).toBe(true)
    expect(sanitizeStaticHtml(rendered.bodyHtml)).toContain(`data:${mime};base64,${bytes.toString('base64')}`)
  })

  it('resolves reference images and percent-encoded paths once in the source directory', async () => {
    const { root, profile, source } = await fixture('# Images\n![first][banner]\n![second](a.png)\n\n[banner]: a%2Epng "Banner"')
    const assets = await resolveImages(source, 'markdown', root, profile)
    expect(assets.dependencies).toHaveLength(1)
    const result = renderDocument(source.content, 'markdown', 'Images', 'github', assets.images)
    expect(result.publishable).toBe(true)
    expect(result.resources).toEqual(['a%2Epng', 'a.png'])
    expect(result.bodyHtml).toContain(uri)
    expect(result.bodyHtml).toContain('title="Banner"')
    expect(result.bodyHtml).toContain('max-width: 100%')
    expect(result.warnings).toEqual([])
  })

  it.each(['https://example.com/a.png', '//example.com/a.png', 'data:image/png;base64,abc', '../outside.png', 'a.svg', '/etc/passwd', 'a.png?query', '%2Fetc%2Fpasswd'])('blocks unsupported reference %s', async (reference) => {
    const { root, profile, source } = await fixture(`![blocked](${reference})`)
    const assets = await resolveImages(source, 'markdown', root, profile)
    expect(assets.dependencies).toEqual([])
    expect(renderDocument(source.content, 'markdown', 'Images', 'github', assets.images).publishable).toBe(false)
    expect(assets.warnings).toHaveLength(1)
  })

  it('blocks symlinks outside roots and notices retargeting inside roots even for equal bytes', async () => {
    const { root, profile, source } = await fixture('![a](link.png)')
    await symlink(path.join(root, 'a.png'), path.join(root, 'link.png'))
    const assets = await resolveImages(source, 'markdown', root, profile)
    await writeFile(path.join(root, 'b.png'), png)
    await rm(path.join(root, 'link.png'))
    await symlink(path.join(root, 'b.png'), path.join(root, 'link.png'))
    await expect(verifyImageDependencies(assets.dependencies, source.bytes, root, profile)).rejects.toMatchObject({ code: 'content_blocked' })
    const external = await mkdtemp(path.join(tmpdir(), 'share-note-outside-'))
    directories.push(external)
    await writeFile(path.join(external, 'a.png'), png)
    await rm(path.join(root, 'link.png'))
    await symlink(path.join(external, 'a.png'), path.join(root, 'link.png'))
    expect((await resolveImages(source, 'markdown', root, profile)).images.size).toBe(0)
  })

  it('counts every rendered image occurrence against the byte budget', async () => {
    const { root, profile, source } = await fixture('![a](a.png)\n'.repeat(10), 256)
    const assets = await resolveImages(source, 'markdown', root, profile)
    expect(assets.images.size).toBe(0)
    expect(renderDocument(source.content, 'markdown', 'Images', 'github', assets.images).publishable).toBe(false)
  })

  it('enforces allowed roots and the combined source and image byte budget', async () => {
    const { root, profile, source } = await fixture('![a](a.png)', 70)
    expect((await resolveImages(source, 'markdown', root, profile)).images.size).toBe(0)
    await mkdir(path.join(root, 'notes'))
    await writeFile(path.join(root, 'notes', 'note.md'), '![a](../a.png)')
    const nested = await readSafeSource('notes/note.md', root, [path.join(root, 'notes')], 1024)
    profile.maxSourceBytes = 1024
    profile.allowedSourceRoots = [path.join(root, 'notes')]
    expect((await resolveImages(nested, 'markdown', root, profile)).images.size).toBe(0)
  })

  it('keeps raw HTML images blocked and sensitive findings active', async () => {
    const { root, profile, source } = await fixture('![a](a.png)\n\napi_key = "abcdefghijklmnop123456"')
    const assets = await resolveImages(source, 'markdown', root, profile)
    expect(renderDocument(source.content, 'markdown', 'Images', 'github', assets.images).publishable).toBe(false)
    for (const format of ['html', 'markdown'] as const) {
      expect(renderDocument(`<img src="${uri}">`, format, 'Images').publishable).toBe(false)
    }
  })

  it('sanitizes image handlers, remote URLs, MIME mismatches, SVG and invalid dimensions', () => {
    expect(sanitizeStaticHtml(`<img src="${uri}" alt="safe" onerror="alert(1)" srcset="https://evil.test/a 2x">`)).toBe(`<img src="${uri}" alt="safe" />`)
    for (const value of ['https://evil.test/a.png', uri.replace('image/png', 'image/jpeg'), 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=']) {
      expect(sanitizeStaticHtml(`<img src="${value}">`)).toBe('')
    }
    expect(isSafeRasterDataUri(uri)).toBe(true)
    const bad = Buffer.from(png)
    bad.writeUInt32BE(0, 16)
    expect(rasterMime(bad)).toBeUndefined()
    bad.writeUInt32BE(99999, 16)
    expect(rasterMime(bad)).toBeUndefined()
    expect(rasterMime(Buffer.from('<svg/>'))).toBeUndefined()
  })
})
