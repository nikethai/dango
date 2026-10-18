import { getLogger } from '@/lib/utils'
import { registerKnowledgeRenderers } from './review/register'
import { startReviewSync } from './review-sync'
import { watchScopes } from './scopes'
import { ensureKnowledgeLoaded } from './store'

const log = getLogger('knowledge')

let started: Promise<void> | null = null
let stops: Array<() => void> = []

/** Undoes `initKnowledge` (listener, scope watch and Review renderers) so the next call starts again. */
export function _resetInitForTests(): void {
  for (const stop of stops) stop()
  stops = []
  started = null
}

/** Once per window: loads knowledge, starts the Review sync, registers the Review renderers and keeps the scope snapshot current. */
export function initKnowledge(): Promise<void> {
  if (started) return started
  stops = [startReviewSync(), watchScopes(), registerKnowledgeRenderers()]
  // ensureKnowledgeLoaded also refreshes the scope snapshot.
  started = ensureKnowledgeLoaded().catch((error) => {
    log.error('Knowledge init failed:', error)
  })
  return started
}
