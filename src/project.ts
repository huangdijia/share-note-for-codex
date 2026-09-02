import { createHash, randomUUID } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat
} from 'node:fs/promises'
import path from 'node:path'
import { credentialIdentityReference, type ProfileConfig, validateProfileName } from './config.js'
import { ShareNoteError } from './errors.js'
import type { OperationRecord, ShareRecord } from './state/store.js'
import { withLocalLock } from './state/lock.js'

const RECORD_ID_PATTERN = /^note-[0-9a-f-]{36}$/
const OPERATION_ID_PATTERN = /^op-[0-9a-f-]{36}$/
const NOTE_KEY_REFERENCE_PATTERN = /^project-file:notes:note-[0-9a-f-]{36}$/

export interface ProjectManifest {
  schemaVersion: 1
  profile: string
  records: ShareRecord[]
  operations: OperationRecord[]
}

interface ProjectKeyFile {
  schemaVersion: 1
  keys: Record<string, string>
}

export interface ProjectContext {
  store: ProjectStore
  manifest: ProjectManifest
  profile: ProfileConfig
  projectBindingHash: string
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function assertSafeRelativePath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.includes('\\') || path.posix.isAbsolute(value)) {
    throw new ShareNoteError('configuration_missing', 'Project record source path is invalid')
  }
  const normalized = path.posix.normalize(value)
  if (normalized !== value || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new ShareNoteError('configuration_missing', 'Project record source path escapes the project')
  }
  return value
}

function assertRecord(value: unknown, profile: string): ShareRecord {
  if (!value || typeof value !== 'object') {
    throw new ShareNoteError('configuration_missing', 'Project record is invalid')
  }
  const record = value as Partial<ShareRecord>
  if (
    record.schemaVersion !== 1 ||
    typeof record.recordId !== 'string' ||
    !RECORD_ID_PATTERN.test(record.recordId) ||
    record.profile !== profile ||
    typeof record.apiOrigin !== 'string' ||
    typeof record.webOrigin !== 'string' ||
    typeof record.identityRef !== 'string' ||
    typeof record.remoteFilename !== 'string' ||
    typeof record.shareUrl !== 'string' ||
    typeof record.noteKeyRef !== 'string' ||
    !NOTE_KEY_REFERENCE_PATTERN.test(record.noteKeyRef) ||
    typeof record.sourceHash !== 'string' ||
    typeof record.contentHash !== 'string' ||
    typeof record.title !== 'string' ||
    record.encrypted !== true ||
    typeof record.status !== 'string' ||
    typeof record.createdAt !== 'string' ||
    typeof record.updatedAt !== 'string'
  ) {
    throw new ShareNoteError('configuration_missing', 'Project record schema is invalid')
  }
  assertSafeRelativePath(record.sourcePath)
  let shareUrl: URL
  try {
    shareUrl = new URL(record.shareUrl)
  } catch {
    throw new ShareNoteError('configuration_missing', 'Project record share URL is invalid')
  }
  if (shareUrl.hash || shareUrl.username || shareUrl.password) {
    throw new ShareNoteError('configuration_missing', 'Project record cannot contain a credential or URL fragment')
  }
  return record as ShareRecord
}

function assertOperation(value: unknown, profile: string): OperationRecord {
  if (!value || typeof value !== 'object') {
    throw new ShareNoteError('configuration_missing', 'Project operation is invalid')
  }
  const operation = value as Partial<OperationRecord>
  if (
    operation.schemaVersion !== 1 ||
    typeof operation.operationId !== 'string' ||
    !OPERATION_ID_PATTERN.test(operation.operationId) ||
    (operation.action !== 'publish' && operation.action !== 'update' && operation.action !== 'delete') ||
    typeof operation.recordId !== 'string' ||
    !RECORD_ID_PATTERN.test(operation.recordId) ||
    operation.profile !== profile ||
    typeof operation.target !== 'string' ||
    typeof operation.status !== 'string' ||
    typeof operation.createdAt !== 'string' ||
    typeof operation.updatedAt !== 'string'
  ) {
    throw new ShareNoteError('configuration_missing', 'Project operation schema is invalid')
  }
  if (operation.noteKeyRef !== undefined && !NOTE_KEY_REFERENCE_PATTERN.test(operation.noteKeyRef)) {
    throw new ShareNoteError('configuration_missing', 'Project operation note key reference is invalid')
  }
  return operation as OperationRecord
}

