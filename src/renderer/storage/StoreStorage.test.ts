import { beforeEach, describe, expect, it, vi } from 'vitest'

const setStoreValue = vi.fn(async (_key: string, _value: unknown) => {})
const stored = new Map<string, unknown>()

vi.mock('@/platform', () => ({
  default: {
    setStoreValue: (key: string, value: unknown) => setStoreValue(key, value),
    getStoreValue: vi.fn(async (key: string) => (stored.has(key) ? stored.get(key) : null)),
    getStorageType: () => 'test',
  },
}))

import StoreStorage, { StorageKey, StorageKeyGenerator } from './StoreStorage'

describe('StoreStorage write policy', () => {
  beforeEach(() => {
    setStoreValue.mockClear()
  })

  it.each([StorageKey.MyProjects, StorageKey.MyFolders])('writes %s immediately, not debounced', async (key) => {
    const storage = new StoreStorage()
    await storage.setItem(key, [{ id: 'p1' }])
    expect(setStoreValue).toHaveBeenCalledWith(key, [{ id: 'p1' }])
  })

  it.each([StorageKey.Sources, StorageKey.BackgroundJobs, 'source-cursor:s1'])(
    'writes %s immediately, not debounced',
    async (key) => {
      const storage = new StoreStorage()
      await storage.setItem(key, { v: 1 })
      expect(setStoreValue).toHaveBeenCalledWith(key, { v: 1 })
    }
  )

  it.each([
    StorageKey.PmDrafts,
    StorageKey.PmQuestions,
    StorageKey.PmCursors,
    StorageKey.PmProcessed,
    StorageKey.PmDraftCount,
  ])('writes %s immediately, not debounced', async (key) => {
    const storage = new StoreStorage()
    await storage.setItem(key, [{ id: 'x' }])
    expect(setStoreValue).toHaveBeenCalledWith(key, [{ id: 'x' }])
  })

  it('pmRecords builds a namespaced key that stays debounced', async () => {
    expect(StorageKeyGenerator.pmRecords('acme')).toBe('pm:records:acme')
    const storage = new StoreStorage()
    await storage.setItem(StorageKeyGenerator.pmRecords('acme'), [])
    expect(setStoreValue).not.toHaveBeenCalled()
  })

  it('sourceCursor builds a namespaced key', () => {
    expect(StorageKeyGenerator.sourceCursor('abc')).toBe('source-cursor:abc')
  })

  it('still debounces a non-critical key', async () => {
    const storage = new StoreStorage()
    await storage.setItem(StorageKey.MyCopilots, [])
    expect(setStoreValue).not.toHaveBeenCalled()
  })
})

describe('StoreStorage readItem', () => {
  beforeEach(() => {
    setStoreValue.mockClear()
    stored.clear()
  })

  it('returns null for a missing key and writes nothing', async () => {
    const storage = new StoreStorage()
    expect(await storage.readItem(StorageKey.Knowledge)).toBeNull()
    expect(setStoreValue).not.toHaveBeenCalled()
  })

  it('returns the stored value as is', async () => {
    stored.set(StorageKey.Knowledge, { version: 1 })
    const storage = new StoreStorage()
    expect(await storage.readItem(StorageKey.Knowledge)).toEqual({ version: 1 })
    expect(setStoreValue).not.toHaveBeenCalled()
  })

  it('getItem still stores the default for a missing key', async () => {
    const storage = new StoreStorage()
    expect(await storage.getItem(StorageKey.MyCopilots, [])).toEqual([])
    expect(setStoreValue).toHaveBeenCalledWith(StorageKey.MyCopilots, [])
  })
})
