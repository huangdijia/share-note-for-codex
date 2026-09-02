import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { chmod, writeFile } from 'node:fs/promises'
import type { ProfileConfig } from './config.js'
import type { BaseResult } from './result.js'
import { ensurePrivateDirectory, writeJsonAtomic } from './state/atomic.js'
import { readSafeSource } from './source.js'
import { renderDocument, type SourceFormat } from './render/renderer.js'

export interface PreviewRequest {
  sourcePath: string
  projectRoot: string
  format?: SourceFormat
}

export interface PreviewMetadata {
  schemaVersion: 2
  previewId: string
  profile: string
  apiOrigin: string
  webOrigin: string
  projectRoot: string
  projectBindingHash: string
  sourcePath: string
  sourceRealPath: string
  sourceHash: string
  contentHash: string
  title: string
  bodyHtml: string
  publishable: boolean
  createdAt: string
}

export interface PreviewResult extends BaseResult {
  action: 'preview'
  previewId: string
  previewPath: string
  profile: string
  apiOrigin: string
  webOrigin: string
  projectBindingHash: string
  sourcePath: string
  sourceHash: string
  contentHash: string
  title: string
  bytes: number
  wordCount: number
  resources: string[]
  publishable: boolean
}

function inferFormat(filePath: string, requested?: SourceFormat): SourceFormat {
  if (requested) return requested
  return /\.html?$/i.test(filePath) ? 'html' : 'markdown'
}

export async function createPreview(
  dataDirectory: string,
  profile: ProfileConfig,
  request: PreviewRequest,
  projectBindingHash: string
): Promise<PreviewResult> {
  const source = await readSafeSource(
    request.sourcePath,
    request.projectRoot,
    profile.allowedSourceRoots,
    profile.maxSourceBytes
  )
  const fallbackTitle = path.basename(source.realPath, path.extname(source.realPath))
  const rendered = renderDocument(source.content, inferFormat(source.realPath, request.format), fallbackTitle)
  const previewId = `preview-${randomUUID()}`
  const previewDirectory = path.join(dataDirectory, 'previews')
  await ensurePrivateDirectory(previewDirectory)
  const previewPath = path.join(previewDirectory, `${previewId}.html`)
  await writeFile(previewPath, rendered.documentHtml, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  await chmod(previewPath, 0o600)
  const metadata: PreviewMetadata = {
    schemaVersion: 2,
    previewId,
    profile: profile.name,
    apiOrigin: new URL(profile.apiBaseUrl).origin,
    webOrigin: new URL(profile.webBaseUrl).origin,
    projectRoot: request.projectRoot,
    projectBindingHash,
    sourcePath: source.projectRelativePath,
    sourceRealPath: source.realPath,
    sourceHash: source.sourceHash,
    contentHash: rendered.contentHash,
    title: rendered.title,
    bodyHtml: rendered.bodyHtml,
    publishable: rendered.publishable,
    createdAt: new Date().toISOString()
  }
  await writeJsonAtomic(path.join(previewDirectory, `${previewId}.json`), metadata)
  return {
    ok: true,
    action: 'preview',
    status: rendered.publishable ? 'previewed' : 'blocked',
    previewId,
    previewPath,
    profile: profile.name,
    apiOrigin: metadata.apiOrigin,
    webOrigin: metadata.webOrigin,
    projectBindingHash,
    sourcePath: source.projectRelativePath,
    sourceHash: source.sourceHash,
    contentHash: rendered.contentHash,
    title: rendered.title,
    bytes: source.bytes,
    wordCount: rendered.wordCount,
    resources: rendered.resources,
    publishable: rendered.publishable,
    warnings: [
      ...rendered.warnings,
      ...(source.symbolicLink ? ['Source is a symbolic link whose resolved target was checked inside the allowed roots.'] : [])
    ]
  }
}

export async function loadPreview(dataDirectory: string, previewId: string): Promise<PreviewMetadata> {
  if (!/^preview-[0-9a-f-]{36}$/.test(previewId)) throw new Error('Invalid preview ID')
  const value = JSON.parse(await (await import('node:fs/promises')).readFile(
    path.join(dataDirectory, 'previews', `${previewId}.json`),
    'utf8'
  )) as PreviewMetadata
  if (
    value.schemaVersion !== 2 ||
    value.previewId !== previewId ||
    typeof value.projectRoot !== 'string' ||
    typeof value.projectBindingHash !== 'string'
  ) throw new Error('Invalid preview metadata')
  return value
}
