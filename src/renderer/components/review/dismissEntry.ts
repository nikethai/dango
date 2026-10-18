import { setReviewEntryState } from '@/packages/review'

/**
 * Sets the row dismissed and pushes `message` as an undo toast whose undo reopens it.
 * Returns false (and pushes nothing) when no row was written.
 */
export async function dismissReviewEntry(id: string, message: string): Promise<boolean> {
  const next = await setReviewEntryState({ id }, 'dismissed')
  if (!next) return false
  // Lazy: the undo module touches localStorage at import time.
  const { pushUndo } = await import('@/packages/undo')
  pushUndo({ message, group: 'other', undo: async () => void (await setReviewEntryState({ id }, 'open')) })
  return true
}
