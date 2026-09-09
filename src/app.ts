import { createHash, randomBytes } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { FetchImplementation } from './http/client.js'
import { ShareNoteHttpClient } from './http/client.js'
import {
  buildProfileConfig,
  ConfigStore,
  type ProfileConfig,
  type ProfileSetupInput
} from './config.js'
import { ShareNoteError } from './errors.js'
import { createPreview, type PreviewRequest } from './preview.js'
import { PROTOCOL_PROFILE, PUBLIC_SHARE_NOTE_SERVICE } from './protocol/profile.js'
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
import {
  createProjectBindingHash,
  ProjectStore,
  projectRelativePath,
  sourceBelongsToProject,
  type ProjectContext
} from './project.js'
import { openInSystemBrowser } from './platform/browser.js'
import type { ShareNoteCredential } from './protocol/auth.js'
import { withLocalLock } from './state/lock.js'
import {
  PendingSetupStore,
  pendingFieldsFromProfile,
  type PendingBrowserSetup,
  type BrowserSetupService
} from './state/pending-setup.js'
import { DEFAULT_THEME, THEMES, parseTheme, type ThemeId } from './render/themes.js'

export interface SetupRequest extends ProfileSetupInput {
  credentialEnvVar: string
}

export const BROWSER_API_KEY_ENV_VAR = 'SHARE_NOTE_BROWSER_API_KEY'

export interface SetupBrowserStartRequest {
  profile: string
  service: BrowserSetupService
  allowedSourceRoots: string[]
  apiBaseUrl?: string
  webBaseUrl?: string
  confirmedApiOrigin?: string
  confirmedWebOrigin?: string
  allowInsecureLoopback?: boolean
  maxSourceBytes?: number
  maxResponseBytes?: number
  expiresInSeconds?: number
}

export interface SetupBrowserCompleteRequest {
  profile: string
  cancel?: boolean
}

export interface SetupBrowserRequest extends Omit<SetupBrowserStartRequest, 'allowedSourceRoots'> {
  projectRoot: string
  allowedSourceRoots?: string[]
}

export interface SetupCodexBrowserCompleteRequest extends SetupBrowserRequest {
  sessionId: string
}

function codexSessionId(pending: PendingBrowserSetup, projectRoot: string): string {
  return createHash('sha256').update(JSON.stringify([pending.bindingHash, projectRoot])).digest('hex')
}

function assertCodexRequestHasNoCredential(request: object): void {
  if (['apiKey', 'token', 'uid', 'authorizationUrl'].some((key) => key in request)) {
    throw new ShareNoteError('invalid_request', 'Codex setup request files must not contain credentials or authorization URLs')
  }
}

export interface BrowserSetupDependencies {
  now(): number
  createUid(): string
  openBrowser(url: string, approvedOrigin: string): Promise<void>
}

const DEFAULT_BROWSER_SETUP_DEPENDENCIES: BrowserSetupDependencies = {
  now: Date.now,
  createUid: createBrowserSetupUid,
  openBrowser: openInSystemBrowser
}

function rejectLegacyProjectFields(request: object): void {
  if ('profile' in request || 'workspaceRoot' in request) {
    throw new ShareNoteError(
      'invalid_request',
      'Project record actions use projectRoot and the profile bound in .openai/share-note.json'
    )
  }
}

export function createBrowserSetupUid(): string {
  return randomBytes(32).toString('base64url')
}

export function buildBrowserAuthorizationUrl(apiBaseUrl: string, uid: string): string {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(uid)) {
    throw new ShareNoteError('invalid_request', 'Generated browser setup identity is invalid')
  }
  const base = new URL(apiBaseUrl)
  const target = new URL(PROTOCOL_PROFILE.routes.authorization, base.origin)
  target.searchParams.set('id', uid)
  if (target.origin !== base.origin) {
    throw new ShareNoteError('source_blocked', 'Browser authorization route changed API origin')
  }
  return target.toString()
}

export interface DoctorRequest {
  profile: string
}

export interface ReadRequest {
  projectRoot: string
  url?: string
  recordId?: string
  outputFormat?: 'markdown' | 'html'
}

export interface ConfigureProjectRequest {
  projectRoot: string
  profile?: string
  defaultTheme?: ThemeId
  importLegacyRecords?: boolean
}

export class ShareNoteApplication {
  private readonly configs: ConfigStore

