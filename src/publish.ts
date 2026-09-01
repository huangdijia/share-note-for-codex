import { createHash, randomUUID } from 'node:crypto'
import type { ProfileConfig } from './config.js'
import { encryptModern } from './crypto/codecs.js'
import { ShareNoteError } from './errors.js'
import { ShareNoteHttpClient, type FetchImplementation } from './http/client.js'
import { loadPreview } from './preview.js'
import { PROTOCOL_PROFILE, type CreateNoteRequest, type NoteTemplate } from './protocol/profile.js'
import { decodeSharePage } from './read/page.js'
import type { BaseResult } from './result.js'
import type { SecretStore } from './secrets/store.js'
import { readSafeSource } from './source.js'
import { StateStore, type OperationRecord, type ShareRecord } from './state/store.js'

export interface PublishAuthorization {
  granted: true
  action: 'publish'
  profile: string
  contentHash: string
  encryption: 'encrypted'
}

export interface PublishRequest {
  profile: string
  previewId: string
  workspaceRoot: string
  expectedContentHash: string
  authorization: PublishAuthorization
  returnShareUrl?: boolean
}

export interface PublishResult extends BaseResult {
  action: 'publish'
  recordId: string
  operationId: string
  encrypted: true
  verification: {
    fetched: boolean
    decrypted: boolean
    contentMatched: boolean
  }
  shareUrl?: string
}

export function sha1Hex(value: string): string {
  return createHash('sha1').update(value, 'utf8').digest('hex')
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function validateRemoteUrl(profile: ProfileConfig, value: string): { baseUrl: string; filename: string } {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ShareNoteError('protocol_error', 'Create response contains an invalid share URL')
  }
  if (url.origin !== new URL(profile.webBaseUrl).origin || url.username || url.password || url.search || url.hash) {
    throw new ShareNoteError('protocol_error', 'Create response share URL is outside the approved web origin')
  }
  const filename = url.pathname.split('/').filter(Boolean).at(-1) ?? ''
  if (!/^[a-z0-9]+$/.test(filename)) {
    throw new ShareNoteError('protocol_error', 'Create response contains an invalid remote filename')
  }
  return { baseUrl: url.toString(), filename }
}

function authorized(request: PublishRequest): void {
  const authorization = request.authorization
  if (
    authorization?.granted !== true ||
    authorization.action !== 'publish' ||
    authorization.profile !== request.profile ||
    authorization.contentHash !== request.expectedContentHash ||
    authorization.encryption !== 'encrypted'
  ) {
    throw new ShareNoteError('content_blocked', 'Publish authorization is missing or does not match the preview')
  }
}

