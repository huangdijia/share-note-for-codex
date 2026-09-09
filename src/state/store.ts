import path from 'node:path'
import { ShareNoteError } from '../errors.js'
import type { OperationStatus } from '../result.js'
import { readJsonFile } from './atomic.js'
import type { ThemeId } from '../render/themes.js'

export interface ShareRecord {
  schemaVersion: 1
  recordId: string
  profile: string
  apiOrigin: string
  webOrigin: string
  identityRef: string
  sourcePath: string
  remoteFilename: string
  shareUrl: string
  noteKeyRef: string
  sourceHash: string
  contentHash: string
  title: string
  theme?: ThemeId
  encrypted: boolean
  status: OperationStatus
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export interface OperationRecord {
  schemaVersion: 1
  operationId: string
  action: 'publish' | 'update' | 'delete'
  recordId: string
  profile: string
  target: string
  status: OperationStatus | 'pending'
  contentHash?: string
  noteKeyRef?: string
  remoteUrl?: string
  diagnostic?: string
  imageUploads?: Array<{ hash: string; filetype: string; status: 'pending' | 'verified' | 'unknown'; url?: string }>
  createdAt: string
  updatedAt: string
}

interface RecordsFile {
  schemaVersion: 1
  records: ShareRecord[]
}

// Read-only access to the global registry retained for project migration.
export class StateStore {
  constructor(private readonly dataDirectory: string) {}

  private get recordsPath(): string {
    return path.join(this.dataDirectory, 'records.json')
  }

  private async readRecords(): Promise<RecordsFile> {
    const value = await readJsonFile(this.recordsPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { schemaVersion: 1 as const, records: [] }
      }
      throw error
    })
    if (!value || typeof value !== 'object') throw new ShareNoteError('protocol_error', 'Local records file is invalid')
    const records = value as Partial<RecordsFile>
    if (records.schemaVersion !== 1 || !Array.isArray(records.records)) {
      throw new ShareNoteError('protocol_error', 'Local records schema is unsupported')
    }
    return records as RecordsFile
  }

  async listRecords(profile?: string): Promise<ShareRecord[]> {
    return (await this.readRecords()).records.filter((record) => !profile || record.profile === profile)
  }

  async listOperations(): Promise<OperationRecord[]> {
    const directory = path.join(this.dataDirectory, 'operations')
    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(directory).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    })
    const operations: OperationRecord[] = []
    for (const entry of entries.sort()) {
      if (!/^op-[0-9a-f-]{36}\.json$/.test(entry)) continue
      const value = await readJsonFile(path.join(directory, entry))
      if (!value || typeof value !== 'object') continue
      const operation = value as OperationRecord
      if (operation.schemaVersion === 1) {
        operations.push(operation)
      }
    }
    return operations
  }
}