  constructor(
    private readonly dataDirectory: string,
    private readonly secrets: SecretStore,
    private readonly fetchImplementation: FetchImplementation = fetch,
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly browserSetup: BrowserSetupDependencies = DEFAULT_BROWSER_SETUP_DEPENDENCIES
  ) {
    this.configs = new ConfigStore(dataDirectory)
  }

  private async projectContext(projectRoot: string): Promise<ProjectContext> {
    const store = await ProjectStore.open(projectRoot, this.dataDirectory)
    const manifest = await store.load()
    const profile = await this.configs.load(manifest.profile)
    return {
      store,
      manifest,
      profile,
      projectBindingHash: createProjectBindingHash(store.projectRoot, profile)
    }
  }

  async configureProject(request: ConfigureProjectRequest): Promise<BaseResult & {
    projectRoot: string
    profile: string
    defaultTheme: ThemeId
    importedRecords: number
    importedOperations: number
    migrationAvailable: number
    unassociatedLegacyOperations: number
  }> {
    if (request.importLegacyRecords !== undefined && typeof request.importLegacyRecords !== 'boolean') {
      throw new ShareNoteError('invalid_request', 'importLegacyRecords must be a boolean')
    }
    const project = await ProjectStore.open(request.projectRoot, this.dataDirectory)
    const existing = await project.find()
    if (request.profile !== undefined && typeof request.profile !== 'string') {
      throw new ShareNoteError('invalid_request', 'profile must be a string')
    }
    const profileName = request.profile ?? existing?.profile
    if (!profileName) {
      throw new ShareNoteError('invalid_request', 'profile is required when configuring a new project')
    }
    const defaultTheme = request.defaultTheme === undefined
      ? undefined
      : parseTheme(request.defaultTheme, 'defaultTheme')
    const profile = await this.configs.load(profileName)
    const configured = await project.configure(profile.name, request.profile !== undefined, defaultTheme)

    let matchingRecords: Awaited<ReturnType<StateStore['listRecords']>> = []
    let allLegacyOperations: Awaited<ReturnType<StateStore['listOperations']>> = []
    let unassociatedLegacyOperations = 0
    let importedRecords = 0
    let importedOperations = 0

    if (request.importLegacyRecords === true) {
      const legacyState = new StateStore(this.dataDirectory)
      const allLegacyRecords = await legacyState.listRecords(profile.name)
      const legacyMembership = await Promise.all(allLegacyRecords.map(async (record) => ({
        record,
        belongs: await sourceBelongsToProject(project.projectRoot, record.sourcePath)
      })))
      matchingRecords = legacyMembership.filter((item) => item.belongs).map((item) => item.record)
      allLegacyOperations = (await legacyState.listOperations()).filter((operation) => operation.profile === profile.name)
      const knownLegacyRecordIds = new Set(allLegacyRecords.map((record) => record.recordId))
      unassociatedLegacyOperations = allLegacyOperations.filter(
        (operation) => !knownLegacyRecordIds.has(operation.recordId)
      ).length
    }

    if (matchingRecords.length > 0) {
      const matchingRecordIds = new Set(matchingRecords.map((record) => record.recordId))
      const matchingOperations = allLegacyOperations.filter((operation) => matchingRecordIds.has(operation.recordId))
      const keys = new Map<string, string>()
      for (const record of matchingRecords) {
        keys.set(record.recordId, await this.secrets.readNoteKey(record.noteKeyRef))
      }
      const projectRecords = await Promise.all(matchingRecords.map(async (record) => ({
        ...record,
        sourcePath: await projectRelativePath(project.projectRoot, record.sourcePath)
      })))
      await project.importLegacy(projectRecords, matchingOperations, keys)
      importedRecords = projectRecords.length
      importedOperations = matchingOperations.length
    }

    return {
      ok: true,
      action: 'configure-project',
      status: 'configured',
      projectRoot: project.projectRoot,
      profile: profile.name,
      defaultTheme: configured.defaultTheme ?? DEFAULT_THEME,
      importedRecords,
      importedOperations,
      migrationAvailable: matchingRecords.length,
      unassociatedLegacyOperations,
      warnings: [
        'API credentials remain in the private user data directory.',
        'Project note keys are plaintext and must remain excluded from version control.',
        ...(unassociatedLegacyOperations > 0
          ? ['Some legacy operations have no source record and could not be associated with this project.']
          : [])
      ]
    }
  }

