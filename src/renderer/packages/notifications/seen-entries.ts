/**
 * Needs you entry ids already notified, shared by every tab and window of this origin through localStorage, so a
 * second web tab (each runs its own watcher) never notifies the same entry again. Capped and expiring; when storage
 * is blocked or holds garbage, the entry goes through (the per-window dedupe and the shared gap still apply).
 */

export const SEEN_ENTRIES_KEY = 'dango.notify.seen-entries'
const DEFAULT_MAX = 200
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000

type LedgerStorage = Pick<Storage, 'getItem' | 'setItem'>

export type SeenEntriesLedger = {
  /** True when this caller is the first to claim `entryId`; false when some tab already did. */
  claim(entryId: string): boolean
}

function read(storage: LedgerStorage): Array<[string, number]> {
  const raw = storage.getItem(SEEN_ENTRIES_KEY)
  if (!raw) return []
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) return []
  return parsed.filter(
    (p): p is [string, number] => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'number'
  )
}

export function createSeenEntriesLedger(opts: {
  storage: () => LedgerStorage | null
  now: () => number
  max?: number
  ttlMs?: number
}): SeenEntriesLedger {
  const max = opts.max ?? DEFAULT_MAX
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS
  return {
    claim(entryId) {
      try {
        const storage = opts.storage()
        if (!storage) return true
        const now = opts.now()
        const live = read(storage).filter(([, at]) => now - at < ttl)
        if (live.some(([id]) => id === entryId)) return false
        live.push([entryId, now])
        storage.setItem(SEEN_ENTRIES_KEY, JSON.stringify(live.slice(-max)))
        return true
      } catch {
        return true
      }
    },
  }
}
