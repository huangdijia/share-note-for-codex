// Local-only bundle/visual acceptance. Requires an existing Playwright installation;
// no runtime dependency is added to the plugin and no real service is contacted.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.resolve(process.argv[2] ?? path.join(tmpdir(), 'share-note-theme-acceptance'))
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const temporary = await mkdtemp(path.join(tmpdir(), 'share-note-theme-check-'))
const project = path.join(temporary, 'project')
const bundle = path.join(root, 'plugins/share-note/skills/share-note/scripts/share-note.mjs')
const environment = { ...process.env, SHARE_NOTE_DATA_DIR: path.join(temporary, 'data') }
const results = []
let browser
try {
  await mkdir(project)
  await mkdir(output, { recursive: true })
  await copyFile(path.join(root, 'examples/theme-fixture.md'), path.join(project, 'article.md'))
  async function run(action, request, extra = {}) {
    const file = path.join(temporary, `${action}.json`)
    await writeFile(file, JSON.stringify(request))
    return JSON.parse(execFileSync(process.execPath, [bundle, action, '--request', file], {
      cwd: project, encoding: 'utf8', env: { ...environment, ...extra }
    }))
  }
  await run('setup', {
    profile: 'visual-fixture', apiBaseUrl: 'https://api.example.invalid',
    webBaseUrl: 'https://share.example.invalid', allowedSourceRoots: [project],
    credentialEnvVar: 'THEME_FIXTURE_CREDENTIAL'
  }, { THEME_FIXTURE_CREDENTIAL: JSON.stringify({ uid: 'synthetic-visual-user', apiKey: 'synthetic-not-a-real-key' }) })
  await run('configure-project', { projectRoot: project, profile: 'visual-fixture' })
  browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) })
  const catalog = JSON.parse(execFileSync(process.execPath, [bundle, 'themes'], {
    cwd: temporary, encoding: 'utf8', env: environment
  }))
  if (!catalog.ok || !Array.isArray(catalog.themes) || !catalog.themes.length) throw new Error('Invalid theme catalog')
  const themes = catalog.themes
  for (const { id: theme } of themes) {
    const preview = await run('preview', { projectRoot: project, sourcePath: 'article.md', theme })
    if (!preview.publishable || preview.theme !== theme) throw new Error(`Invalid ${theme} preview`)
    const html = await readFile(preview.previewPath, 'utf8')
    await writeFile(path.join(output, `${theme}.html`), html)
    for (const width of [1440, 375]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 }, deviceScaleFactor: 1 })
      const remoteRequests = []
      await page.route('**/*', route => { remoteRequests.push(route.request().url()); return route.abort() })
      await page.setContent(html)
      const metrics = await page.evaluate(() => {
        const article = document.querySelector('article')
        const pre = document.querySelector('pre')
        const table = document.querySelector('table')
        const style = getComputedStyle(article)
        return {
          viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
          articleWidth: article.getBoundingClientRect().width,
          background: style.backgroundColor, color: style.color, font: style.fontFamily,
          preWidth: pre.clientWidth, preScrollWidth: pre.scrollWidth,
          tableWidth: table.clientWidth, tableScrollWidth: table.scrollWidth
        }
      })
      if (metrics.preScrollWidth <= metrics.preWidth) throw new Error(`${theme}/${width}: long code is not locally scrollable`)
      if (width === 375 && metrics.tableScrollWidth <= metrics.tableWidth) throw new Error(`${theme}/${width}: wide table is not locally scrollable`)
      if (metrics.pageWidth > width) throw new Error(`${theme}/${width}: page overflows ${metrics.pageWidth}`)
      if (remoteRequests.length) throw new Error(`${theme}: requested remote resources`)
      await page.screenshot({ path: path.join(output, `${theme}-${width}.png`), fullPage: true })
      // A generic host-style stress test is local evidence, not a live-service replica.
      const typography = () => [...document.querySelectorAll('article p, article li, article th, article td, article pre, article code, article h1, article h2, article h3, article h4, article h5, article h6, article a, article blockquote')].map(el => {
        const s = getComputedStyle(el)
        return [s.color, s.fontFamily, s.lineHeight, s.backgroundColor]
      })
      const before = await page.evaluate(typography)
      await page.addStyleTag({ content: 'body{color:#aa0000;font-family:monospace}p,li,th,td,pre,code,h1,h2,h3,h4,h5,h6,a,blockquote{color:#aa0000;font-family:monospace;line-height:1;background-color:#ffff00}' })
      const after = await page.evaluate(typography)
      const hostStyleDifferences = before.flatMap((entry, index) => JSON.stringify(entry) === JSON.stringify(after[index]) ? [] : [{ index, before: entry, after: after[index] }])
      if (hostStyleDifferences.length) throw new Error(`${theme}/${width}: host style changed typography ${JSON.stringify(hostStyleDifferences)}`)
      results.push({ theme, width, contentHash: preview.contentHash, ...metrics, remoteRequests, hostStyleDifferences })
      await page.close()
    }
  }
  if (new Set(results.map(r => r.contentHash)).size !== themes.length) throw new Error('Theme hashes are not distinct')
  await writeFile(path.join(output, 'metrics.json'), JSON.stringify({ scope: 'local bundle only; no live service publication', results }, null, 2) + '\n')
  await writeFile(path.join(output, 'index.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Share Note 样式预览</title><style>body{font:16px/1.6 system-ui;margin:40px auto;max-width:960px;padding:0 20px;background:#f6f7f9;color:#202124}a{color:#6250b5}li{margin:12px 0}</style><h1>Share Note · ' + themes.length + ' 款文章样式</h1><p>同一份中英文验收文章。本地构建预览，尚未完成真实线上验收。</p><ul>' + themes.map(({id,name}) => `<li><a href="${id}.html">${name}</a> · <a href="${id}-1440.png">桌面截图</a> · <a href="${id}-375.png">窄屏截图</a></li>`).join('') + '</ul></html>')
  console.log(JSON.stringify({ output, screenshots: results.length, checks: 'passed', scope: 'local only' }))
} finally {
  await browser?.close()
  await rm(temporary, { recursive: true, force: true })
}
