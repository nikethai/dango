/**
 * In-memory progress of a background review whose cursor was not saved because a run failed: the items already
 * reviewed (ref → text), which a retry reads again and skips, and the proposals those attempts filed, which the
 * retry's Done entry still counts. Cleared once the cursor is saved, and when the source is removed.
 */
export type ReviewProgress = { reviewed: Map<string, string>; proposals: number }

const progress = new Map<string, ReviewProgress>()

/** The source's progress since its last saved cursor (created empty). */
export function reviewProgressFor(sourceId: string): ReviewProgress {
  let entry = progress.get(sourceId)
  if (!entry) {
    entry = { reviewed: new Map(), proposals: 0 }
    progress.set(sourceId, entry)
  }
  return entry
}

/** Drops the source's progress (its cursor was saved, or the source was removed). */
export function forgetReviewState(sourceId: string): void {
  progress.delete(sourceId)
}

export function _resetReviewStateForTests(): void {
  progress.clear()
}
