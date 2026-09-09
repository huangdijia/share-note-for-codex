import { randomUUID } from 'node:crypto'
import { credentialIdentityReference, type ProfileConfig } from './config.js'
import { encryptModern } from './crypto/codecs.js'
import { ShareNoteError } from './errors.js'
import { ShareNoteHttpClient, type FetchImplementation } from './http/client.js'
import { loadPreview } from './preview.js'
import {
  PROTOCOL_PROFILE,
  type CreateNoteRequest,
  type DeleteNoteRequest,
  type NoteTemplate
} from './protocol/profile.js'
import { uploadPreviewImages } from './upload-images.js'
import { canonicalPublicHtml, decodeSharePage } from './read/page.js'
import type { BaseResult } from './result.js'
import type { SecretStore } from './secrets/store.js'
import { readSafeSource } from './source.js'
import { verifyImageDependencies } from './images.js'
import type { ProjectStore } from './project.js'
import { withLocalLock } from './state/lock.js'
import type { OperationRecord, ShareRecord } from './state/store.js'
import { sha1Hex, sha256Hex, validateRemoteUrl } from './publish.js'
import type { ThemeId } from './render/themes.js'

export interface UpdateRequest {
  projectRoot: string
  recordId: string
  previewId: string
  expectedContentHash: string
  authorization: {
    granted: true
    action: 'update'
    profile: string
    projectBindingHash: string
    recordId: string
    contentHash: string
    encryption: 'encrypted' | 'public'
    imageMode?: 'inline' | 'upload'
  }
  returnShareUrl?: boolean
}

export interface DeleteRequest {
  projectRoot: string
  recordId: string
  authorization: {
    granted: true
    action: 'delete'
    recordId: string
  }
  verificationAttempts?: number
  verificationDelayMilliseconds?: number
}

export interface ListRequest {
  projectRoot: string
  query?: string
}

function identityReference(profile: ProfileConfig): string {
  return credentialIdentityReference(profile.credentialRef)
}

function assertRecordBinding(record: ShareRecord, profile: ProfileConfig): void {
  if (
    record.profile !== profile.name ||
    record.apiOrigin !== new URL(profile.apiBaseUrl).origin ||
    record.webOrigin !== new URL(profile.webBaseUrl).origin ||
    record.identityRef !== identityReference(profile)
  ) {
    throw new ShareNoteError('content_blocked', 'Local record is not bound to the active service and identity')
  }
}

function validateUpdateAuthorization(
  request: UpdateRequest,
  profile: ProfileConfig,
  projectBindingHash: string
): void {
  const authorization = request.authorization
  if (
    authorization?.granted !== true ||
    authorization.action !== 'update' ||
    authorization.profile !== profile.name ||
    authorization.projectBindingHash !== projectBindingHash ||
    authorization.recordId !== request.recordId ||
    authorization.contentHash !== request.expectedContentHash ||
    !['encrypted', 'public'].includes(authorization.encryption)
  ) {
    throw new ShareNoteError('content_blocked', 'Update authorization is missing or does not match the record and preview')
  }
}

function validateDeleteAuthorization(request: DeleteRequest): void {
  const authorization = request.authorization
  if (
    authorization?.granted !== true ||
    authorization.action !== 'delete' ||
    authorization.recordId !== request.recordId
  ) {
    throw new ShareNoteError('content_blocked', 'Delete authorization is missing or does not match the record')
  }
}

async function readAndCompare(
  client: ShareNoteHttpClient,
  record: ShareRecord,
  key: string
): Promise<'absent' | 'matched' | 'changed'> {
  const page = await client.getPage(record.shareUrl)
  if (page.status === 404 || page.status === 410 || !page.html) return 'absent'
  const decoded = await decodeSharePage(page.html, key, record.webOrigin)
  return decoded.encrypted === record.encrypted && decoded.title === record.title && sha256Hex(decoded.rawHtml) === record.contentHash
    ? 'matched'
    : 'changed'
}

