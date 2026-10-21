import { describe, expect, it, vi } from 'vitest'

// StoreStorage reaches the platform when it loads; only its key names are used here.
vi.mock('@/platform', () => ({ default: {} }))

import { isDeviceOnlyKey, omitDeviceOnlyKeys, settingsImportEntries, settingsImportMerge } from './exportFilter'
import { StorageKey, StorageKeyGenerator } from './StoreStorage'

const PM_KEYS = [
  StorageKey.PmCursors,
  StorageKey.PmDrafts,
  StorageKey.PmQuestions,
  StorageKey.PmProcessed,
  StorageKey.PmDraftCount,
  StorageKeyGenerator.pmRecords('acme'),
]

describe('settings export filter', () => {
  it('marks every PM pilot key as device-only', () => {
    for (const key of PM_KEYS) expect(isDeviceOnlyKey(key)).toBe(true)
    // Any later pm-* key is covered too.
    for (const key of Object.values(StorageKey).filter((k) => k.startsWith('pm-'))) {
      expect(isDeviceOnlyKey(key)).toBe(true)
    }
  })

  it('keeps ordinary keys', () => {
    for (const key of [StorageKey.Settings, StorageKey.ChatSessionsList, StorageKey.MyProjects, 'session:abc']) {
      expect(isDeviceOnlyKey(key)).toBe(false)
    }
  })

  it('leaves client mail and pilot state out of an export or an import', () => {
    const data: Record<string, unknown> = { [StorageKey.Settings]: { a: 1 }, 'session:s1': { id: 's1' } }
    for (const key of PM_KEYS) data[key] = [{ text: 'client mail' }]
    const result = omitDeviceOnlyKeys(data)
    expect(Object.keys(result).sort()).toEqual(['session:s1', StorageKey.Settings].sort())
    expect(JSON.stringify(result)).not.toContain('client mail')
  })

  it.each(['knowledge', 'knowledge-migration', 'sources', 'pm-records'])('%s never leaves or enters', (key) => {
    expect(isDeviceOnlyKey(key)).toBe(true)
  })

  it('settings and look-alike keys still travel', () => {
    expect(isDeviceOnlyKey('settings')).toBe(false)
    for (const key of ['knowledge-base', 'sources-list', 'knowledges']) expect(isDeviceOnlyKey(key)).toBe(false)
  })
})

describe('importing an old export', () => {
  // The shape an older build wrote: everything `storage.getAll()` returned, including a knowledge document that
  // did not parse (IndexedDB reads it as `null`), the migration record and the connected sources.
  const oldExport = (): Record<string, unknown> => ({
    [StorageKey.Settings]: { language: 'en', providers: {} },
    [StorageKey.ConfigVersion]: 18,
    [StorageKey.ChatSessionsList]: [{ id: 's-old', name: 'Old chat' }],
    'session:s-old': { id: 's-old', name: 'Old chat', messages: [] },
    [StorageKey.Knowledge]: null,
    [StorageKey.KnowledgeMigration]: { state: 'done', at: 1, counts: { everywhere: 9, prompts: 0, leftOut: 0 } },
    [StorageKey.Sources]: { version: 1, sources: [{ id: 'other-device-gmail', kind: 'gmail' }] },
    [StorageKey.PmDrafts]: [{ text: 'client mail' }],
    __exported_items: ['setting', 'conversation'],
    __exported_at: '2026-01-01T00:00:00.000Z',
  })
  const thisDevice = () => ({
    [StorageKey.Knowledge]: { version: 1, items: [{ id: 'mine' }] },
    [StorageKey.KnowledgeMigration]: { state: 'done', at: 5 },
    [StorageKey.Sources]: { version: 1, sources: [{ id: 'my-gmail', kind: 'gmail' }] },
    [StorageKey.ChatSessionsList]: [{ id: 's-mine', name: 'Mine' }],
  })
  const DEVICE_KEYS = [StorageKey.Knowledge, StorageKey.KnowledgeMigration, StorageKey.Sources]

  it('Settings > General writes nothing to knowledge, its migration record or sources', () => {
    const device: Record<string, unknown> = thisDevice()
    // general.tsx writes each entry with setItemNow.
    for (const [key, value] of settingsImportEntries(oldExport())) device[key] = value
    expect(device[StorageKey.Knowledge]).toEqual(thisDevice()[StorageKey.Knowledge])
    expect(device[StorageKey.KnowledgeMigration]).toEqual(thisDevice()[StorageKey.KnowledgeMigration])
    expect(device[StorageKey.Sources]).toEqual(thisDevice()[StorageKey.Sources])
    const written = settingsImportEntries(oldExport()).map(([key]) => key)
    for (const key of DEVICE_KEYS) expect(written).not.toContain(key)
    expect(written.sort()).toEqual(['session:s-old', StorageKey.Settings].sort())
  })

  it('the legacy dialog writes nothing to knowledge, its migration record or sources, not even back', () => {
    // AdvancedSettingTab.tsx passes the merge to setAll, which writes key by key; a key it leaves out is untouched.
    const merged = settingsImportMerge(thisDevice(), oldExport())
    for (const key of DEVICE_KEYS) expect(Object.keys(merged)).not.toContain(key)
    expect(JSON.stringify(merged)).not.toContain('client mail')
    expect(merged[StorageKey.Settings]).toEqual(oldExport()[StorageKey.Settings])
    expect((merged[StorageKey.ChatSessionsList] as { id: string }[]).map((s) => s.id)).toEqual(['s-mine', 's-old'])
  })

  it('an export leaves them out', () => {
    const exported = omitDeviceOnlyKeys({ ...thisDevice(), [StorageKey.Settings]: { language: 'en' } })
    expect(Object.keys(exported).sort()).toEqual([StorageKey.ChatSessionsList, StorageKey.Settings].sort())
  })
})