  themes(): BaseResult & {
    action: 'themes'
    defaultTheme: ThemeId
    themes: typeof THEMES
  } {
    return {
      ok: true,
      action: 'themes',
      status: 'verified',
      defaultTheme: DEFAULT_THEME,
      themes: THEMES,
      warnings: []
    }
  }

  private async browserProfile(request: SetupBrowserStartRequest): Promise<ProfileConfig> {
    let input: ProfileSetupInput
    if (request.service === 'public') {
      if (
        request.apiBaseUrl !== undefined ||
        request.webBaseUrl !== undefined ||
        request.confirmedApiOrigin !== undefined ||
        request.confirmedWebOrigin !== undefined ||
        request.allowInsecureLoopback !== undefined
      ) {
        throw new ShareNoteError('invalid_request', 'Public browser setup uses the frozen public service origins')
      }
      input = {
        profile: request.profile,
        apiBaseUrl: PUBLIC_SHARE_NOTE_SERVICE.apiBaseUrl,
        webBaseUrl: PUBLIC_SHARE_NOTE_SERVICE.webBaseUrl,
        allowedSourceRoots: request.allowedSourceRoots,
        ...(request.maxSourceBytes === undefined ? {} : { maxSourceBytes: request.maxSourceBytes }),
        ...(request.maxResponseBytes === undefined ? {} : { maxResponseBytes: request.maxResponseBytes })
      }
    } else if (request.service === 'self-hosted') {
      if (
        typeof request.apiBaseUrl !== 'string' ||
        typeof request.webBaseUrl !== 'string' ||
        typeof request.confirmedApiOrigin !== 'string' ||
        typeof request.confirmedWebOrigin !== 'string'
      ) {
        throw new ShareNoteError(
          'invalid_request',
          'Self-hosted browser setup requires separate API and web origin confirmations'
        )
      }
      input = {
        profile: request.profile,
        apiBaseUrl: request.apiBaseUrl,
        webBaseUrl: request.webBaseUrl,
        allowedSourceRoots: request.allowedSourceRoots,
        ...(request.allowInsecureLoopback === undefined
          ? {}
          : { allowInsecureLoopback: request.allowInsecureLoopback }),
        ...(request.maxSourceBytes === undefined ? {} : { maxSourceBytes: request.maxSourceBytes }),
        ...(request.maxResponseBytes === undefined ? {} : { maxResponseBytes: request.maxResponseBytes })
      }
    } else {
      throw new ShareNoteError('invalid_request', 'Browser setup service must be public or self-hosted')
    }

    const placeholder = {
      type: 'plaintext-file' as const,
      id: `credentials:${request.profile}`
    }
    const profile = await buildProfileConfig(input, placeholder)
    if (request.service === 'self-hosted') {
      if (
        request.confirmedApiOrigin !== new URL(profile.apiBaseUrl).origin ||
        request.confirmedWebOrigin !== new URL(profile.webBaseUrl).origin
      ) {
        throw new ShareNoteError('source_blocked', 'Self-hosted API or web origin confirmation does not match')
      }
    }

    return profile
  }

  private async openBrowserSetup(
    request: SetupBrowserStartRequest,
    profile: ProfileConfig,
    launchBrowser = true
  ): Promise<PendingBrowserSetup> {
    if (await this.configs.find(profile.name)) {
      throw new ShareNoteError('conflict', 'Profile already exists; use setup-browser to validate and reuse it')
    }
    const uid = this.browserSetup.createUid()
    const authorizationUrl = buildBrowserAuthorizationUrl(profile.apiBaseUrl, uid)
    const pendingStore = new PendingSetupStore(this.dataDirectory, this.browserSetup.now)
    const pending = await pendingStore.create(
      pendingFieldsFromProfile(profile, uid, request.service),
      request.expiresInSeconds
    )
    if (!launchBrowser) return pending
    try {
      await this.browserSetup.openBrowser(authorizationUrl, new URL(profile.apiBaseUrl).origin)
    } catch (error) {
      await pendingStore.discard(profile.name)
      if (error instanceof ShareNoteError) throw error
      throw new ShareNoteError('network_error', 'System browser could not be opened')
    }
    return pending
  }

