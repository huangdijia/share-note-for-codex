import { homedir } from 'node:os'
import path from 'node:path'

export function userDataDirectory(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDirectory: string = homedir()
): string {
  const override = environment.SHARE_NOTE_DATA_DIR
  if (override) return path.resolve(override)
  if (platform === 'darwin') {
    return path.join(homeDirectory, 'Library', 'Application Support', 'codex-share-note')
  }
  if (platform === 'win32') {
    return path.join(environment.APPDATA ?? path.join(homeDirectory, 'AppData', 'Roaming'), 'codex-share-note')
  }
  return path.join(environment.XDG_DATA_HOME ?? path.join(homeDirectory, '.local', 'share'), 'codex-share-note')
}
