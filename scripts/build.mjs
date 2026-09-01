import { build } from 'esbuild'
import { chmod, copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pluginRoot = path.join(root, 'plugins', 'share-note')
const output = path.join(pluginRoot, 'skills', 'share-note', 'scripts', 'share-note.mjs')

await mkdir(path.dirname(output), { recursive: true })
await build({
  entryPoints: [path.join(root, 'src', 'cli.ts')],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'bundle',
  sourcemap: false,
  minify: false,
  legalComments: 'eof',
  banner: {
    js: "import { createRequire as __shareNoteCreateRequire } from 'node:module'; const require = __shareNoteCreateRequire(import.meta.url);"
  },
  charset: 'utf8'
})
await chmod(output, 0o755)
await copyFile(path.join(root, 'LICENSE'), path.join(pluginRoot, 'LICENSE'))
await copyFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(pluginRoot, 'THIRD_PARTY_NOTICES.md'))
console.log(`Built ${path.relative(root, output)}`)