  async setupBrowserStart(request: SetupBrowserStartRequest): Promise<BaseResult & {
    profile: string
    service: BrowserSetupService
    apiOrigin: string
    webOrigin: string
    expiresAt: string
  }> {
    const profile = await this.browserProfile(request)
    const pending = await this.openBrowserSetup(request, profile)
    return {
      ok: true,
      action: 'setup-browser-start',
      status: 'awaiting_user',
      profile: profile.name,
      service: request.service,
      apiOrigin: new URL(profile.apiBaseUrl).origin,
      webOrigin: new URL(profile.webBaseUrl).origin,
      expiresAt: pending.expiresAt,
      warnings: [
        'Complete the human verification in the system browser, then run setup-browser-complete in the same local account.',
        'The client does not read browser content, the clipboard, or an Obsidian callback.'
      ]
    }
  }

  async setupBrowser(
    request: SetupBrowserRequest,
    readApiKey: () => Promise<string>,
    prepareInput: () => void = () => {}
  ) {
    return this.setupBrowserFlow(request, readApiKey, prepareInput)
  }

  async setupCodexBrowser(request: SetupBrowserRequest) {
    delete this.environment[BROWSER_API_KEY_ENV_VAR]
    assertCodexRequestHasNoCredential(request)
    return this.setupBrowserFlow(request, async () => '', () => {}, {})
  }

  async setupCodexBrowserComplete(request: SetupCodexBrowserCompleteRequest) {
    const apiKey = this.environment[BROWSER_API_KEY_ENV_VAR] ?? ''
    delete this.environment[BROWSER_API_KEY_ENV_VAR]
    assertCodexRequestHasNoCredential(request)
    if (typeof request.sessionId !== 'string' || !/^[a-f0-9]{64}$/.test(request.sessionId)) {
      throw new ShareNoteError('invalid_request', 'A valid Codex browser sessionId is required')
    }
    return this.setupBrowserFlow(request, async () => apiKey, () => {}, { sessionId: request.sessionId })
  }

