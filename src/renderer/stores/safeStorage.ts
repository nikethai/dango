import type { PersistStorage, StorageValue } from 'zustand/middleware'

const getBrowserStorage = (): Storage | undefined => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage
    }
  } catch {
    // ignore access errors
  }
  return undefined
}

/**
 * A `persist` storage that never throws. `onWriteError` hears a `setItem` that failed (quota full, storage blocked),
 * so a store can tell its caller the change was not saved.
 */
export function createSafeStorage(onWriteError?: (name: string, error: unknown) => void): PersistStorage<unknown> {
  return {
    getItem: <T>(name: string) => {
      const storage = getBrowserStorage()
      if (!storage) {
        return null
      }
      try {
        const value = storage.getItem(name)
        if (!value) {
          return null
        }
        return JSON.parse(value) as StorageValue<T>
      } catch {
        return null
      }
    },
    setItem: (name, value) => {
      const storage = getBrowserStorage()
      if (!storage) {
        return
      }
      try {
        storage.setItem(name, JSON.stringify(value))
      } catch (error) {
        // Never fail the caller; report it to the store when it asked.
        onWriteError?.(name, error)
      }
    },
    removeItem: (name) => {
      const storage = getBrowserStorage()
      if (!storage) {
        return
      }
      try {
        storage.removeItem(name)
      } catch {
        // ignore persistence errors so callers don't fail
      }
    },
  }
}

export const safeStorage: PersistStorage<unknown> = createSafeStorage()
