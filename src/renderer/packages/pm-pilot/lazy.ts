// Slice 10: the one pm-pilot module the app shell imports statically. It holds no code of the pilot itself, so web and
// mobile (where Gmail and Asana never sync) do not pull the pipeline, the Gmail and Asana clients or ofetch.

type PmPilotInit = { initPmReview: () => () => void; initPmQuestions: () => () => void }

/**
 * On desktop, loads the package and registers the draft applier and opener and the 'question' opener (preflight R10),
 * after whatever was registered synchronously before this call (the default question opener, which the pm one
 * replaces and falls back to). Returns the cleanup; a cleanup before the package loads registers nothing.
 */
export function initPmPilotLazily(
  isDesktop: boolean,
  load: () => Promise<PmPilotInit> = () => import('./index')
): () => void {
  if (!isDesktop) return () => undefined
  let cancelled = false
  let cleanup: (() => void) | undefined
  void load()
    .then((m) => {
      if (cancelled) return
      const offReview = m.initPmReview()
      const offQuestions = m.initPmQuestions()
      cleanup = () => {
        offQuestions()
        offReview()
      }
    })
    .catch((error: unknown) => {
      console.warn('[pm-pilot] Could not load the PM pilot:', error instanceof Error ? error.name : 'unknown')
    })
  return () => {
    cancelled = true
    cleanup?.()
    cleanup = undefined
  }
}