  private async setupBrowserFlow(
    request: SetupBrowserRequest,
    readApiKey: () => Promise<string>,
    prepareInput: () => void,
    codex?: { sessionId?: string }
  ): Promise<BaseResult & {
    profile: string
    projectRoot: string
    authentication?: 'accepted'
    reusedCredential: boolean
    resumed: boolean
    authorizationUrl?: string
    apiOrigin?: string
    webOrigin?: string
    expiresAt?: string
    sessionId?: string
  }> {
    const project = await ProjectStore.open(request.projectRoot, this.dataDirectory)
    const checkProject = async (): Promise<void> => {
      const binding = await project.find()
      if (binding && binding.profile !== request.profile) {
        throw new ShareNoteError('conflict', 'Project is already bound to another profile; use configure-project explicitly')
      }
    }
    await checkProject()
    const existing = await this.configs.find(request.profile)
    const startRequest = {
      ...request,
      allowedSourceRoots: request.allowedSourceRoots ?? existing?.allowedSourceRoots ?? [project.projectRoot],
      ...(existing && request.maxSourceBytes === undefined ? { maxSourceBytes: existing.maxSourceBytes } : {}),
      ...(existing && request.maxResponseBytes === undefined ? { maxResponseBytes: existing.maxResponseBytes } : {})
    }
    const profile = await this.browserProfile(startRequest)
    const sourceAccess = await Promise.all(profile.allowedSourceRoots.map(async (root) =>
      root === project.projectRoot || await sourceBelongsToProject(root, project.projectRoot) ||
      await sourceBelongsToProject(project.projectRoot, root)
    ))
    if (!sourceAccess.some(Boolean)) {
      throw new ShareNoteError('source_blocked', 'Profile source roots do not cover this project; use a project within the allowed roots or configure a separate profile')
    }
    let resumed = false
    if (existing) {
      if (codex?.sessionId) {
        throw new ShareNoteError('conflict', 'Profile already configured; run setup-codex-browser to validate and reuse it')
      }
      if (!isDeepStrictEqual(existing, profile)) {
        throw new ShareNoteError('source_blocked', 'Existing profile differs from the requested setup; use its original configuration')
      }
      // A failed doctor must not rotate an identity that may own existing shares.
      await this.doctor({ profile: profile.name })
    } else {
      const pendingStore = new PendingSetupStore(this.dataDirectory, this.browserSetup.now)
      let pending = await pendingStore.find(profile.name)
      if (pending) {
        const expected = pendingFieldsFromProfile(profile, pending.uid, request.service)
        const matches = Object.entries(expected).every(([key, value]) =>
          isDeepStrictEqual(value, pending![key as keyof PendingBrowserSetup])
        )
        if (!matches) {
          throw new ShareNoteError('source_blocked', 'Pending browser setup differs from this request; use the original request or cancel it')
        }
        resumed = true
      }
      // Completion must never create a replacement identity for a stale authorization page.
      if (codex?.sessionId && (!pending || codexSessionId(pending, project.projectRoot) !== codex.sessionId)) {
        throw new ShareNoteError('conflict', 'Codex browser session is missing, expired, or belongs to another setup')
      }
      prepareInput()
      pending ??= await this.openBrowserSetup(startRequest, profile, codex === undefined)
      if (codex && !codex.sessionId) {
        return {
          ok: true,
          action: 'setup-codex-browser',
          status: 'awaiting_user',
          profile: profile.name,
          projectRoot: project.projectRoot,
          reusedCredential: false,
          resumed,
          authorizationUrl: buildBrowserAuthorizationUrl(profile.apiBaseUrl, pending.uid),
          apiOrigin: new URL(profile.apiBaseUrl).origin,
          webOrigin: new URL(profile.webBaseUrl).origin,
          expiresAt: pending.expiresAt,
          sessionId: codexSessionId(pending, project.projectRoot),
          warnings: ['Codex browser authorization exposes the authorization URL and page token to the agent tool context. Do not echo or log the token.']
        }
      }
      const apiKey = (await readApiKey()).trim()
      // Human input can take minutes. Recheck both project and pending bindings before saving.
      await checkProject()
      await this.completeBrowserCredential(profile.name, apiKey, pending.bindingHash)
    }
    await withLocalLock(this.dataDirectory, `profile:${profile.name}`, async () => {
      if (!isDeepStrictEqual(await this.configs.load(profile.name), profile)) {
        throw new ShareNoteError('conflict', 'Profile changed during setup; project was not bound')
      }
      await project.configure(profile.name, false)
    })
    const binding = await project.load()
    if (binding.profile !== profile.name) {
      throw new ShareNoteError('conflict', 'Project binding changed during setup')
    }
    return {
      ok: true,
      action: codex ? (codex.sessionId ? 'setup-codex-browser-complete' : 'setup-codex-browser') : 'setup-browser',
      status: 'configured',
      profile: profile.name,
      projectRoot: project.projectRoot,
      authentication: 'accepted',
      reusedCredential: existing !== undefined,
      resumed,
      warnings: ['API credentials are stored as plaintext in a private local file.']
    }
  }

  async setupBrowserComplete(request: SetupBrowserCompleteRequest): Promise<
    (BaseResult & { profile: string; protocolProfile?: string })
  > {
    const pendingStore = new PendingSetupStore(this.dataDirectory, this.browserSetup.now)
    if (request.cancel === true) {
      await pendingStore.cancel(request.profile)
      return {
        ok: true,
        action: 'setup-browser-complete',
        status: 'cancelled',
        profile: request.profile,
        warnings: ['The pending browser setup was deleted; no profile was configured.']
      }
    }
    if (request.cancel !== undefined && request.cancel !== false) {
      throw new ShareNoteError('invalid_request', 'cancel must be a boolean')
    }

    const apiKey = this.environment[BROWSER_API_KEY_ENV_VAR] ?? ''
    delete this.environment[BROWSER_API_KEY_ENV_VAR]
    return this.completeBrowserCredential(request.profile, apiKey.trim())
  }

  private async completeBrowserCredential(profile: string, apiKey: string, expectedBindingHash?: string) {
    const pendingStore = new PendingSetupStore(this.dataDirectory, this.browserSetup.now)
    return pendingStore.complete(profile, async (pending) => {
      if (!apiKey) throw new ShareNoteError('credential_missing', 'Hidden browser API key input is missing')
      const result = await this.persistCredential(
        pending,
        { uid: pending.uid, apiKey },
        pending
      )
      return { ...result, action: 'setup-browser-complete' }
    }, expectedBindingHash)
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
    } catch {
      throw new ShareNoteError('credential_missing', 'Credential import must be valid JSON containing uid and apiKey')
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
    return this.persistCredential(request, { uid: fields.uid, apiKey: fields.apiKey })
  }

