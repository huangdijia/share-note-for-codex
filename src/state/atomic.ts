import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await ensurePrivateDirectory(path.dirname(filePath))
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`)
  const handle = await open(temporaryPath, 'wx', 0o600)
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporaryPath, filePath)
    await chmod(filePath, 0o600)
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }
}

export async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown
}
