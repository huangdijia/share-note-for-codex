import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { PROTOCOL_PROFILE } from './protocol/profile.js'
import { ShareNoteError } from './errors.js'
import { readJsonFile, writeJsonAtomic } from './state/atomic.js'

export interface CredentialReference {
  type: 'macos-keychain'
  service: string
  account: string
}

export interface ProfileConfig {
  schemaVersion: 1
  name: string
  apiBaseUrl: string
  webBaseUrl: string
  credentialRef: CredentialReference
  protocolProfile: typeof PROTOCOL_PROFILE.id
  defaultEncryption: true
  allowedSourceRoots: string[]
  embeddedAssetsPolicy: 'block'
  allowUnencryptedPublish: false
  allowInsecureLoopback: boolean
  maxSourceBytes: number
  maxResponseBytes: number
}

export interface ProfileSetupInput {
  profile: string
  apiBaseUrl: string
  webBaseUrl: string
  allowedSourceRoots: string[]
  allowInsecureLoopback?: boolean
  maxSourceBytes?: number
  maxResponseBytes?: number
}

export function validateProfileName(name: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) {
    throw new ShareNoteError('invalid_request', 'Profile name must use lowercase letters, digits, _ or -')
  }
  return name
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

export function normalizeBaseUrl(value: string, allowInsecureLoopback: boolean): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ShareNoteError('invalid_request', 'Service URL is invalid')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ShareNoteError('invalid_request', 'Service URL cannot include credentials, query, or fragment')
  }
  if (url.protocol !== 'https:' && !(allowInsecureLoopback && url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new ShareNoteError('invalid_request', 'Service URL must use HTTPS; HTTP is allowed only for explicitly enabled loopback tests')
  }
  return url.toString().replace(/\/$/, '')
}

async function normalizeRoots(roots: string[]): Promise<string[]> {
  if (roots.length === 0) throw new ShareNoteError('invalid_request', 'At least one allowed source root is required')
  const normalized = new Set<string>()
  for (const root of roots) {
    const resolved = await realpath(path.resolve(root)).catch(() => undefined)
    if (!resolved || !(await stat(resolved)).isDirectory()) {
      throw new ShareNoteError('invalid_request', 'Allowed source root does not exist or is not a directory', { root })
    }
    normalized.add(resolved)
  }
  return [...normalized]
}

export async function buildProfileConfig(
  input: ProfileSetupInput,
  credentialRef: CredentialReference
): Promise<ProfileConfig> {
  const allowInsecureLoopback = input.allowInsecureLoopback === true
  const maxSourceBytes = input.maxSourceBytes ?? 5 * 1024 * 1024
  const maxResponseBytes = input.maxResponseBytes ?? 10 * 1024 * 1024
  if (!Number.isSafeInteger(maxSourceBytes) || maxSourceBytes < 1 || maxSourceBytes > 50 * 1024 * 1024) {
    throw new ShareNoteError('invalid_request', 'maxSourceBytes is outside the supported range')
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 50 * 1024 * 1024) {
    throw new ShareNoteError('invalid_request', 'maxResponseBytes is outside the supported range')
  }
  return {
    schemaVersion: 1,
    name: validateProfileName(input.profile),
    apiBaseUrl: normalizeBaseUrl(input.apiBaseUrl, allowInsecureLoopback),
    webBaseUrl: normalizeBaseUrl(input.webBaseUrl, allowInsecureLoopback),
    credentialRef,
    protocolProfile: PROTOCOL_PROFILE.id,
    defaultEncryption: true,
    allowedSourceRoots: await normalizeRoots(input.allowedSourceRoots),
    embeddedAssetsPolicy: 'block',
    allowUnencryptedPublish: false,
    allowInsecureLoopback,
    maxSourceBytes,
    maxResponseBytes
  }
}

function assertProfile(value: unknown, expectedName: string): ProfileConfig {
  if (!value || typeof value !== 'object') throw new ShareNoteError('configuration_missing', 'Profile is invalid')
  const profile = value as Partial<ProfileConfig>
  if (
    profile.schemaVersion !== 1 ||
    profile.name !== expectedName ||
    typeof profile.apiBaseUrl !== 'string' ||
    typeof profile.webBaseUrl !== 'string' ||
    profile.protocolProfile !== PROTOCOL_PROFILE.id ||
    profile.defaultEncryption !== true ||
    profile.embeddedAssetsPolicy !== 'block' ||
    profile.allowUnencryptedPublish !== false ||
    !Array.isArray(profile.allowedSourceRoots) ||
    !profile.credentialRef ||
    profile.credentialRef.type !== 'macos-keychain'
  ) {
    throw new ShareNoteError('configuration_missing', 'Profile schema or security policy is invalid')
  }
  return profile as ProfileConfig
}

export class ConfigStore {
  constructor(private readonly dataDirectory: string) {}

  private pathFor(name: string): string {
    return path.join(this.dataDirectory, 'profiles', `${validateProfileName(name)}.json`)
  }

  async save(profile: ProfileConfig): Promise<void> {
    await writeJsonAtomic(this.pathFor(profile.name), profile)
  }

  async load(name: string): Promise<ProfileConfig> {
    const safeName = validateProfileName(name)
    const value = await readJsonFile(this.pathFor(safeName)).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ShareNoteError('configuration_missing', `Profile ${safeName} is not configured`)
      }
      throw error
    })
    return assertProfile(value, safeName)
  }
}
