import { spawn, type ChildProcess } from 'node:child_process'
import { ShareNoteError } from '../errors.js'

export interface BrowserLaunchSpec {
  command: string
  arguments: string[]
  options: {
    detached: true
    shell: false
    stdio: 'ignore'
    windowsHide: true
  }
}

type SpawnImplementation = (
  command: string,
  arguments_: readonly string[],
  options: BrowserLaunchSpec['options']
) => ChildProcess

function approvedBrowserUrl(value: string, approvedOrigin: string): string {
  let target: URL
  let approved: URL
  try {
    target = new URL(value)
    approved = new URL(approvedOrigin)
  } catch {
    throw new ShareNoteError('invalid_request', 'Browser authorization URL is invalid')
  }
  if (
    (target.protocol !== 'https:' && target.protocol !== 'http:') ||
    target.origin !== approved.origin ||
    target.username ||
    target.password ||
    target.hash
  ) {
    throw new ShareNoteError('source_blocked', 'Browser authorization URL is outside the approved API origin')
  }
  return target.toString()
}

export function createBrowserLaunchSpec(
  value: string,
  approvedOrigin: string,
  platform: NodeJS.Platform = process.platform
): BrowserLaunchSpec {
  const target = approvedBrowserUrl(value, approvedOrigin)
  const options = {
    detached: true,
    shell: false,
    stdio: 'ignore',
    windowsHide: true
  } as const
  if (platform === 'darwin') {
    return { command: 'open', arguments: [target], options }
  }
  if (platform === 'win32') {
    return {
      command: 'rundll32.exe',
      arguments: ['url.dll,FileProtocolHandler', target],
      options
    }
  }
  if (platform === 'linux') {
    return { command: 'xdg-open', arguments: [target], options }
  }
  throw new ShareNoteError('invalid_request', 'System browser launch is unsupported on this platform')
}

export async function openInSystemBrowser(
  value: string,
  approvedOrigin: string,
  platform: NodeJS.Platform = process.platform,
  spawnImplementation: SpawnImplementation = spawn
): Promise<void> {
  const spec = createBrowserLaunchSpec(value, approvedOrigin, platform)
  await new Promise<void>((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawnImplementation(spec.command, spec.arguments, spec.options)
    } catch {
      reject(new ShareNoteError('network_error', 'System browser could not be opened'))
      return
    }
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
    child.once('error', () => {
      reject(new ShareNoteError('network_error', 'System browser could not be opened'))
    })
  })
}
