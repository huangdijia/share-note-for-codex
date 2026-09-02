import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  buildBrowserAuthorizationUrl,
  createBrowserSetupUid
} from '../../src/app.js'
import {
  createBrowserLaunchSpec,
  openInSystemBrowser
} from '../../src/platform/browser.js'
import { readHiddenInput } from '../../src/platform/hidden-input.js'

describe('system browser setup primitives', () => {
  const authorizationUrl = 'https://api.example.test/v1/account/get-key?id=safe_identity'

  it('uses direct argument arrays with shell disabled on every supported platform', () => {
    expect(createBrowserLaunchSpec(authorizationUrl, 'https://api.example.test', 'darwin')).toMatchObject({
      command: 'open',
      arguments: [authorizationUrl],
      options: { shell: false, detached: true, stdio: 'ignore' }
    })
    expect(createBrowserLaunchSpec(authorizationUrl, 'https://api.example.test', 'linux')).toMatchObject({
      command: 'xdg-open',
      arguments: [authorizationUrl],
      options: { shell: false, detached: true, stdio: 'ignore' }
    })
    expect(createBrowserLaunchSpec(authorizationUrl, 'https://api.example.test', 'win32')).toMatchObject({
      command: 'rundll32.exe',
      arguments: ['url.dll,FileProtocolHandler', authorizationUrl],
      options: { shell: false, detached: true, stdio: 'ignore' }
    })
  })

  it('rejects unsupported platforms and authorization origin drift', () => {
    expect(() => createBrowserLaunchSpec(authorizationUrl, 'https://other.example.test', 'linux'))
      .toThrowError(expect.objectContaining({ code: 'source_blocked' }))
    expect(() => createBrowserLaunchSpec(authorizationUrl, 'https://api.example.test', 'aix'))
      .toThrowError(expect.objectContaining({ code: 'invalid_request' }))
  })

  it('constructs the frozen route through URLSearchParams and creates cryptographic identities', () => {
    const uid = createBrowserSetupUid()
    const secondUid = createBrowserSetupUid()
    expect(uid).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(secondUid).not.toBe(uid)
    const url = new URL(buildBrowserAuthorizationUrl('https://api.example.test/base/path', uid))
    expect(url.origin).toBe('https://api.example.test')
    expect(url.pathname).toBe('/v1/account/get-key')
    expect(url.searchParams.get('id')).toBe(uid)
  })

  it('waits only for spawn and never forwards browser stdio', async () => {
    const process = new EventEmitter() as ChildProcess
    process.unref = vi.fn(() => process)
    const spawn = vi.fn(() => {
      queueMicrotask(() => process.emit('spawn'))
      return process
    })
    await openInSystemBrowser(authorizationUrl, 'https://api.example.test', 'linux', spawn)
    expect(spawn).toHaveBeenCalledWith('xdg-open', [authorizationUrl], {
      detached: true,
      shell: false,
      stdio: 'ignore',
      windowsHide: true
    })
    expect(process.unref).toHaveBeenCalledOnce()
  })

  it('accepts terminal secrets without echoing them and rejects non-interactive input', async () => {
    const input = new PassThrough() as unknown as NodeJS.ReadStream & { setRawMode: ReturnType<typeof vi.fn> }
    Object.assign(input, { isTTY: true, isRaw: false, setRawMode: vi.fn() })
    const write = vi.fn()
    const output = { isTTY: true, write } as unknown as NodeJS.WriteStream
    const pending = readHiddenInput('Key: ', input, output)
    input.emit('data', Buffer.from('non-echoing-test-value\n'))
    await expect(pending).resolves.toBe('non-echoing-test-value')
    const outputText = write.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .join('')
    expect(outputText).toBe('Key: \n')

    await expect(readHiddenInput('Key: ', { isTTY: false } as NodeJS.ReadStream, output))
      .rejects.toMatchObject({ code: 'secure_store_unavailable' })
  })
})
