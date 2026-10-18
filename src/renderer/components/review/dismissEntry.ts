import { updateReviewEntry, updateReviewEntryIf } from '@/packages/review'

/**
 * Sets the row dismissed and pushes `message` as an undo toast whose undo puts back exactly the state the row had
 * (a Done row comes back Done, with its `resolvedAt` and `undoUntil`; an open row comes back open).
 * Returns false (and pushes nothing) when no row was written.
 */
export async function dismissReviewEntry(id: string, message: string): Promise<boolean> {
  const { ok, prev } = await updateReviewEntryIf(id, (e) => e.state !== 'dismissed', {
    state: 'dismissed',
    resolvedAt: Date.now(),
  })
  if (!ok || !prev) return false
  const restore = { state: prev.state, resolvedAt: prev.resolvedAt, undoUntil: prev.undoUntil }
  // Lazy: the undo module touches localStorage at import time.
  const { pushUndo } = await import('@/packages/undo')
  pushUndo({ message, group: 'other', undo: async () => void (await updateReviewEntry(id, restore)) })
  return true
}
