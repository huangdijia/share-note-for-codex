import { createHash } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import type { ProfileConfig } from '../config.js'
import { validateProfileName } from '../config.js'
import { ShareNoteError } from '../errors.js'
import { readJsonFile, writeJsonAtomic } from './atomic.js'
import { withLocalLock } from './lock.js'

export type BrowserSetupService = 'public' | 'self-hosted'

export interface PendingBrowserSetup {
  schemaVersion: 1
  profile: string
  uid: string
  service: BrowserSetupService
  apiBaseUrl: string
  webBaseUrl: string
  allowedSourceRoots: string[]
  allowInsecureLoopback: boolean
  maxSourceBytes: number
  maxResponseBytes: number
  createdAt: string
  expiresAt: string
  bindingHash: string
}

type PendingSetupFields = Omit<PendingBrowserSetup, 'schemaVersion' | 'createdAt' | 'expiresAt' | 'bindingHash'>

const MINIMUM_EXPIRY_SECONDS = 60
const MAXIMUM_EXPIRY_SECONDS = 30 * 60
const DEFAULT_EXPIRY_SECONDS = 10 * 60

function bindingValue(value: Omit<PendingBrowserSetup, 'bindingHash'>): string {
  return JSON.stringify({
    schemaVersion: value.schemaVersion,
    profile: value.profile,
    uid: value.uid,
    service: value.service,
    apiBaseUrl: value.apiBaseUrl,
    webBaseUrl: value.webBaseUrl,
    allowedSourceRoots: value.allowedSourceRoots,
    allowInsecureLoopback: value.allowInsecureLoopback,
    maxSourceBytes: value.maxSourceBytes,
    maxResponseBytes: value.maxResponseBytes,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt
  })
}

function bindingHash(value: Omit<PendingBrowserSetup, 'bindingHash'>): string {
  return createHash('sha256').update(bindingValue(value), 'utf8').digest('hex')
}

function assertPending(value: unknown, expectedProfile: string): PendingBrowserSetup {
  if (!value || typeof value !== 'object') {
    throw new ShareNoteError('configuration_missing', 'Pending browser setup is invalid')
  }
  const pending = value as Partial<PendingBrowserSetup>
  if (
    pending.schemaVersion !== 1 ||
    pending.profile !== expectedProfile ||
    typeof pending.uid !== 'string' ||
    !/^[A-Za-z0-9_-]{8,128}$/.test(pending.uid) ||
    (pending.service !== 'public' && pending.service !== 'self-hosted') ||
    typeof pending.apiBaseUrl !== 'string' ||
    typeof pending.webBaseUrl !== 'string' ||
    !Array.isArray(pending.allowedSourceRoots) ||
    pending.allowedSourceRoots.some((root) => typeof root !== 'string') ||
    typeof pending.allowInsecureLoopback !== 'boolean' ||
    !Number.isSafeInteger(pending.maxSourceBytes) ||
    !Number.isSafeInteger(pending.maxResponseBytes) ||
    typeof pending.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(pending.createdAt)) ||
    typeof pending.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(pending.expiresAt)) ||
    typeof pending.bindingHash !== 'string'
  ) {
    throw new ShareNoteError('configuration_missing', 'Pending browser setup schema is invalid')
  }
  const complete = pending as PendingBrowserSetup
  const { bindingHash: storedHash, ...bound } = complete
  if (bindingHash(bound) !== storedHash) {
    throw new ShareNoteError('source_blocked', 'Pending browser setup source binding changed')
  }
  return complete
}

export function pendingFieldsFromProfile(
  profile: ProfileConfig,
  uid: string,
  service: BrowserSetupService
): PendingSetupFields {
  return {
    profile: profile.name,
    uid,
    service,
    apiBaseUrl: profile.apiBaseUrl,
    webBaseUrl: profile.webBaseUrl,
    allowedSourceRoots: profile.allowedSourceRoots,
    allowInsecureLoopback: profile.allowInsecureLoopback,
    maxSourceBytes: profile.maxSourceBytes,
    maxResponseBytes: profile.maxResponseBytes
  }
}

export class PendingSetupStore {
  constructor(
    private readonly dataDirectory: string,
    private readonly now: () => number = Date.now
  ) {}

  private pathFor(profile: string): string {
    return path.join(this.dataDirectory, 'pending-setups', `${validateProfileName(profile)}.json`)
  }

  private async read(profile: string): Promise<PendingBrowserSetup | undefined> {
    const safeProfile = validateProfileName(profile)
    const value = await readJsonFile(this.pathFor(safeProfile)).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    })
    return value === undefined ? undefined : assertPending(value, safeProfile)
  }

  async create(fields: PendingSetupFields, expirySeconds = DEFAULT_EXPIRY_SECONDS): Promise<PendingBrowserSetup> {
    if (
      !Number.isSafeInteger(expirySeconds) ||
      expirySeconds < MINIMUM_EXPIRY_SECONDS ||
      expirySeconds > MAXIMUM_EXPIRY_SECONDS
    ) {
      throw new ShareNoteError('invalid_request', 'Browser setup expiry must be between 60 and 1800 seconds')
    }
    return withLocalLock(this.dataDirectory, `pending-setup:${fields.profile}`, async () => {
      const existing = await this.read(fields.profile)
      if (existing && Date.parse(existing.expiresAt) > this.now()) {
        throw new ShareNoteError('conflict', 'A browser setup is already pending for this profile')
      }
      if (existing) await rm(this.pathFor(fields.profile), { force: true })
      const createdAt = new Date(this.now()).toISOString()
      const expiresAt = new Date(this.now() + expirySeconds * 1000).toISOString()
      const bound = { schemaVersion: 1 as const, ...fields, createdAt, expiresAt }
      const pending: PendingBrowserSetup = { ...bound, bindingHash: bindingHash(bound) }
      await writeJsonAtomic(this.pathFor(fields.profile), pending)
      return pending
    })
  }

  async complete<T>(profile: string, operation: (pending: PendingBrowserSetup) => Promise<T>): Promise<T> {
    const safeProfile = validateProfileName(profile)
    return withLocalLock(this.dataDirectory, `pending-setup:${safeProfile}`, async () => {
      const pending = await this.read(safeProfile)
      if (!pending) throw new ShareNoteError('configuration_missing', 'No browser setup is pending for this profile')
      if (Date.parse(pending.expiresAt) <= this.now()) {
        await rm(this.pathFor(safeProfile), { force: true })
        throw new ShareNoteError('configuration_missing', 'Pending browser setup expired; start again')
      }
      const result = await operation(pending)
      await rm(this.pathFor(safeProfile), { force: true })
      return result
    })
  }

  async cancel(profile: string): Promise<void> {
    const safeProfile = validateProfileName(profile)
    await withLocalLock(this.dataDirectory, `pending-setup:${safeProfile}`, async () => {
      const pending = await this.read(safeProfile)
      if (!pending) throw new ShareNoteError('configuration_missing', 'No browser setup is pending for this profile')
      await rm(this.pathFor(safeProfile), { force: true })
    })
  }

  async discard(profile: string): Promise<void> {
    const safeProfile = validateProfileName(profile)
    await withLocalLock(this.dataDirectory, `pending-setup:${safeProfile}`, async () => {
      await rm(this.pathFor(safeProfile), { force: true })
    })
  }
}
