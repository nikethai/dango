import i18next from 'i18next'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import en from '@/i18n/locales/en/translation.json'

vi.mock('@/packages/knowledge/migration', () => ({}))
vi.mock('@/components/ui/Sheet', () => ({ Sheet: () => null }))

const i18n = i18next.createInstance()
beforeAll(async () => {
  await i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
})

describe('movedNotesMessage', () => {
  it('pluralises the Everywhere count and translates the prompts count on its own', async () => {
    const { movedNotesMessage } = await import('./MemoryMigrationSheet')
    const t = i18n.t.bind(i18n) as (key: string, vars?: Record<string, string | number>) => string
    expect(movedNotesMessage(t, { everywhere: 2, prompts: 1 })).toBe(
      'Moved 2 notes to Everywhere and 1 to agent prompts'
    )
    expect(movedNotesMessage(t, { everywhere: 1, prompts: 3 })).toBe(
      'Moved 1 note to Everywhere and 3 to agent prompts'
    )

    const prompts = vi.fn(t)
    movedNotesMessage(prompts, { everywhere: 1, prompts: 3 })
    expect(prompts).toHaveBeenCalledWith('{{count}} to agent prompts', { count: 3 })
  })
})
