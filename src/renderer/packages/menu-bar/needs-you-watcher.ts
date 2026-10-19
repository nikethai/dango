import type { ReviewEntry } from '@shared/types/review'
import type { NotifyEvent } from '@/packages/notifications/types'
import { listReviewEntries, subscribeReviewEntries } from '@/packages/review'

const isOpenNeedsYou = (e: ReviewEntry) => e.kind === 'needs-you' && e.state === 'open'

/**
 * Calls `notify` once for each open Needs you entry that appears after the watcher starts. Entries already listed at
 * start are seen; so are entries created before the start that load later (the store may not have loaded yet), so a
 * reload never replays old entries. Proposals, Done items and anything else never notify. Returns a stop function.
 */
export function createNeedsYouWatcher(notify: (e: NotifyEvent) => void): () => void {
  const startedAt = Date.now()
  const seen = new Set(listReviewEntries().map((e) => e.id))
  return subscribeReviewEntries((entries) => {
    for (const e of entries) {
      if (seen.has(e.id)) continue
      seen.add(e.id)
      if (!isOpenNeedsYou(e) || e.createdAt < startedAt) continue
      notify({ kind: 'needs_you', entryId: e.id, text: e.text })
    }
  })
}