function assertManifest(value: unknown): ProjectManifest {
  if (!value || typeof value !== 'object') {
    throw new ShareNoteError('configuration_missing', 'Project Share Note configuration is invalid')
  }
  const manifest = value as Partial<ProjectManifest>
  if (manifest.schemaVersion !== 1 || typeof manifest.profile !== 'string') {
    throw new ShareNoteError('configuration_missing', 'Project Share Note configuration schema is unsupported')
  }
  const profile = validateProfileName(manifest.profile)
  if (!Array.isArray(manifest.records) || !Array.isArray(manifest.operations)) {
    throw new ShareNoteError('configuration_missing', 'Project Share Note records or operations are invalid')
  }
  const records = manifest.records.map((record) => assertRecord(record, profile))
  const operations = manifest.operations.map((operation) => assertOperation(operation, profile))
  if (new Set(records.map((record) => record.recordId)).size !== records.length) {
    throw new ShareNoteError('configuration_missing', 'Project Share Note record IDs are not unique')
  }
  if (new Set(operations.map((operation) => operation.operationId)).size !== operations.length) {
    throw new ShareNoteError('configuration_missing', 'Project Share Note operation IDs are not unique')
  }
  return { schemaVersion: 1, profile, records, operations }
}

function assertKeyFile(value: unknown): ProjectKeyFile {
  if (!value || typeof value !== 'object') {
    throw new ShareNoteError('credential_missing', 'Project note key file is invalid')
  }
  const file = value as Partial<ProjectKeyFile>
  if (file.schemaVersion !== 1 || !file.keys || typeof file.keys !== 'object' || Array.isArray(file.keys)) {
    throw new ShareNoteError('credential_missing', 'Project note key file schema is invalid')
  }
  const keys: Record<string, string> = {}
  for (const [recordId, key] of Object.entries(file.keys)) {
    if (!RECORD_ID_PATTERN.test(recordId) || typeof key !== 'string' || !key) {
      throw new ShareNoteError('credential_missing', 'Project note key entry is invalid')
    }
    keys[recordId] = key
  }
  return { schemaVersion: 1, keys }
}

async function assertRegularFile(filePath: string, missingAllowed: boolean): Promise<boolean> {
  const info = await lstat(filePath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  })
  if (!info) {
    if (missingAllowed) return false
    throw new ShareNoteError('configuration_missing', `Required project file is missing: ${path.basename(filePath)}`)
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new ShareNoteError('configuration_missing', `Project file must be a regular non-symbolic file: ${path.basename(filePath)}`)
  }
  return true
}

