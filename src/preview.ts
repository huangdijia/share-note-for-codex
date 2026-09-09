import path from 'node:path'
import { publicContentWarnings } from './render/public-content.js'
import { resolveImages, type ImageDependency } from './images.js'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, writeFile } from 'node:fs/promises'
import type { ProfileConfig } from './config.js'
import type { BaseResult } from './result.js'
import { ensurePrivateDirectory, writeJsonAtomic } from './state/atomic.js'
import { readSafeSource } from './source.js'
import { renderDocument, type SourceFormat } from './render/renderer.js'
import type { ProjectManifest } from './project.js'
import { ShareNoteError } from './errors.js'
import {
  DEFAULT_THEME,
  THEME_IDS,
  hasThemedArticleWrapper,
  matchesThemedArticle,
  parseTheme,
  themeDefinition,
  type ThemeId
} from './render/themes.js'

export const PREVIEW_SCHEMA_VERSION = 5

export interface PreviewRequest {
  sourcePath: string
  projectRoot: string
  format?: SourceFormat
  theme?: ThemeId
  recordId?: string
  encryption?: 'encrypted' | 'public'
  imageMode?: 'inline' | 'upload'
}

export interface PreviewMetadata {
  schemaVersion: typeof PREVIEW_SCHEMA_VERSION
  previewId: string
  profile: string
  apiOrigin: string
  webOrigin: string
  projectRoot: string
  projectBindingHash: string
  sourcePath: string
  sourceRealPath: string
  sourceHash: string
  imageDependencies: ImageDependency[]
  contentHash: string
  title: string
  bodyHtml: string
  theme: ThemeId | null
  themeName: string
  recordId?: string
  encryption: 'encrypted' | 'public'
  imageMode: 'inline' | 'upload'
  publishable: boolean
  createdAt: string
}

