import { createHash } from 'node:crypto'
import { open, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { ShareNoteError } from '../errors.js'
import { ensurePrivateDirectory } from './atomic.js'

function lockFilename(name: string): string {
  return createHash('sha256').update(name, 'utf8').digest('hex') + '.lock'
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

export async function withLocalLock<T>(
  dataDirectory: string,
  name: string,
  operation: () => Promise<T>,
  options: { attempts?: number; retryMilliseconds?: number; staleMilliseconds?: number } = {}
): Promise<T> {
  const locksDirectory = path.join(dataDirectory, 'locks')
  await ensurePrivateDirectory(locksDirectory)
  const lockPath = path.join(locksDirectory, lockFilename(name))
  const attempts = options.attempts ?? 100
  const retryMilliseconds = options.retryMilliseconds ?? 25
  const staleMilliseconds = options.staleMilliseconds ?? 30_000
  let acquired = false
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx', 0o600)
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }))
      await handle.close()
      acquired = true
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const info = await stat(lockPath).catch(() => undefined)
      if (info && Date.now() - info.mtimeMs > staleMilliseconds) {
        const contents = await readFile(lockPath, 'utf8').catch(() => '')
        if (contents.length < 1024) await rm(lockPath, { force: true })
      }
      await delay(retryMilliseconds)
    }
  }
  if (!acquired) throw new ShareNoteError('conflict', 'Another local operation holds this note lock')
  try {
    return await operation()
  } finally {
    await rm(lockPath, { force: true })
  }
}
