#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ShareNoteApplication } from './app.js'
import { ShareNoteError, toSafeError } from './errors.js'
import { userDataDirectory } from './platform/paths.js'
import { MacOsKeychainSecretStore } from './secrets/macos-keychain.js'

function usage(): never {
  throw new ShareNoteError('invalid_request', 'Usage: share-note.mjs <action> --request <json-file>')
}

async function requestFromArguments(arguments_: string[]): Promise<{ action: string; request: Record<string, unknown> }> {
  const [action, flag, requestPath, ...rest] = arguments_
  if (!action || flag !== '--request' || !requestPath || rest.length > 0) usage()
  const resolved = path.resolve(requestPath)
  const contents = await readFile(resolved, 'utf8')
  if (Buffer.byteLength(contents) > 1024 * 1024) {
    throw new ShareNoteError('invalid_request', 'Request file exceeds 1 MiB')
  }
  const request = JSON.parse(contents) as unknown
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new ShareNoteError('invalid_request', 'Request file must contain one JSON object')
  }
  return { action, request: request as Record<string, unknown> }
}

async function main(): Promise<void> {
  const { action, request } = await requestFromArguments(process.argv.slice(2))
  const application = new ShareNoteApplication(
    userDataDirectory(),
    new MacOsKeychainSecretStore()
  )
  let result: unknown
  switch (action) {
    case 'setup':
      result = await application.setup(request as never)
      break
    case 'doctor':
      result = await application.doctor(request as never)
      break
    case 'preview':
      result = await application.preview(request as never)
      break
    case 'read':
      result = await application.read(request as never)
      break
    case 'publish':
      result = await application.publish(request as never)
      break
    case 'update':
      result = await application.update(request as never)
      break
    case 'list':
      result = await application.list(request as never)
      break
    case 'delete':
      result = await application.delete(request as never)
      break
    default:
      throw new ShareNoteError('invalid_request', `Unknown action: ${action}`)
  }
  process.stdout.write(JSON.stringify(result) + '\n')
}

main().catch((error: unknown) => {
  process.stdout.write(JSON.stringify({
    ok: false,
    status: error instanceof ShareNoteError && error.code.endsWith('blocked') ? 'blocked' : 'failed',
    error: toSafeError(error)
  }) + '\n')
  process.exitCode = 1
})
