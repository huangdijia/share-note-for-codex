#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  BROWSER_API_KEY_ENV_VAR,
  ShareNoteApplication,
  type SetupBrowserRequest,
  type SetupBrowserCompleteRequest
} from './app.js'
import { ShareNoteError, toSafeError } from './errors.js'
import { userDataDirectory } from './platform/paths.js'
import { assertHiddenInputAvailable, readHiddenInput } from './platform/hidden-input.js'
import { PlaintextFileSecretStore } from './secrets/plaintext-file.js'

function usage(): never {
  throw new ShareNoteError('invalid_request', 'Usage: share-note.mjs <action> --request <json-file>, or share-note.mjs setup-browser')
}

async function requestFromArguments(arguments_: string[]): Promise<{ action: string; request: Record<string, unknown>; keyFromTty?: boolean }> {
  const [action, flag, requestPath, ...rest] = arguments_
  if ((action === 'themes' || action === 'capabilities') && arguments_.length === 1) {
    return { action, request: {} }
  }
  if ((action === 'setup-browser' || action === 'setup-codex-browser') && arguments_.length === 1) {
    return { action, request: { profile: 'public', service: 'public', projectRoot: process.cwd() } }
  }
  const keyFromTty = action === 'setup-codex-browser-complete' && rest.length === 1 && rest[0] === '--key-tty'
  if (!action || flag !== '--request' || !requestPath || (rest.length > 0 && !keyFromTty)) usage()
  const resolved = path.resolve(requestPath)
  const contents = await readFile(resolved, 'utf8')
  if (Buffer.byteLength(contents) > 1024 * 1024) {
    throw new ShareNoteError('invalid_request', 'Request file exceeds 1 MiB')
  }
  const request = JSON.parse(contents) as unknown
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new ShareNoteError('invalid_request', 'Request file must contain one JSON object')
  }
  return { action, request: request as Record<string, unknown>, keyFromTty }
}

async function main(): Promise<void> {
  const { action, request, keyFromTty } = await requestFromArguments(process.argv.slice(2))
  const dataDirectory = userDataDirectory()
  const application = new ShareNoteApplication(
    dataDirectory,
    new PlaintextFileSecretStore(dataDirectory)
  )
  let result: unknown
  switch (action) {
    case 'setup':
      result = await application.setup(request as never)
      break
    case 'setup-browser': {
      const environmentKey = process.env[BROWSER_API_KEY_ENV_VAR]
      delete process.env[BROWSER_API_KEY_ENV_VAR]
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          let prompted = false
          try {
            result = await application.setupBrowser(
              request as unknown as SetupBrowserRequest,
              async () => {
                if (environmentKey) return environmentKey
                prompted = true
                process.stderr.write('在浏览器完成人机验证后，将页面显示的 API key 粘贴到下方。输入不会回显；Ctrl+C 后可重跑此命令继续。\n')
                return readHiddenInput('Share Note API key: ')
              },
              () => { if (!environmentKey) assertHiddenInputAvailable() }
            )
            break
          } catch (error) {
            if (
              !(error instanceof ShareNoteError) ||
              (error.code !== 'authentication_failed' && error.code !== 'credential_missing') ||
              !prompted || attempt === 2
            ) {
              throw error
            }
            process.stderr.write('API key 验证失败，尚未保存。请重新复制同一授权页面上的 key。\n')
          }
        }
      } finally {
        delete process.env[BROWSER_API_KEY_ENV_VAR]
      }
      break
    }
    case 'setup-browser-start':
      result = await application.setupBrowserStart(request as never)
      break
    case 'setup-codex-browser':
      delete process.env[BROWSER_API_KEY_ENV_VAR]
      result = await application.setupCodexBrowser(request as unknown as SetupBrowserRequest)
      break
    case 'setup-codex-browser-complete':
      try {
        if (keyFromTty) {
          delete process.env[BROWSER_API_KEY_ENV_VAR]
          process.env[BROWSER_API_KEY_ENV_VAR] = await readHiddenInput('Share Note API key: ')
        }
        result = await application.setupCodexBrowserComplete(request as never)
      } finally {
        delete process.env[BROWSER_API_KEY_ENV_VAR]
      }
      break
    case 'setup-browser-complete': {
      const completeRequest = request as unknown as SetupBrowserCompleteRequest
      if (completeRequest.cancel !== undefined && typeof completeRequest.cancel !== 'boolean') {
        throw new ShareNoteError('invalid_request', 'cancel must be a boolean')
      }
      try {
        if (completeRequest.cancel !== true) {
          if (!process.env[BROWSER_API_KEY_ENV_VAR]) {
            process.env[BROWSER_API_KEY_ENV_VAR] = await readHiddenInput('Share Note API key: ')
          }
        }
        result = await application.setupBrowserComplete(completeRequest)
      } finally {
        delete process.env[BROWSER_API_KEY_ENV_VAR]
      }
      break
    }
    case 'doctor':
      result = await application.doctor(request as never)
      break
    case 'configure-project':
      result = await application.configureProject(request as never)
      break
    case 'capabilities':
      result = application.capabilities()
      break
    case 'themes':
      result = application.themes()
      break
    case 'preview':
      result = await application.preview(request as never)
      break
    case 'link':
      result = await application.link(request as never)
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
