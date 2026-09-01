import { homedir } from 'node:os'
import path from 'node:path'

export function userDataDirectory(environment: NodeJS.ProcessEnv = process.env): string {
  const override = environment.SHARE_NOTE_DATA_DIR
  if (override) return path.resolve(override)
  if (process.platform === 'darwin') {
    return path.join(homedir(), 'Library', 'Application Support', 'codex-share-note')
  }
  if (process.platform === 'win32') {
    return path.join(environment.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming'), 'codex-share-note')
  }
  return path.join(environment.XDG_DATA_HOME ?? path.join(homedir(), '.local', 'share'), 'codex-share-note')
}
