import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { userDataDirectory } from '../../src/platform/paths.js'

describe('cross-platform user data paths', () => {
  it('uses the macOS Application Support directory', () => {
    expect(userDataDirectory({}, 'darwin', '/Users/tester')).toBe(
      path.join('/Users/tester', 'Library', 'Application Support', 'codex-share-note')
    )
  })

  it('uses APPDATA on Windows with a home-directory fallback', () => {
    expect(userDataDirectory({ APPDATA: 'C:\\Users\\tester\\AppData\\Roaming' }, 'win32', 'C:\\Users\\tester')).toBe(
      path.join('C:\\Users\\tester\\AppData\\Roaming', 'codex-share-note')
    )
    expect(userDataDirectory({}, 'win32', 'C:\\Users\\tester')).toBe(
      path.join('C:\\Users\\tester', 'AppData', 'Roaming', 'codex-share-note')
    )
  })

  it('uses XDG_DATA_HOME on Linux with a home-directory fallback', () => {
    expect(userDataDirectory({ XDG_DATA_HOME: '/data/tester' }, 'linux', '/home/tester')).toBe(
      path.join('/data/tester', 'codex-share-note')
    )
    expect(userDataDirectory({}, 'linux', '/home/tester')).toBe(
      path.join('/home/tester', '.local', 'share', 'codex-share-note')
    )
  })

  it('honors the explicit data-directory override on every platform', () => {
    expect(userDataDirectory({ SHARE_NOTE_DATA_DIR: './private-data' }, 'win32', 'C:\\Users\\tester')).toBe(
      path.resolve('./private-data')
    )
  })
})
