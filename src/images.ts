import path from 'node:path'
import { realpath } from 'node:fs/promises'
import { marked } from 'marked'
import type { ProfileConfig } from './config.js'
import { ShareNoteError } from './errors.js'
import { readSafeFile, type SafeSource } from './source.js'
import { rasterMime } from './render/raster.js'
import type { SourceFormat } from './render/renderer.js'

export interface ImageDependency {
  path: string
  realPath: string
  hash: string
  bytes: number
  occurrences: number
}

export async function resolveImages(source: SafeSource, format: SourceFormat, projectRoot: string, profile: ProfileConfig): Promise<{
  images: Map<string, string>
  dependencies: ImageDependency[]
  warnings: string[]
}> {
  const images = new Map<string, string>()
  const dependencies: ImageDependency[] = []
  const warnings: string[] = []
  if (format !== 'markdown') return { images, dependencies, warnings }
  const references = new Map<string, number>()
  marked.walkTokens(marked.lexer(source.content), (token) => {
    if (token.type === 'image') references.set(token.href, (references.get(token.href) ?? 0) + 1)
  })
  const resolvedRoot = await realpath(projectRoot)
  let remaining = profile.maxSourceBytes - source.bytes
  const files = new Map<string, { uri: string; dependency: ImageDependency }>()
  for (const [reference, count] of references) {
    try {
      const decoded = decodeURIComponent(reference)
      if (!decoded || /^[a-z][a-z0-9+.-]*:/i.test(decoded) || path.isAbsolute(decoded) || /[\\\x00?#]/.test(decoded)) {
        throw new Error('Only relative local image paths are supported')
      }
      const relativePath = path.relative(resolvedRoot, path.resolve(path.dirname(source.realPath), decoded))
      const existing = files.get(relativePath)
      if (existing) {
        if (existing.dependency.bytes * count > remaining) throw new Error('Repeated image exceeds size limit')
        remaining -= existing.dependency.bytes * count
        existing.dependency.occurrences += count
        images.set(reference, existing.uri)
        continue
      }
      const file = await readSafeFile(relativePath, projectRoot, profile.allowedSourceRoots, remaining)
      const mime = rasterMime(file.buffer)
      const extensionMime: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
      if (!mime || extensionMime[path.extname(decoded).toLowerCase()] !== mime) {
        throw new Error('Image extension, raster header or dimensions are unsupported')
      }
      if (file.bytes * count > remaining) throw new Error('Repeated image exceeds size limit')
      remaining -= file.bytes * count
      const dependency = { path: relativePath, realPath: file.realPath, hash: file.sourceHash, bytes: file.bytes, occurrences: count }
      const uri = `data:${mime};base64,${file.buffer.toString('base64')}`
      files.set(relativePath, { uri, dependency })
      dependencies.push(dependency)
      images.set(reference, uri)
    } catch {
      warnings.push(`Image could not be embedded: ${reference}. Use a valid local PNG, JPEG, GIF or WebP within the allowed roots and total source size limit.`)
    }
  }
  return { images, dependencies, warnings }
}

export async function verifyImageDependencies(dependencies: ImageDependency[], sourceBytes: number, projectRoot: string, profile: ProfileConfig): Promise<void> {
  let remaining = profile.maxSourceBytes - sourceBytes
  for (const dependency of dependencies) {
    const file = await readSafeFile(dependency.path, projectRoot, profile.allowedSourceRoots, remaining)
    if (file.realPath !== dependency.realPath || file.sourceHash !== dependency.hash || file.bytes !== dependency.bytes) {
      throw new ShareNoteError('content_blocked', 'Image changed after preview; create a new preview before writing')
    }
    if (file.bytes * dependency.occurrences > remaining) {
      throw new ShareNoteError('content_blocked', 'Embedded images exceed the configured size limit')
    }
    remaining -= file.bytes * dependency.occurrences
  }
}
