/**
 * "Is Dango the active app?" across windows. Each window writes a shared localStorage flag
 * `{ id, at }` when it gains focus, refreshes `at` on a heartbeat while focused, and clears the flag on blur when the
 * flag is still its own. A flag older than ACTIVE_STALE_MS (a window that crashed or hung while focused) reads as
 * inactive.
 */

export const ACTIVE_WINDOW_KEY = 'dango.notify.active-window'
export const ACTIVE_HEARTBEAT_MS = 15_000
export const ACTIVE_STALE_MS = 45_000

type FlagStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

type Flag = { id: string; at: number }

export type ActiveWindowTracker = {
  setFocused(focused: boolean): void
  /** Refreshes this window's flag while it is focused; call every ACTIVE_HEARTBEAT_MS. */
  heartbeat(): void
  isActive(): boolean
}

function readFlag(storage: () => FlagStorage | null): Flag | null {
  try {
    const raw = storage()?.getItem(ACTIVE_WINDOW_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Flag> | null
    if (typeof parsed?.id !== 'string' || typeof parsed.at !== 'number' || !Number.isFinite(parsed.at)) return null
    return { id: parsed.id, at: parsed.at }
  } catch {
    return null
  }
}

export function createActiveWindowTracker(opts: {
  id: string
  storage: () => FlagStorage | null
  now: () => number
}): ActiveWindowTracker {
  let focused = false

  const write = () => {
    try {
      storage()?.setItem(ACTIVE_WINDOW_KEY, JSON.stringify({ id: opts.id, at: opts.now() } satisfies Flag))
    } catch {
      // Storage blocked: this window still knows its own focus.
    }
  }
  const storage = opts.storage

  return {
    setFocused(next) {
      focused = next
      if (next) {
        write()
        return
      }
      // Clear only our own flag; another window may already have taken focus.
      if (readFlag(storage)?.id !== opts.id) return
      try {
        storage()?.removeItem(ACTIVE_WINDOW_KEY)
      } catch {
        // ignore
      }
    },
    heartbeat() {
      if (focused) write()
    },
    isActive() {
      if (focused) return true
      const flag = readFlag(storage)
      if (!flag || flag.id === opts.id) return false
      const age = opts.now() - flag.at
      return age >= -ACTIVE_STALE_MS && age < ACTIVE_STALE_MS
    },
  }
}
