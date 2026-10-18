import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildSettingsNav } from './settingsNavModel'

const read = (rel: string) => readFileSync(join(__dirname, '../..', rel), 'utf8')

describe('Image studio placement', () => {
  it('Sidebar no longer offers the studio', () => {
    const sidebar = read('Sidebar.tsx')
    for (const needle of ["'/image-creator'", "t('Imagine')", "t('Image studio')", 'IconPhotoPlus']) {
      expect(sidebar).not.toContain(needle)
    }
  })

  it('the shortcut still opens the studio', () => {
    expect(read('hooks/useShortcut.tsx')).toContain("to: '/image-creator'")
  })

  it('Settings Advanced keeps an Image studio entry with every flag off', () => {
    const nav = buildSettingsNav({
      agents: false,
      mcp: false,
      knowledgeBase: false,
      hotkeys: false,
      devTools: false,
    })
    const entry = nav.advanced.find((e) => e.id === 'image-studio')
    expect(entry?.pages[0].to).toBe('/image-creator')
  })
})