export async function updateRecord(
  dataDirectory: string,
  profile: ProfileConfig,
  project: ProjectStore,
  projectBindingHash: string,
  secrets: SecretStore,
  request: UpdateRequest,
  fetchImplementation: FetchImplementation = fetch
): Promise<BaseResult & {
  action: 'update'
  recordId: string
  operationId: string
  verification: { fetched: boolean; decrypted: boolean; contentMatched: boolean }
  theme: ThemeId | null
  shareUrl?: string
}> {
  validateUpdateAuthorization(request, profile, projectBindingHash)
  return withLocalLock(dataDirectory, `project:${project.projectRoot}:record:${request.recordId}`, async () => {
    const record = await project.getRecord(request.recordId)
    assertRecordBinding(record, profile)
    const preview = await loadPreview(dataDirectory, request.previewId)
    if (
      preview.profile !== profile.name ||
      preview.projectRoot !== project.projectRoot ||
      preview.projectBindingHash !== projectBindingHash ||
      preview.contentHash !== request.expectedContentHash ||
      preview.recordId !== record.recordId ||
      preview.sourcePath !== record.sourcePath ||
      !preview.publishable ||
      request.authorization.encryption !== preview.encryption ||
      (request.authorization.imageMode ?? 'inline') !== preview.imageMode
    ) {
      throw new ShareNoteError('content_blocked', 'Update preview is blocked or does not match the request')
    }
    const source = await readSafeSource(
      preview.sourcePath,
      project.projectRoot,
      profile.allowedSourceRoots,
      profile.maxSourceBytes
    )
    if (source.sourceHash !== preview.sourceHash) {
      throw new ShareNoteError('content_blocked', 'Source changed after preview; create a new preview before updating')
    }
    await verifyImageDependencies(preview.imageDependencies, source.bytes, project.projectRoot, profile)
    const credential = await secrets.readCredential(profile.credentialRef)
    const key = record.encrypted || preview.encryption === 'encrypted' ? await project.readNoteKey(record.noteKeyRef) : ''
    const client = new ShareNoteHttpClient(profile, credential, fetchImplementation)
    const baseline = await readAndCompare(client, record, key)
    if (baseline === 'absent') {
      throw new ShareNoteError('not_found', 'Original remote target is absent; update was not submitted')
    }
    if (baseline === 'changed') {
      throw new ShareNoteError('conflict', 'Remote note changed since the last verified local record')
    }

    if (preview.encryption === 'public' && /\$[&`']|TEMPLATE_[A-Z_]+/.test(preview.bodyHtml)) {
      throw new ShareNoteError('content_blocked', 'Public content contains unsupported server-template replacement sequences')
    }
    const previous = await project.listOperations()
    if (previous.some((item) => item.recordId === record.recordId &&
      (item.status === 'unknown' || item.status === 'pending') && item.imageUploads?.some((image) => image.status !== 'verified'))) {
      throw new ShareNoteError('content_blocked', 'A previous image upload is unresolved; reconcile its ledger before another upload')
    }
    const operationId = `op-${randomUUID()}`
    const now = new Date().toISOString()
    const operation: OperationRecord = {
      schemaVersion: 1,
      operationId,
      action: 'update',
      recordId: record.recordId,
      profile: profile.name,
      target: record.shareUrl,
      status: 'pending',
      contentHash: preview.contentHash,
      noteKeyRef: record.noteKeyRef,
      createdAt: now,
      updatedAt: now
    }
    await project.writeOperation(operation)
    let finalHtml = preview.bodyHtml
    if (preview.imageMode === 'upload') {
      try {
        finalHtml = canonicalPublicHtml(await uploadPreviewImages(preview, profile, project, client, operation))
        const current = await readSafeSource(preview.sourcePath, project.projectRoot, profile.allowedSourceRoots, profile.maxSourceBytes)
        if (current.sourceHash !== preview.sourceHash) throw new ShareNoteError('content_blocked', 'Source changed during image upload')
        await verifyImageDependencies(preview.imageDependencies, current.bytes, project.projectRoot, profile)
      } catch {
        if (operation.status !== 'unknown') {
          operation.status = 'failed'
          operation.diagnostic = 'Image preparation failed; the note update was not submitted.'
          await project.writeOperation(operation)
        }
        return {
          ok: false, action: 'update' as const, status: operation.status,
          recordId: record.recordId, operationId, theme: preview.theme,
          verification: { fetched: false, decrypted: false, contentMatched: false },
          warnings: ['Image upload or verification failed. The existing note was not updated; uploaded images may remain public. Inspect the operation image ledger before retrying.']
        }
      }
    }
    const finalHash = sha256Hex(finalHtml)
    const encrypted = preview.encryption === 'encrypted'
      ? await encryptModern(JSON.stringify({ content: finalHtml, basename: preview.title }), key)
      : undefined
    const template: NoteTemplate = {
      filename: record.remoteFilename,
      width: '', elements: [], encrypted: Boolean(encrypted),
      content: encrypted ? JSON.stringify(encrypted.payload) : finalHtml,
      ...(encrypted ? {} : { title: preview.title, description: '' }),
      mathJax: false
    }
    const body: CreateNoteRequest = {
      filename: record.remoteFilename, filetype: 'html',
      hash: sha1Hex(template.content), template
    }
    let response: { url?: string }
    try {
      response = await client.postJson<{ url?: string }>(PROTOCOL_PROFILE.routes.create, body)
    } catch {
      operation.status = 'unknown'
      operation.updatedAt = new Date().toISOString()
      operation.diagnostic = 'Update request had no trustworthy response; it was not retried.'
      await project.writeOperation(operation)
      return {
        ok: false,
        action: 'update' as const,
        status: 'unknown' as const,
        recordId: record.recordId,
        operationId,
        verification: { fetched: false, decrypted: false, contentMatched: false },
        theme: preview.theme,
        warnings: ['The update may have been accepted. It was not retried.']
      }
    }
    if (typeof response.url !== 'string') throw new ShareNoteError('protocol_error', 'Update response did not contain a share URL')
    const remote = validateRemoteUrl(profile, response.url)
    operation.remoteUrl = remote.baseUrl
    if (remote.baseUrl !== record.shareUrl || remote.filename !== record.remoteFilename) {
      operation.status = 'failed'
      operation.updatedAt = new Date().toISOString()
      operation.diagnostic = 'Server returned a different target URL.'
      await project.writeOperation(operation)
      return {
        ok: false,
        action: 'update' as const,
        status: 'failed' as const,
        recordId: record.recordId,
        operationId,
        verification: { fetched: false, decrypted: false, contentMatched: false },
        theme: preview.theme,
        warnings: ['The server returned a different URL; the original record was not reported as successfully updated.']
      }
    }

    const verification = { fetched: false, decrypted: false, contentMatched: false }
    try {
      const page = await client.getPage(record.shareUrl)
      if (page.status === 200 && page.html) {
        verification.fetched = true
        const decoded = await decodeSharePage(page.html, key, record.webOrigin)
        verification.decrypted = decoded.encrypted
        verification.contentMatched = decoded.encrypted === (preview.encryption === 'encrypted') && decoded.title === preview.title && sha256Hex(decoded.rawHtml) === finalHash
      }
    } catch {
      // The submitted state is persisted below without claiming verification.
    }
    const verified = verification.fetched && (preview.encryption === 'public' || verification.decrypted) && verification.contentMatched
    operation.status = verified ? 'verified' : 'submitted_unverified'
    operation.updatedAt = new Date().toISOString()
    record.status = operation.status
    record.updatedAt = operation.updatedAt
    if (verified) {
      record.sourcePath = preview.sourcePath
      record.sourceHash = preview.sourceHash
      record.contentHash = finalHash
      record.encrypted = preview.encryption === 'encrypted'
      record.title = preview.title
      if (preview.theme) record.theme = preview.theme
      else delete record.theme
    }
    await project.saveRecord(record)
    await project.writeOperation(operation)
    return {
      ok: verified,
      action: 'update' as const,
      status: operation.status,
      recordId: record.recordId,
      operationId,
      verification,
      theme: preview.theme,
      ...(request.returnShareUrl === true ? { shareUrl: preview.encryption === 'encrypted' ? `${record.shareUrl}#${key}` : record.shareUrl } : {}),
      warnings: verified ? [] : ['Update was submitted but did not pass read-back verification.']
    }
  })
}

async function delay(milliseconds: number): Promise<void> {
  if (milliseconds > 0) await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

export async function deleteRecord(
  dataDirectory: string,
  profile: ProfileConfig,
  project: ProjectStore,
  secrets: SecretStore,
  request: DeleteRequest,
  fetchImplementation: FetchImplementation = fetch
): Promise<BaseResult & {
  action: 'delete'
  recordId: string
  operationId: string
  requestStatus: 'not_sent' | 'submitted' | 'unknown'
  verificationStatus: 'verified_absent' | 'still_present' | 'unknown'
  sourceFilePreserved: true
}> {
  validateDeleteAuthorization(request)
  return withLocalLock(dataDirectory, `project:${project.projectRoot}:record:${request.recordId}`, async () => {
    const record = await project.getRecord(request.recordId)
    assertRecordBinding(record, profile)
    const key = record.encrypted ? await project.readNoteKey(record.noteKeyRef) : ''
    const credential = await secrets.readCredential(profile.credentialRef)
    const client = new ShareNoteHttpClient(profile, credential, fetchImplementation)
    const operationId = `op-${randomUUID()}`
    const now = new Date().toISOString()
    const operation: OperationRecord = {
      schemaVersion: 1,
      operationId,
      action: 'delete',
      recordId: record.recordId,
      profile: profile.name,
      target: record.shareUrl,
      status: 'pending',
      createdAt: now,
      updatedAt: now
    }
    const baseline = await readAndCompare(client, record, key)
    if (baseline === 'changed') {
      throw new ShareNoteError('conflict', 'Remote note no longer matches the local record; delete was not submitted')
    }
    if (baseline === 'absent') {
      operation.status = 'already_absent'
      await project.writeOperation(operation)
      record.status = 'already_absent'
      record.updatedAt = new Date().toISOString()
      await project.saveRecord(record)
      return {
        ok: true,
        action: 'delete' as const,
        status: 'already_absent' as const,
        recordId: record.recordId,
        operationId,
        requestStatus: 'not_sent' as const,
        verificationStatus: 'verified_absent' as const,
        sourceFilePreserved: true as const,
        warnings: ['Remote target was already absent; no delete request was sent.']
      }
    }
    await project.writeOperation(operation)
    const body: DeleteNoteRequest = { filename: record.remoteFilename, filetype: 'html' }
    try {
      await client.postJson<{ success?: boolean }>(PROTOCOL_PROFILE.routes.delete, body)
    } catch {
      operation.status = 'unknown'
      operation.updatedAt = new Date().toISOString()
      operation.diagnostic = 'Delete request had no trustworthy response and was not retried.'
      await project.writeOperation(operation)
      return {
        ok: false,
        action: 'delete' as const,
        status: 'unknown' as const,
        recordId: record.recordId,
        operationId,
        requestStatus: 'unknown' as const,
        verificationStatus: 'unknown' as const,
        sourceFilePreserved: true as const,
        warnings: ['Delete may have been accepted. Source file and local record were preserved.']
      }
    }

    const attempts = Math.min(Math.max(request.verificationAttempts ?? 3, 1), 5)
    const wait = Math.min(Math.max(request.verificationDelayMilliseconds ?? 250, 0), 5_000)
    let absent = false
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await delay(wait)
      const page = await client.getPage(record.shareUrl)
      if (page.status === 404 || page.status === 410) {
        absent = true
        break
      }
    }
    operation.status = absent ? 'verified' : 'submitted_unverified'
    operation.updatedAt = new Date().toISOString()
    record.status = operation.status
    record.updatedAt = operation.updatedAt
    if (absent) record.deletedAt = operation.updatedAt
    await project.saveRecord(record)
    await project.writeOperation(operation)
    return {
      ok: absent,
      action: 'delete' as const,
      status: operation.status,
      recordId: record.recordId,
      operationId,
      requestStatus: 'submitted' as const,
      verificationStatus: absent ? 'verified_absent' as const : 'still_present' as const,
      sourceFilePreserved: true as const,
      warnings: absent
        ? ['Remote absence was verified. Local source and audit record were preserved.']
        : ['Delete returned, but the page remained readable within the bounded verification window.']
    }
  })
}

export async function listLocalRecords(
  project: ProjectStore,
  request: ListRequest
): Promise<BaseResult & {
  action: 'list'
  scope: 'project'
  records: Array<{
    recordId: string
    profile: string
    title: string
    sourcePath: string
    shareUrl: string
    status: string
    theme?: ThemeId
    updatedAt: string
  }>
  pendingOperations: number
}> {
  const records = await project.listRecords(request.query)
  const pendingOperations = (await project.listOperations('pending')).length
  return {
    ok: true,
    action: 'list',
    status: 'verified',
    scope: 'project',
    records: records.map((record) => ({
      recordId: record.recordId,
      profile: record.profile,
      title: record.title,
      sourcePath: record.sourcePath,
      shareUrl: record.shareUrl,
      status: record.status,
      ...(record.theme ? { theme: record.theme } : {}),
      updatedAt: record.updatedAt
    })),
    pendingOperations,
    warnings: ['This is the current project registry, not a complete remote account inventory.']
  }
}
