import { describe, expect, it, vi } from 'vitest'

// StoreStorage reaches the platform when it loads; only its key names are used here.
vi.mock('@/platform', () => ({ default: {} }))

import { isDeviceOnlyKey, omitDeviceOnlyKeys } from './exportFilter'
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
})