export interface PreviewResult extends BaseResult {
  action: 'preview'
  images: { mode: 'inline' | 'upload'; unique: number; occurrences: number; bytes: number }
  visibility: 'encrypted-content' | 'public-content-and-images'
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
  theme: ThemeId | null
  themeName: string
  recordId?: string
  bytes: number
  wordCount: number
  resources: string[]
  encryption: 'encrypted' | 'public'
  imageMode: 'inline' | 'upload'
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
  projectBindingHash: string,
  manifest: ProjectManifest
): Promise<PreviewResult> {
  const source = await readSafeSource(
    request.sourcePath,
    request.projectRoot,
    profile.allowedSourceRoots,
    profile.maxSourceBytes
  )
  let record = undefined
  if (request.recordId !== undefined) {
    if (typeof request.recordId !== 'string' || !/^note-[0-9a-f-]{36}$/.test(request.recordId)) {
      throw new ShareNoteError('invalid_request', 'Invalid record ID')
    }
    record = manifest.records.find((candidate) => candidate.recordId === request.recordId)
    if (!record) throw new ShareNoteError('not_found', `Project record ${request.recordId} was not found`)
    if (record.sourcePath !== source.projectRelativePath) {
      throw new ShareNoteError('content_blocked', 'Update preview sourcePath does not match the target record')
    }
  }
  const explicitTheme = request.theme === undefined ? undefined : parseTheme(request.theme)
  const theme = record
    ? explicitTheme ?? record.theme ?? null
    : explicitTheme ?? manifest.defaultTheme ?? DEFAULT_THEME
  const encryption = request.encryption ?? (record?.encrypted === false ? 'public' : 'encrypted')
  const imageMode = request.imageMode ?? (encryption === 'public' ? 'upload' : 'inline')
  if (!['encrypted', 'public'].includes(encryption) || !['inline', 'upload'].includes(imageMode) ||
    (encryption === 'public' ? (!record || !theme || imageMode !== 'upload') : imageMode !== 'inline')) {
    throw new ShareNoteError('invalid_request', 'Public mode requires an existing themed record and uploaded images; new shares remain encrypted')
  }
  const themeName = theme ? themeDefinition(theme).name : '旧版（无主题）'
  const fallbackTitle = path.basename(source.realPath, path.extname(source.realPath))
  const format = inferFormat(source.realPath, request.format)
  const assets = await resolveImages(source, format, request.projectRoot, profile)
  const rendered = renderDocument(source.content, format, fallbackTitle, theme, assets.images)
  const publicWarnings = encryption === 'public' ? publicContentWarnings(rendered.bodyHtml) : []
  const publishable = rendered.publishable && publicWarnings.length === 0
  const imageBytes = assets.dependencies.reduce((sum, dependency) => sum + dependency.bytes * dependency.occurrences, 0)
  const previewId = `preview-${randomUUID()}`
  const previewDirectory = path.join(dataDirectory, 'previews')
  await ensurePrivateDirectory(previewDirectory)
  const previewPath = path.join(previewDirectory, `${previewId}.html`)
  await writeFile(previewPath, rendered.documentHtml, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  await chmod(previewPath, 0o600)
  const metadata: PreviewMetadata = {
    schemaVersion: PREVIEW_SCHEMA_VERSION,
    previewId,
    profile: profile.name,
    apiOrigin: new URL(profile.apiBaseUrl).origin,
    webOrigin: new URL(profile.webBaseUrl).origin,
    projectRoot: request.projectRoot,
    projectBindingHash,
    sourcePath: source.projectRelativePath,
    sourceRealPath: source.realPath,
    sourceHash: source.sourceHash,
    imageDependencies: assets.dependencies,
    contentHash: rendered.contentHash,
    title: rendered.title,
    bodyHtml: rendered.bodyHtml,
    theme,
    themeName,
    ...(record ? { recordId: record.recordId } : {}),
    encryption,
    imageMode,
    publishable,
    createdAt: new Date().toISOString()
  }
  await writeJsonAtomic(path.join(previewDirectory, `${previewId}.json`), metadata)
  return {
    ok: true,
    action: 'preview',
    images: { mode: imageMode, unique: assets.dependencies.length, occurrences: assets.dependencies.reduce((sum, dependency) => sum + dependency.occurrences, 0), bytes: imageBytes },
    visibility: encryption === 'public' ? 'public-content-and-images' : 'encrypted-content',
    status: publishable ? 'previewed' : 'blocked',
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
    theme,
    themeName,
    ...(record ? { recordId: record.recordId } : {}),
    bytes: source.bytes + imageBytes,
    wordCount: rendered.wordCount,
    resources: rendered.resources,
    encryption,
    imageMode,
    publishable,
    warnings: [
      ...rendered.warnings,
      ...publicWarnings,
      ...assets.warnings,
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
  const recordIdValid = value.recordId === undefined || /^note-[0-9a-f-]{36}$/.test(value.recordId)
  const bodyHtmlValid = typeof value.bodyHtml === 'string'
  const themeValid = bodyHtmlValid && (value.theme === null
    ? value.recordId !== undefined &&
      value.themeName === '旧版（无主题）' &&
      !hasThemedArticleWrapper(value.bodyHtml)
    : THEME_IDS.includes(value.theme) &&
      matchesThemedArticle(value.bodyHtml, value.theme) &&
      value.themeName === themeDefinition(value.theme).name)
  if (
    value.schemaVersion !== PREVIEW_SCHEMA_VERSION ||
    !(value.encryption === 'encrypted' && value.imageMode === 'inline' || value.encryption === 'public' && value.imageMode === 'upload' && Boolean(value.recordId) && Boolean(value.theme)) ||
    !Array.isArray(value.imageDependencies) ||
    !value.imageDependencies.every((dependency) => dependency &&
      typeof dependency.path === 'string' && !path.isAbsolute(dependency.path) &&
      typeof dependency.realPath === 'string' && path.isAbsolute(dependency.realPath) &&
      typeof dependency.hash === 'string' && /^[0-9a-f]{64}$/.test(dependency.hash) &&
      Number.isSafeInteger(dependency.bytes) && dependency.bytes > 0 &&
      Number.isSafeInteger(dependency.occurrences) && dependency.occurrences > 0) ||
    value.previewId !== previewId ||
    typeof value.projectRoot !== 'string' ||
    typeof value.projectBindingHash !== 'string' ||
    typeof value.bodyHtml !== 'string' ||
    typeof value.contentHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.contentHash) ||
    createHash('sha256').update(value.bodyHtml, 'utf8').digest('hex') !== value.contentHash ||
    !themeValid ||
    typeof value.themeName !== 'string' ||
    !recordIdValid
  ) throw new Error('Invalid preview metadata')
  return value
}