async function writeAtomic(filePath: string, contents: string, mode: number): Promise<void> {
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`)
  const handle = await open(temporaryPath, 'wx', mode)
  try {
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporaryPath, filePath)
    if (process.platform !== 'win32') await chmod(filePath, mode)
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }
}

async function writeJson(filePath: string, value: unknown, mode: number): Promise<void> {
  await writeAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, mode)
}

export function projectNoteKeyReference(recordId: string): string {
  if (!RECORD_ID_PATTERN.test(recordId)) throw new ShareNoteError('invalid_request', 'Record identifier is invalid')
  return `project-file:notes:${recordId}`
}

export async function projectRelativePath(projectRoot: string, target: string): Promise<string> {
  const resolvedTarget = await realpath(target).catch(() => path.resolve(target))
  const relative = path.relative(projectRoot, resolvedTarget)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ShareNoteError('source_blocked', 'Source resolves outside the configured project root')
  }
  return assertSafeRelativePath(relative.split(path.sep).join('/'))
}

export function createProjectBindingHash(projectRoot: string, profile: ProfileConfig): string {
  return createHash('sha256').update(JSON.stringify({
    schemaVersion: 1,
    projectRoot,
    profile: profile.name,
    apiOrigin: new URL(profile.apiBaseUrl).origin,
    webOrigin: new URL(profile.webBaseUrl).origin,
    identityRef: credentialIdentityReference(profile.credentialRef)
  })).digest('hex')
}

export class ProjectStore {
  private constructor(
    readonly projectRoot: string,
    private readonly dataDirectory: string
  ) {}

  static async open(projectRoot: string, dataDirectory: string): Promise<ProjectStore> {
    if (typeof projectRoot !== 'string' || !projectRoot || !path.isAbsolute(projectRoot)) {
      throw new ShareNoteError('invalid_request', 'projectRoot must be an absolute project directory')
    }
    const resolved = await realpath(projectRoot).catch(() => undefined)
    if (!resolved || !(await stat(resolved)).isDirectory()) {
      throw new ShareNoteError('invalid_request', 'projectRoot does not exist or is not a directory')
    }
    return new ProjectStore(resolved, dataDirectory)
  }

  private get openAiDirectory(): string {
    return path.join(this.projectRoot, '.openai')
  }

  get manifestPath(): string {
    return path.join(this.openAiDirectory, 'share-note.json')
  }

  get keysPath(): string {
    return path.join(this.openAiDirectory, 'share-note.keys.json')
  }

  private async ensureProjectDirectory(): Promise<void> {
    const info = await lstat(this.openAiDirectory).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    })
    if (info && (info.isSymbolicLink() || !info.isDirectory())) {
      throw new ShareNoteError('configuration_missing', '.openai must be a regular directory inside the project')
    }
    if (!info) await mkdir(this.openAiDirectory, { mode: 0o755 })
  }

  private async ensureKeyIgnore(): Promise<void> {
    await this.ensureProjectDirectory()
    const ignorePath = path.join(this.openAiDirectory, '.gitignore')
    const exists = await assertRegularFile(ignorePath, true)
    const contents = exists ? await readFile(ignorePath, 'utf8') : ''
    const lines = contents.split(/\r?\n/)
    if (lines.includes('share-note.keys.json')) return
    const separator = contents.length > 0 && !contents.endsWith('\n') ? '\n' : ''
    await writeAtomic(ignorePath, `${contents}${separator}share-note.keys.json\n`, 0o644)
  }

  async configure(profile: string): Promise<ProjectManifest> {
    const safeProfile = validateProfileName(profile)
    await this.ensureKeyIgnore()
    return withLocalLock(this.dataDirectory, `project:${this.projectRoot}:manifest`, async () => {
      const exists = await assertRegularFile(this.manifestPath, true)
      if (!exists) {
        const manifest: ProjectManifest = { schemaVersion: 1, profile: safeProfile, records: [], operations: [] }
        await writeJson(this.manifestPath, manifest, 0o644)
        return manifest
      }
      const manifest = await this.load()
      if (manifest.profile === safeProfile) return manifest
      if (manifest.records.length > 0 || manifest.operations.length > 0) {
        throw new ShareNoteError('conflict', 'Project profile cannot change after records or operations exist')
      }
      const updated: ProjectManifest = { ...manifest, profile: safeProfile }
      await writeJson(this.manifestPath, updated, 0o644)
      return updated
    })
  }

  async load(): Promise<ProjectManifest> {
    const openAiInfo = await lstat(this.openAiDirectory).catch(() => undefined)
    if (!openAiInfo || openAiInfo.isSymbolicLink() || !openAiInfo.isDirectory()) {
      throw new ShareNoteError('configuration_missing', 'Project Share Note configuration is missing or unsafe')
    }
    await assertRegularFile(this.manifestPath, false)
    const contents = await readFile(this.manifestPath, 'utf8')
    if (Buffer.byteLength(contents) > 4 * 1024 * 1024) {
      throw new ShareNoteError('configuration_missing', 'Project Share Note configuration is too large')
    }
    try {
      return assertManifest(JSON.parse(contents) as unknown)
    } catch (error) {
      if (error instanceof ShareNoteError) throw error
      throw new ShareNoteError('configuration_missing', 'Project Share Note configuration is not valid JSON')
    }
  }

  private async mutateManifest(operation: (manifest: ProjectManifest) => void): Promise<ProjectManifest> {
    return withLocalLock(this.dataDirectory, `project:${this.projectRoot}:manifest`, async () => {
      const manifest = await this.load()
      operation(manifest)
      await writeJson(this.manifestPath, manifest, 0o644)
      return manifest
    })
  }

  async saveRecord(record: ShareRecord): Promise<void> {
    await this.mutateManifest((manifest) => {
      assertRecord(record, manifest.profile)
      const index = manifest.records.findIndex((item) => item.recordId === record.recordId)
      if (index >= 0) manifest.records[index] = record
      else manifest.records.push(record)
    })
  }

  async getRecord(recordId: string): Promise<ShareRecord> {
    if (!RECORD_ID_PATTERN.test(recordId)) throw new ShareNoteError('invalid_request', 'Invalid record ID')
    const record = (await this.load()).records.find((item) => item.recordId === recordId)
    if (!record) throw new ShareNoteError('not_found', `Project record ${recordId} was not found`)
    return record
  }

  async listRecords(query?: string): Promise<ShareRecord[]> {
    const normalizedQuery = query?.toLocaleLowerCase()
    return (await this.load()).records.filter((record) => {
      if (!normalizedQuery) return true
      return `${record.recordId} ${record.title} ${record.sourcePath}`.toLocaleLowerCase().includes(normalizedQuery)
    })
  }

  async writeOperation(operation: OperationRecord): Promise<void> {
    await this.mutateManifest((manifest) => {
      assertOperation(operation, manifest.profile)
      const index = manifest.operations.findIndex((item) => item.operationId === operation.operationId)
      if (index >= 0) manifest.operations[index] = operation
      else manifest.operations.push(operation)
    })
  }

  async listOperations(status?: OperationRecord['status']): Promise<OperationRecord[]> {
    return (await this.load()).operations.filter((operation) => !status || operation.status === status)
  }

  private async loadKeys(missingAllowed: boolean): Promise<ProjectKeyFile> {
    await this.ensureProjectDirectory()
    const exists = await assertRegularFile(this.keysPath, missingAllowed)
    if (!exists) return { schemaVersion: 1, keys: {} }
    const contents = await readFile(this.keysPath, 'utf8')
    if (Buffer.byteLength(contents) > 4 * 1024 * 1024) {
      throw new ShareNoteError('credential_missing', 'Project note key file is too large')
    }
    try {
      return assertKeyFile(JSON.parse(contents) as unknown)
    } catch (error) {
      if (error instanceof ShareNoteError) throw error
      throw new ShareNoteError('credential_missing', 'Project note key file is not valid JSON')
    }
  }

  async storeNoteKey(recordId: string, key: string): Promise<string> {
    if (!RECORD_ID_PATTERN.test(recordId) || typeof key !== 'string' || !key) {
      throw new ShareNoteError('credential_missing', 'Project note key is invalid')
    }
    await this.ensureKeyIgnore()
    await withLocalLock(this.dataDirectory, `project:${this.projectRoot}:keys`, async () => {
      const file = await this.loadKeys(true)
      file.keys[recordId] = key
      await writeJson(this.keysPath, file, 0o600)
    })
    return projectNoteKeyReference(recordId)
  }

  async readNoteKey(reference: string): Promise<string> {
    if (!NOTE_KEY_REFERENCE_PATTERN.test(reference)) {
      throw new ShareNoteError('credential_missing', 'Project note key reference is invalid')
    }
    const recordId = reference.slice('project-file:notes:'.length)
    const key = (await this.loadKeys(false)).keys[recordId]
    if (!key) throw new ShareNoteError('credential_missing', 'Project note key was not found')
    return key
  }

  async importLegacy(
    records: ShareRecord[],
    operations: OperationRecord[],
    keys: Map<string, string>
  ): Promise<void> {
    const manifest = await this.load()
    for (const record of records) {
      if (manifest.records.some((item) => item.recordId === record.recordId)) {
        throw new ShareNoteError('conflict', `Project already contains legacy record ${record.recordId}`)
      }
      if (!keys.has(record.recordId)) {
        throw new ShareNoteError('credential_missing', `Legacy note key is missing for ${record.recordId}`)
      }
    }
    for (const operation of operations) {
      if (manifest.operations.some((item) => item.operationId === operation.operationId)) {
        throw new ShareNoteError('conflict', `Project already contains legacy operation ${operation.operationId}`)
      }
    }
    for (const record of records) await this.storeNoteKey(record.recordId, keys.get(record.recordId)!)
    await this.mutateManifest((current) => {
      current.records.push(...records.map((record) => ({
        ...record,
        noteKeyRef: projectNoteKeyReference(record.recordId)
      })))
      current.operations.push(...operations.map((operation) => ({
        ...operation,
        ...(operation.noteKeyRef ? { noteKeyRef: projectNoteKeyReference(operation.recordId) } : {})
      })))
    })
  }
}

export async function sourceBelongsToProject(projectRoot: string, sourcePath: string): Promise<boolean> {
  const resolvedSource = await realpath(sourcePath).catch(() => path.resolve(sourcePath))
  return inside(projectRoot, resolvedSource) && resolvedSource !== projectRoot
}
