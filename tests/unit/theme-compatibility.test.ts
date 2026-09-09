import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { themeCss } from '../../src/render/themes.js'

// Captured before adding the six themes: existing previews bind these exact CSS bytes.
describe('original theme compatibility', () => {
  it.each([
    ['simple', '848e83b7ae006f922fc332085a2aa7a76ac9592d5783797c8a778eff39324b18'],
    ['technical', '65464cbd1aa3e368a43893ff2e37247526d87b3d69cabeb9b2fd5e789880257d'],
    ['reading', 'e5518261c444d890fc635865e3d27ca74bdc34f7fa2cdd9487d84dde3232280c'],
    ['dark', 'a0eda215d26fb92496699a3134f6740964ea704d50530c4ab3d4d725e2255fac']
  ] as const)('preserves the %s CSS byte for byte', (theme, expected) => {
    expect(createHash('sha256').update(themeCss(theme)).digest('hex')).toBe(expected)
  })
})
