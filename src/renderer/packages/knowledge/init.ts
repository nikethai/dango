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

/**
 * Re-reads knowledge whenever this window gains focus or becomes visible, so what another window approved
 * (or the memory move it finished) shows here too. Returns the unsubscribe.
 */
function watchWindowFocus(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined
  const reload = () => {
    ensureKnowledgeLoaded({ fresh: true }).catch((error) => log.error('Knowledge refresh failed:', error))
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') reload()
  }
  window.addEventListener('focus', reload)
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    window.removeEventListener('focus', reload)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

/**
 * Once per window: loads knowledge, starts the Review sync, registers the Review renderers, keeps the scope
 * snapshot current and re-reads knowledge on focus.
 */
export function initKnowledge(): Promise<void> {
  if (started) return started
  stops = [startReviewSync(), watchScopes(), registerKnowledgeRenderers(), watchWindowFocus()]
  // ensureKnowledgeLoaded also refreshes the scope snapshot.
  started = ensureKnowledgeLoaded().catch((error) => {
    log.error('Knowledge init failed:', error)
  })
  return started
}
