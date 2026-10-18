import { beforeEach, describe, expect, it, vi } from 'vitest'

const setStoreValue = vi.fn(async (_key: string, _value: unknown) => {})

vi.mock('@/platform', () => ({
  default: {
    setStoreValue: (key: string, value: unknown) => setStoreValue(key, value),
    getStoreValue: vi.fn(async () => undefined),
    getStorageType: () => 'test',
  },
}))

import StoreStorage, { StorageKey } from './StoreStorage'

describe('StoreStorage write policy', () => {
  beforeEach(() => {
    setStoreValue.mockClear()
  })

  it.each([StorageKey.MyProjects, StorageKey.MyFolders])('writes %s immediately, not debounced', async (key) => {
    const storage = new StoreStorage()
    await storage.setItem(key, [{ id: 'p1' }])
    expect(setStoreValue).toHaveBeenCalledWith(key, [{ id: 'p1' }])
  })

  it('still debounces a non-critical key', async () => {
    const storage = new StoreStorage()
    await storage.setItem(StorageKey.MyCopilots, [])
    expect(setStoreValue).not.toHaveBeenCalled()
  })
})
