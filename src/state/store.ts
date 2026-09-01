import path from 'node:path'
import { ShareNoteError } from '../errors.js'
import type { OperationStatus } from '../result.js'
import { readJsonFile, writeJsonAtomic } from './atomic.js'
import { withLocalLock } from './lock.js'

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
  encrypted: true
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
  createdAt: string
  updatedAt: string
}

interface RecordsFile {
  schemaVersion: 1
  records: ShareRecord[]
}

function assertRecordId(recordId: string): string {
  if (!/^note-[0-9a-f-]{36}$/.test(recordId)) throw new ShareNoteError('invalid_request', 'Invalid record ID')
  return recordId
}

function assertOperationId(operationId: string): string {
  if (!/^op-[0-9a-f-]{36}$/.test(operationId)) throw new ShareNoteError('invalid_request', 'Invalid operation ID')
  return operationId
}

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

  async saveRecord(record: ShareRecord): Promise<void> {
    assertRecordId(record.recordId)
    await withLocalLock(this.dataDirectory, 'records-index', async () => {
      const file = await this.readRecords()
      const index = file.records.findIndex((item) => item.recordId === record.recordId)
      if (index >= 0) file.records[index] = record
      else file.records.push(record)
      await writeJsonAtomic(this.recordsPath, file)
    })
  }

  async getRecord(recordId: string): Promise<ShareRecord> {
    const record = (await this.readRecords()).records.find((item) => item.recordId === assertRecordId(recordId))
    if (!record) throw new ShareNoteError('not_found', `Local record ${recordId} was not found`)
    return record
  }

  async listRecords(profile?: string, query?: string): Promise<ShareRecord[]> {
    const normalizedQuery = query?.toLocaleLowerCase()
    return (await this.readRecords()).records.filter((record) => {
      if (profile && record.profile !== profile) return false
      if (!normalizedQuery) return true
      return `${record.recordId} ${record.title} ${record.sourcePath}`.toLocaleLowerCase().includes(normalizedQuery)
    })
  }

  async writeOperation(operation: OperationRecord): Promise<void> {
    assertOperationId(operation.operationId)
    await writeJsonAtomic(
      path.join(this.dataDirectory, 'operations', `${operation.operationId}.json`),
      operation
    )
  }

  async listOperations(status?: OperationRecord['status']): Promise<OperationRecord[]> {
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
      if (operation.schemaVersion === 1 && (!status || operation.status === status)) {
        operations.push(operation)
      }
    }
    return operations
  }
}
