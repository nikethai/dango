import type { ReviewEntry } from '@shared/types/review'
import { startNewChat } from '@/lib/startNewChat'
import { hasReviewOpener, registerReviewOpener } from '@/packages/review'

/**
 * The default opener for a question row: a chat with the question prefilled. Registered once at app init (next to
 * `initKnowledge()` in `__root.tsx`) so `openReviewEntry` works from anywhere, not only while Review is mounted.
 * Leaves an opener that is already registered alone; slice 10 may replace it by registering its own later.
 * Returns the cleanup (a no-op when it registered nothing).
 */
export function registerDefaultQuestionOpener(): () => void {
  if (hasReviewOpener({ ref: { type: 'question' } } as ReviewEntry)) return () => {}
  return registerReviewOpener('question', (e) => startNewChat({ prefill: e.text, scopeId: e.scopeId }))
}
