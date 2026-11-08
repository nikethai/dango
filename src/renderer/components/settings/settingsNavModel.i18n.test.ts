import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

// Every sidebar label is passed through t(), so a label missing from a locale shows up in English there.
const navLabels = [
  ...new Set(
    [...read('src/renderer/components/settings/settingsNavModel.ts').matchAll(/\blabel:\s*(['"`])(.+?)\1/g)].map(
      (m) => m[2]
    )
  ),
]

describe('settings sidebar labels', () => {
  it('are found in settingsNavModel.ts', () => {
    expect(navLabels.length).toBeGreaterThan(20)
  })

  it.each(['ja', 'zh-Hans', 'zh-Hant'])('are all translated in %s', (locale) => {
    const translations: Record<string, unknown> = JSON.parse(
      read(`src/renderer/i18n/locales/${locale}/translation.json`)
    )
    const missing = navLabels.filter((label) => {
      const value = translations[label]
      return typeof value !== 'string' || value.trim() === ''
    })
    expect(missing).toEqual([])
  })
})