export async function publishPreview(
  dataDirectory: string,
  profile: ProfileConfig,
  secrets: SecretStore,
  request: PublishRequest,
  fetchImplementation: FetchImplementation = fetch
): Promise<PublishResult> {
  authorized(request)
  const preview = await loadPreview(dataDirectory, request.previewId)
  if (preview.profile !== profile.name || preview.contentHash !== request.expectedContentHash) {
    throw new ShareNoteError('content_blocked', 'Preview does not match the requested profile or content hash')
  }
  if (!preview.publishable) {
    throw new ShareNoteError('content_blocked', 'Preview contains blocked resources or sensitive content')
  }
  const currentSource = await readSafeSource(
    preview.sourceRealPath,
    request.workspaceRoot,
    profile.allowedSourceRoots,
    profile.maxSourceBytes
  )
  if (currentSource.sourceHash !== preview.sourceHash) {
    throw new ShareNoteError('content_blocked', 'Source changed after preview; create a new preview before publishing')
  }

  const state = new StateStore(dataDirectory)
  const recordId = `note-${randomUUID()}`
  const operationId = `op-${randomUUID()}`
  const encrypted = await encryptModern(JSON.stringify({
    content: preview.bodyHtml,
    basename: preview.title
  }))
  const noteKeyRef = await secrets.storeNoteKey(profile.name, recordId, encrypted.key)
  const now = new Date().toISOString()
  const operation: OperationRecord = {
    schemaVersion: 1,
    operationId,
    action: 'publish',
    recordId,
    profile: profile.name,
    target: new URL(profile.webBaseUrl).origin,
    status: 'pending',
    contentHash: preview.contentHash,
    noteKeyRef,
    createdAt: now,
    updatedAt: now
  }
  await state.writeOperation(operation)

  const template: NoteTemplate = {
    width: '',
    elements: [],
    encrypted: true,
    content: JSON.stringify(encrypted.payload),
    mathJax: false
  }
  const body: CreateNoteRequest = {
    filetype: 'html',
    hash: sha1Hex(template.content),
    template
  }
  const credential = await secrets.readCredential(profile.credentialRef)
  const client = new ShareNoteHttpClient(profile, credential, fetchImplementation)
  let response: { url?: string }
  try {
    response = await client.postJson<{ url?: string }>(PROTOCOL_PROFILE.routes.create, body)
  } catch (error) {
    operation.status = 'unknown'
    operation.updatedAt = new Date().toISOString()
    operation.diagnostic = 'Create request had no trustworthy response; it was not retried.'
    await state.writeOperation(operation)
    return {
      ok: false,
      action: 'publish',
      status: 'unknown',
      recordId,
      operationId,
      encrypted: true,
      verification: { fetched: false, decrypted: false, contentMatched: false },
      warnings: ['The service may have accepted the create request. The client did not retry and cannot provide a verified link.']
    }
  }
  if (typeof response.url !== 'string') {
    operation.status = 'failed'
    operation.updatedAt = new Date().toISOString()
    operation.diagnostic = 'Create response did not contain a URL.'
    await state.writeOperation(operation)
    throw new ShareNoteError('protocol_error', 'Create response did not contain a share URL')
  }
  const remote = validateRemoteUrl(profile, response.url)
  const fullShareUrl = `${remote.baseUrl}#${encrypted.key}`
  operation.remoteUrl = remote.baseUrl

  const record: ShareRecord = {
    schemaVersion: 1,
    recordId,
    profile: profile.name,
    apiOrigin: new URL(profile.apiBaseUrl).origin,
    webOrigin: new URL(profile.webBaseUrl).origin,
    identityRef: `${profile.credentialRef.service}:${profile.credentialRef.account}`,
    sourcePath: preview.sourceRealPath,
    remoteFilename: remote.filename,
    shareUrl: remote.baseUrl,
    noteKeyRef,
    sourceHash: preview.sourceHash,
    contentHash: preview.contentHash,
    title: preview.title,
    encrypted: true,
    status: 'submitted_unverified',
    createdAt: now,
    updatedAt: new Date().toISOString()
  }
  let verification = { fetched: false, decrypted: false, contentMatched: false }
  const warnings: string[] = []
  try {
    const page = await client.getPage(remote.baseUrl)
    if (page.status === 200 && page.html) {
      verification.fetched = true
      const decoded = await decodeSharePage(page.html, encrypted.key)
      verification.decrypted = true
      verification.contentMatched = decoded.title === preview.title && sha256Hex(decoded.html) === preview.contentHash
    }
  } catch {
    warnings.push('Create was accepted, but read-back could not be completed.')
  }
  const verified = verification.fetched && verification.decrypted && verification.contentMatched
  record.status = verified ? 'verified' : 'submitted_unverified'
  operation.status = record.status
  operation.updatedAt = new Date().toISOString()
  if (!verified) {
    warnings.push('The returned page did not pass title and sanitized-content hash verification.')
  }
  await state.saveRecord(record)
  await state.writeOperation(operation)
  return {
    ok: verified,
    action: 'publish',
    status: record.status,
    recordId,
    operationId,
    encrypted: true,
    verification,
    ...(request.returnShareUrl === true ? { shareUrl: fullShareUrl } : {}),
    warnings
  }
}