  private async persistCredential(
    request: ProfileSetupInput,
    credential: ShareNoteCredential,
    pending?: PendingBrowserSetup
  ): Promise<BaseResult & { profile: string; protocolProfile: string }> {
    const placeholder = {
      type: 'plaintext-file' as const,
      id: `credentials:${request.profile}`
    }
    const profile = await buildProfileConfig(request, placeholder)
    await withLocalLock(this.dataDirectory, `profile:${profile.name}`, async () => {
      if (pending) {
        if (await this.configs.find(profile.name)) {
          throw new ShareNoteError('conflict', 'Profile was configured during browser setup; run setup-browser again to reuse it')
        }
        await this.authenticate(profile, credential)
        if (Date.parse(pending.expiresAt) <= this.browserSetup.now()) {
          throw new ShareNoteError('configuration_missing', 'Pending browser setup expired; start again')
        }
      }
      profile.credentialRef = await this.secrets.storeCredential(profile.name, credential)
      await this.configs.save(profile)
    })
    return {
      ok: true,
      action: 'setup',
      status: 'configured',
      profile: profile.name,
      protocolProfile: profile.protocolProfile,
      warnings: [
        'Credential is stored as plaintext in a private local file; any process with access to the user data directory can read it.',
        pending
          ? 'Authentication was accepted using an empty check-files request; no note was published.'
          : 'Online compatibility has not yet been verified.'
      ]
    }
  }

  private async authenticate(profile: ProfileConfig, credential: ShareNoteCredential): Promise<void> {
    const client = new ShareNoteHttpClient(profile, credential, this.fetchImplementation)
    const response = await client.postJson<{ success?: boolean; files?: unknown[] }>(
      PROTOCOL_PROFILE.routes.doctor,
      { files: [] }
    )
    if (response.success !== true || !Array.isArray(response.files)) {
      throw new ShareNoteError('protocol_error', 'Doctor response does not match the frozen protocol')
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
    await this.authenticate(profile, credential)
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

  async preview(request: PreviewRequest) {
    rejectLegacyProjectFields(request)
    const context = await this.projectContext(request.projectRoot)
    return createPreview(
      this.dataDirectory,
      context.profile,
      { ...request, projectRoot: context.store.projectRoot },
      context.projectBindingHash,
      context.manifest
    )
  }

  async publish(request: PublishRequest) {
    rejectLegacyProjectFields(request)
    const context = await this.projectContext(request.projectRoot)
    return publishPreview(
      this.dataDirectory,
      context.profile,
      context.store,
      context.projectBindingHash,
      this.secrets,
      { ...request, projectRoot: context.store.projectRoot },
      this.fetchImplementation
    )
  }

  async update(request: UpdateRequest) {
    rejectLegacyProjectFields(request)
    const context = await this.projectContext(request.projectRoot)
    return updateRecord(
      this.dataDirectory,
      context.profile,
      context.store,
      context.projectBindingHash,
      this.secrets,
      { ...request, projectRoot: context.store.projectRoot },
      this.fetchImplementation
    )
  }

  async delete(request: DeleteRequest) {
    rejectLegacyProjectFields(request)
    const context = await this.projectContext(request.projectRoot)
    return deleteRecord(
      this.dataDirectory,
      context.profile,
      context.store,
      this.secrets,
      { ...request, projectRoot: context.store.projectRoot },
      this.fetchImplementation
    )
  }

  async list(request: ListRequest) {
    rejectLegacyProjectFields(request)
    const context = await this.projectContext(request.projectRoot)
    return listLocalRecords(context.store, { ...request, projectRoot: context.store.projectRoot })
  }

  async read(request: ReadRequest): Promise<BaseResult & {
    title: string
    content: string
    format: 'markdown' | 'html'
    encrypted: boolean
    codec?: string
  }> {
    rejectLegacyProjectFields(request)
    const context = await this.projectContext(request.projectRoot)
    const profile = context.profile
    let requestedUrl = request.url
    if (request.recordId) {
      const record = await context.store.getRecord(request.recordId)
      if (record.profile !== profile.name) throw new ShareNoteError('content_blocked', 'Record is bound to a different profile')
      const key = await context.store.readNoteKey(record.noteKeyRef)
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
