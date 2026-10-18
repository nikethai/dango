import { getLogger } from '@/lib/utils'
import { startReviewSync } from './review-sync'
import { refreshScopes, watchScopes } from './scopes'
import { ensureKnowledgeLoaded } from './store'

const log = getLogger('knowledge')

let started: Promise<void> | null = null

/** Once per window: loads knowledge, starts the Review sync and keeps the scope snapshot current. */
export function initKnowledge(): Promise<void> {
  if (started) return started
  startReviewSync()
  watchScopes()
  started = Promise.all([ensureKnowledgeLoaded(), refreshScopes()])
    .then(() => undefined)
    .catch((error) => {
      log.error('Knowledge init failed:', error)
    })
  return started
}
