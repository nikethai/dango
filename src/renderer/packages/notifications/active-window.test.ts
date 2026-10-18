import { describe, expect, test } from 'vitest'
import { ACTIVE_STALE_MS, ACTIVE_WINDOW_KEY, createActiveWindowTracker } from './active-window'

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

describe('createActiveWindowTracker', () => {
  test('active when either window is focused', () => {
    const storage = memoryStorage()
    let now = 1_000_000
    const main = createActiveWindowTracker({ id: 'main', storage: () => storage, now: () => now })
    const quick = createActiveWindowTracker({ id: 'quick', storage: () => storage, now: () => now })
    expect(main.isActive()).toBe(false)
    quick.setFocused(true)
    expect(main.isActive()).toBe(true)
    expect(quick.isActive()).toBe(true)
    now += 1_000
    quick.setFocused(false)
    expect(main.isActive()).toBe(false)
  })

  test('focus moving between windows keeps the app active', () => {
    const storage = memoryStorage()
    const now = 1_000_000
    const main = createActiveWindowTracker({ id: 'main', storage: () => storage, now: () => now })
    const quick = createActiveWindowTracker({ id: 'quick', storage: () => storage, now: () => now })
    main.setFocused(true)
    // The newly focused window can report before the old one blurs.
    quick.setFocused(true)
    main.setFocused(false)
    expect(main.isActive()).toBe(true)
  })

  test('a crashed window leaves a stale flag that reads as inactive', () => {
    const storage = memoryStorage()
    let now = 1_000_000
    const crashed = createActiveWindowTracker({ id: 'quick', storage: () => storage, now: () => now })
    const main = createActiveWindowTracker({ id: 'main', storage: () => storage, now: () => now })
    crashed.setFocused(true)
    now += ACTIVE_STALE_MS - 1
    expect(main.isActive()).toBe(true)
    now += 2
    expect(main.isActive()).toBe(false)
  })

  test('heartbeat keeps a focused window fresh', () => {
    const storage = memoryStorage()
    let now = 1_000_000
    const quick = createActiveWindowTracker({ id: 'quick', storage: () => storage, now: () => now })
    const main = createActiveWindowTracker({ id: 'main', storage: () => storage, now: () => now })
    quick.setFocused(true)
    now += ACTIVE_STALE_MS - 1
    quick.heartbeat()
    now += ACTIVE_STALE_MS - 1
    expect(main.isActive()).toBe(true)
  })

  test('garbage in the flag and throwing storage read as inactive', () => {
    const storage = memoryStorage()
    storage.map.set(ACTIVE_WINDOW_KEY, '{nope')
    const main = createActiveWindowTracker({ id: 'main', storage: () => storage, now: () => 1 })
    expect(main.isActive()).toBe(false)
    const throwing = createActiveWindowTracker({
      id: 'main',
      storage: () => {
        throw new Error('blocked')
      },
      now: () => 1,
    })
    throwing.setFocused(true)
    expect(throwing.isActive()).toBe(true)
    throwing.setFocused(false)
    expect(throwing.isActive()).toBe(false)
  })
})
