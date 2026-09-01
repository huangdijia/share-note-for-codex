import { randomUUID } from 'node:crypto'
import type { ProfileConfig } from './config.js'
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
import { decodeSharePage } from './read/page.js'
import type { BaseResult } from './result.js'
import type { SecretStore } from './secrets/store.js'
import { readSafeSource } from './source.js'
import { withLocalLock } from './state/lock.js'
import { StateStore, type OperationRecord, type ShareRecord } from './state/store.js'
import { sha1Hex, sha256Hex, validateRemoteUrl } from './publish.js'

export interface UpdateRequest {
  profile: string
  recordId: string
  previewId: string
  workspaceRoot: string
  expectedContentHash: string
  authorization: {
    granted: true
    action: 'update'
    recordId: string
    contentHash: string
    encryption: 'encrypted'
  }
  returnShareUrl?: boolean
}

export interface DeleteRequest {
  profile: string
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
  profile?: string
  query?: string
}

function identityReference(profile: ProfileConfig): string {
  return `${profile.credentialRef.service}:${profile.credentialRef.account}`
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

function validateUpdateAuthorization(request: UpdateRequest): void {
  const authorization = request.authorization
  if (
    authorization?.granted !== true ||
    authorization.action !== 'update' ||
    authorization.recordId !== request.recordId ||
    authorization.contentHash !== request.expectedContentHash ||
    authorization.encryption !== 'encrypted'
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
  const decoded = await decodeSharePage(page.html, key)
  return decoded.title === record.title && sha256Hex(decoded.html) === record.contentHash
    ? 'matched'
    : 'changed'
}

export async function updateRecord(
  dataDirectory: string,
  profile: ProfileConfig,
  secrets: SecretStore,
  request: UpdateRequest,
  fetchImplementation: FetchImplementation = fetch
): Promise<BaseResult & {
  action: 'update'
  recordId: string
  operationId: string
  verification: { fetched: boolean; decrypted: boolean; contentMatched: boolean }
  shareUrl?: string
}> {
  validateUpdateAuthorization(request)
  return withLocalLock(dataDirectory, `record:${request.recordId}`, async () => {
    const state = new StateStore(dataDirectory)
    const record = await state.getRecord(request.recordId)
    assertRecordBinding(record, profile)
    const preview = await loadPreview(dataDirectory, request.previewId)
    if (
      preview.profile !== profile.name ||
      preview.contentHash !== request.expectedContentHash ||
      !preview.publishable
    ) {
      throw new ShareNoteError('content_blocked', 'Update preview is blocked or does not match the request')
    }
    const source = await readSafeSource(
      preview.sourceRealPath,
      request.workspaceRoot,
      profile.allowedSourceRoots,
      profile.maxSourceBytes
    )
    if (source.sourceHash !== preview.sourceHash) {
      throw new ShareNoteError('content_blocked', 'Source changed after preview; create a new preview before updating')
    }
    const credential = await secrets.readCredential(profile.credentialRef)
    const key = await secrets.readNoteKey(record.noteKeyRef)
    const client = new ShareNoteHttpClient(profile, credential, fetchImplementation)
    const baseline = await readAndCompare(client, record, key)
    if (baseline === 'absent') {
      throw new ShareNoteError('not_found', 'Original remote target is absent; update was not submitted')
    }
    if (baseline === 'changed') {
      throw new ShareNoteError('conflict', 'Remote note changed since the last verified local record')
    }

    const encrypted = await encryptModern(JSON.stringify({
      content: preview.bodyHtml,
      basename: preview.title
    }), key)
    const template: NoteTemplate = {
      filename: record.remoteFilename,
      width: '',
      elements: [],
      encrypted: true,
      content: JSON.stringify(encrypted.payload),
      mathJax: false
    }
    const body: CreateNoteRequest = {
      filename: record.remoteFilename,
      filetype: 'html',
      hash: sha1Hex(template.content),
      template
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
    await state.writeOperation(operation)
    let response: { url?: string }
    try {
      response = await client.postJson<{ url?: string }>(PROTOCOL_PROFILE.routes.create, body)
    } catch {
      operation.status = 'unknown'
      operation.updatedAt = new Date().toISOString()
      operation.diagnostic = 'Update request had no trustworthy response; it was not retried.'
      await state.writeOperation(operation)
      return {
        ok: false,
        action: 'update' as const,
        status: 'unknown' as const,
        recordId: record.recordId,
        operationId,
        verification: { fetched: false, decrypted: false, contentMatched: false },
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
      await state.writeOperation(operation)
      return {
        ok: false,
        action: 'update' as const,
        status: 'failed' as const,
        recordId: record.recordId,
        operationId,
        verification: { fetched: false, decrypted: false, contentMatched: false },
        warnings: ['The server returned a different URL; the original record was not reported as successfully updated.']
      }
    }

    const verification = { fetched: false, decrypted: false, contentMatched: false }
    try {
      const page = await client.getPage(record.shareUrl)
      if (page.status === 200 && page.html) {
        verification.fetched = true
        const decoded = await decodeSharePage(page.html, key)
        verification.decrypted = true
        verification.contentMatched = decoded.title === preview.title && sha256Hex(decoded.html) === preview.contentHash
      }
    } catch {
      // The submitted state is persisted below without claiming verification.
    }
    const verified = verification.fetched && verification.decrypted && verification.contentMatched
    operation.status = verified ? 'verified' : 'submitted_unverified'
    operation.updatedAt = new Date().toISOString()
    record.status = operation.status
    record.updatedAt = operation.updatedAt
    if (verified) {
      record.sourcePath = preview.sourceRealPath
      record.sourceHash = preview.sourceHash
      record.contentHash = preview.contentHash
      record.title = preview.title
    }
    await state.saveRecord(record)
    await state.writeOperation(operation)
    return {
      ok: verified,
      action: 'update' as const,
      status: operation.status,
      recordId: record.recordId,
      operationId,
      verification,
      ...(request.returnShareUrl === true ? { shareUrl: `${record.shareUrl}#${key}` } : {}),
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
  return withLocalLock(dataDirectory, `record:${request.recordId}`, async () => {
    const state = new StateStore(dataDirectory)
    const record = await state.getRecord(request.recordId)
    assertRecordBinding(record, profile)
    const key = await secrets.readNoteKey(record.noteKeyRef)
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
      await state.writeOperation(operation)
      record.status = 'already_absent'
      record.updatedAt = new Date().toISOString()
      await state.saveRecord(record)
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
    await state.writeOperation(operation)
    const body: DeleteNoteRequest = { filename: record.remoteFilename, filetype: 'html' }
    try {
      await client.postJson<{ success?: boolean }>(PROTOCOL_PROFILE.routes.delete, body)
    } catch {
      operation.status = 'unknown'
      operation.updatedAt = new Date().toISOString()
      operation.diagnostic = 'Delete request had no trustworthy response and was not retried.'
      await state.writeOperation(operation)
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
    await state.saveRecord(record)
    await state.writeOperation(operation)
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
  dataDirectory: string,
  request: ListRequest
): Promise<BaseResult & {
  action: 'list'
  scope: 'local'
  records: Array<{
    recordId: string
    profile: string
    title: string
    sourcePath: string
    shareUrl: string
    status: string
    updatedAt: string
  }>
  pendingOperations: number
}> {
  const state = new StateStore(dataDirectory)
  const records = await state.listRecords(request.profile, request.query)
  const pendingOperations = (await state.listOperations('pending')).length
  return {
    ok: true,
    action: 'list',
    status: 'verified',
    scope: 'local',
    records: records.map((record) => ({
      recordId: record.recordId,
      profile: record.profile,
      title: record.title,
      sourcePath: record.sourcePath,
      shareUrl: record.shareUrl,
      status: record.status,
      updatedAt: record.updatedAt
    })),
    pendingOperations,
    warnings: ['This is the plugin local registry, not a complete remote account inventory.']
  }
}
