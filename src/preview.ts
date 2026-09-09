import path from 'node:path'
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

export interface PreviewRequest {
  sourcePath: string
  projectRoot: string
  format?: SourceFormat
  theme?: ThemeId
  recordId?: string
}

export interface PreviewMetadata {
  schemaVersion: 3
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
  theme: ThemeId | null
  themeName: string
  recordId?: string
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
  theme: ThemeId | null
  themeName: string
  recordId?: string
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
  const themeName = theme ? themeDefinition(theme).name : '旧版（无主题）'
  const fallbackTitle = path.basename(source.realPath, path.extname(source.realPath))
  const rendered = renderDocument(source.content, inferFormat(source.realPath, request.format), fallbackTitle, theme)
  const previewId = `preview-${randomUUID()}`
  const previewDirectory = path.join(dataDirectory, 'previews')
  await ensurePrivateDirectory(previewDirectory)
  const previewPath = path.join(previewDirectory, `${previewId}.html`)
  await writeFile(previewPath, rendered.documentHtml, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  await chmod(previewPath, 0o600)
  const metadata: PreviewMetadata = {
    schemaVersion: 3,
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
    theme,
    themeName,
    ...(record ? { recordId: record.recordId } : {}),
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
    theme,
    themeName,
    ...(record ? { recordId: record.recordId } : {}),
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
    value.schemaVersion !== 3 ||
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
