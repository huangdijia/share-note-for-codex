import { lstat, readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { ShareNoteError } from './errors.js'

export interface SafeSource {
  requestedPath: string
  realPath: string
  content: string
  sourceHash: string
  bytes: number
  symbolicLink: boolean
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
}

export async function readSafeSource(
  sourcePath: string,
  workspaceRoot: string,
  allowedSourceRoots: string[],
  maximumBytes: number
): Promise<SafeSource> {
  const requestedPath = path.resolve(workspaceRoot, sourcePath)
  const requestedInfo = await lstat(requestedPath).catch(() => undefined)
  if (!requestedInfo) throw new ShareNoteError('source_blocked', 'Source file does not exist')
  const resolved = await realpath(requestedPath)
  const roots = await Promise.all(allowedSourceRoots.map(async (root) => realpath(root)))
  if (!roots.some((root) => inside(root, resolved))) {
    throw new ShareNoteError('source_blocked', 'Source resolves outside the configured allowed roots')
  }
  const info = await stat(resolved)
  if (!info.isFile()) throw new ShareNoteError('source_blocked', 'Source is not a regular file')
  if (info.size > maximumBytes) {
    throw new ShareNoteError('source_blocked', 'Source exceeds the configured size limit', {
      bytes: info.size,
      maximumBytes
    })
  }
  const buffer = await readFile(resolved)
  const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  return {
    requestedPath,
    realPath: resolved,
    content,
    sourceHash: createHash('sha256').update(buffer).digest('hex'),
    bytes: buffer.byteLength,
    symbolicLink: requestedInfo.isSymbolicLink()
  }
}
