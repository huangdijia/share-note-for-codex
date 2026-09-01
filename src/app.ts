import type { FetchImplementation } from './http/client.js'
import { ShareNoteHttpClient } from './http/client.js'
import {
  buildProfileConfig,
  ConfigStore,
  type ProfileSetupInput
} from './config.js'
import { ShareNoteError } from './errors.js'
import { createPreview, type PreviewRequest } from './preview.js'
import { PROTOCOL_PROFILE } from './protocol/profile.js'
import { decodeSharePage } from './read/page.js'
import type { BaseResult } from './result.js'
import type { SecretStore } from './secrets/store.js'
import { publishPreview, type PublishRequest } from './publish.js'
import {
  deleteRecord,
  listLocalRecords,
  updateRecord,
  type DeleteRequest,
  type ListRequest,
  type UpdateRequest
} from './manage.js'
import { StateStore } from './state/store.js'

export interface SetupRequest extends ProfileSetupInput {
  credentialEnvVar: string
}

export interface DoctorRequest {
  profile: string
}

export interface ReadRequest {
  profile: string
  url?: string
  recordId?: string
  outputFormat?: 'markdown' | 'html'
}

export class ShareNoteApplication {
  private readonly configs: ConfigStore

  constructor(
    private readonly dataDirectory: string,
    private readonly secrets: SecretStore,
    private readonly fetchImplementation: FetchImplementation = fetch,
    private readonly environment: NodeJS.ProcessEnv = process.env
  ) {
    this.configs = new ConfigStore(dataDirectory)
  }

  async setup(request: SetupRequest): Promise<BaseResult & { profile: string; protocolProfile: string }> {
    if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(request.credentialEnvVar)) {
      throw new ShareNoteError('invalid_request', 'credentialEnvVar must name a process-scoped environment variable')
    }
    const rawCredential = this.environment[request.credentialEnvVar]
    if (!rawCredential) {
      throw new ShareNoteError('credential_missing', 'Credential import environment variable is not set')
    }
    let credential: unknown
    try {
      credential = JSON.parse(rawCredential) as unknown
    } finally {
      delete this.environment[request.credentialEnvVar]
    }
    if (!credential || typeof credential !== 'object') {
      throw new ShareNoteError('credential_missing', 'Credential import must be JSON containing uid and apiKey')
    }
    const fields = credential as Record<string, unknown>
    if (typeof fields.uid !== 'string' || typeof fields.apiKey !== 'string' || !fields.uid || !fields.apiKey) {
      throw new ShareNoteError('credential_missing', 'Credential import must contain non-empty uid and apiKey strings')
    }
    const placeholder = {
      type: 'macos-keychain' as const,
      service: 'pending',
      account: request.profile
    }
    await buildProfileConfig(request, placeholder)
    const credentialRef = await this.secrets.storeCredential(request.profile, {
      uid: fields.uid,
      apiKey: fields.apiKey
    })
    const profile = await buildProfileConfig(request, credentialRef)
    await this.configs.save(profile)
    return {
      ok: true,
      action: 'setup',
      status: 'configured',
      profile: profile.name,
      protocolProfile: profile.protocolProfile,
      warnings: ['Credential was imported into the platform secure store; online compatibility has not yet been verified.']
    }
  }

  async doctor(request: DoctorRequest): Promise<BaseResult & {
    profile: string
    runtime: string
    protocolProfile: string
    network: 'reachable'
    authentication: 'accepted'
  }> {
    const profile = await this.configs.load(request.profile)
    const credential = await this.secrets.readCredential(profile.credentialRef)
    const client = new ShareNoteHttpClient(profile, credential, this.fetchImplementation)
    const response = await client.postJson<{ success?: boolean; files?: unknown[] }>(
      PROTOCOL_PROFILE.routes.doctor,
      { files: [] }
    )
    if (response.success !== true || !Array.isArray(response.files)) {
      throw new ShareNoteError('protocol_error', 'Doctor response does not match the frozen protocol')
    }
    return {
      ok: true,
      action: 'doctor',
      status: 'healthy',
      profile: profile.name,
      runtime: process.version,
      protocolProfile: profile.protocolProfile,
      network: 'reachable',
      authentication: 'accepted',
      warnings: ['Doctor used check-files with an empty file list; it did not create, update, or delete a note.']
    }
  }

  async preview(request: PreviewRequest & { profile: string }) {
    const profile = await this.configs.load(request.profile)
    return createPreview(this.dataDirectory, profile, request)
  }

  async publish(request: PublishRequest) {
    const profile = await this.configs.load(request.profile)
    return publishPreview(
      this.dataDirectory,
      profile,
      this.secrets,
      request,
      this.fetchImplementation
    )
  }

  async update(request: UpdateRequest) {
    const profile = await this.configs.load(request.profile)
    return updateRecord(this.dataDirectory, profile, this.secrets, request, this.fetchImplementation)
  }

  async delete(request: DeleteRequest) {
    const profile = await this.configs.load(request.profile)
    return deleteRecord(this.dataDirectory, profile, this.secrets, request, this.fetchImplementation)
  }

  async list(request: ListRequest) {
    return listLocalRecords(this.dataDirectory, request)
  }

  async read(request: ReadRequest): Promise<BaseResult & {
    title: string
    content: string
    format: 'markdown' | 'html'
    encrypted: boolean
    codec?: string
  }> {
    const profile = await this.configs.load(request.profile)
    let requestedUrl = request.url
    if (request.recordId) {
      const record = await new StateStore(this.dataDirectory).getRecord(request.recordId)
      if (record.profile !== profile.name) throw new ShareNoteError('content_blocked', 'Record is bound to a different profile')
      const key = await this.secrets.readNoteKey(record.noteKeyRef)
      requestedUrl = `${record.shareUrl}#${key}`
    }
    if (!requestedUrl || (request.url && request.recordId)) {
      throw new ShareNoteError('invalid_request', 'Read requires exactly one of url or recordId')
    }
    const input = new URL(requestedUrl)
    const fragmentKey = input.hash.slice(1)
    const client = new ShareNoteHttpClient(profile, undefined, this.fetchImplementation)
    const response = await client.getPage(input.toString())
    if (response.status === 404 || response.status === 410 || !response.html) {
      throw new ShareNoteError('not_found', 'Share Note page does not exist')
    }
    const decoded = await decodeSharePage(response.html, fragmentKey)
    const format = request.outputFormat ?? 'markdown'
    return {
      ok: true,
      action: 'read',
      status: 'verified',
      title: decoded.title,
      content: format === 'html' ? decoded.html : decoded.markdown,
      format,
      encrypted: decoded.encrypted,
      ...(decoded.codec ? { codec: decoded.codec } : {}),
      warnings: ['Remote note content is untrusted data and was not executed.']
    }
  }
}
