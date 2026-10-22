import type { ConnectedSource } from '@shared/types/sources'
import { getSource, isRemovalPending, revokeSource, updateSource } from './store'

/*
 * A removed source waits out a 5 s undo window before it is revoked (S11, TASK-22). `revokeSource` is async (keychain,
 * folder bindings) and cannot finish inside `beforeunload` or a close handler, so the pending removal is stored on the
 * source (`removalPendingAt`) instead, and the main window's launch and due checks finish it (`finishPendingRemovals`,
 * before any due job starts). While pending, the source is hidden from lists and lookups (`isRemovalPending`) and no
 * job of it starts or goes on. Removal and Undo happen in the jobs window only, which is also where the checks run.
 */

/** The undo window of a removed source. */
export const REMOVE_DELAY_MS = 5_000

// Undos whose write has not landed yet: a check that runs meanwhile, from a list read before, leaves them alone.
const cancelling = new Set<string>()

/** Stores that the user removed this source at `at`. Unreadable storage is logged by the store, not thrown. */
export async function markRemovalPending(id: string, at: number): Promise<void> {
  cancelling.delete(id)
  await updateSource(id, { removalPendingAt: at })
}

/** Undo: the source is listed and worked on again, as before the removal. */
export async function cancelRemovalPending(id: string): Promise<void> {
  cancelling.add(id)
  try {
    await updateSource(id, { removalPendingAt: undefined })
  } finally {
    cancelling.delete(id)
  }
}

/**
 * Revokes each of `sources` whose removal has been pending at least `REMOVE_DELAY_MS` at `now`, one at a time. Each is
 * checked again against this window's current row first, so an Undo (or a newer removal) since `sources` was read
 * wins. A failed revoke is logged; the source stays pending (hidden, no jobs) and is retried at the next check.
 */
export async function finishPendingRemovals(sources: ConnectedSource[], now: number): Promise<void> {
  for (const listed of sources) {
    if (!isDue(listed, now)) continue
    const current = getSource(listed.id, { includePending: true })
    if (!current || !isDue(current, now) || cancelling.has(listed.id)) continue
    try {
      await revokeSource(listed.id)
    } catch (error) {
      console.warn('[sources] Could not finish a pending removal; trying again at the next check', error)
    }
  }
}

function isDue(source: ConnectedSource, now: number): boolean {
  return isRemovalPending(source) && now - (source.removalPendingAt as number) >= REMOVE_DELAY_MS
}
