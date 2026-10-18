import { EVERYWHERE_SCOPE_ID, everywhereDefaults, readsEverywhereFor, type Scope } from '@shared/types/scope'
import { t } from 'i18next'
import { getDefaultStore } from 'jotai'

// Synchronous scope reads for the knowledge package (preflight C2). The scope list lives in
// `myProjectsAtom`, which can hold a pending storage read after a reload, so it is never read
// synchronously here. Instead a snapshot is refreshed with `readScopes()` by `ensureKnowledgeLoaded()`
// (which `stream-text` awaits before each turn), by `initKnowledge()`, and by `watchScopes()`.
// The scope modules are imported lazily: they reach `@/storage` (and through it the platform) at load.

let snapshot: Scope[] = []

/** Re-reads the scope list into the snapshot. */
export async function refreshScopes(): Promise<void> {
  const { readScopes } = await import('@/hooks/useScopes')
  snapshot = await readScopes()
}

/** Keeps the snapshot in step with `myProjectsAtom` in this window. Returns the unsubscribe. */
export function watchScopes(): () => void {
  let stopped = false
  let unsub: (() => void) | undefined
  void import('@/hooks/useFolders').then(({ myProjectsAtom }) => {
    if (stopped) return
    unsub = getDefaultStore().sub(myProjectsAtom, () => {
      void refreshScopes().catch(() => undefined)
    })
  })
  return () => {
    stopped = true
    unsub?.()
  }
}

function findScope(scopeId: string): Scope | undefined {
  return snapshot.find((s) => s.id === scopeId)
}

/** `Everywhere`, the scope's name, or `Unknown scope`. */
export function scopeName(scopeId: string): string {
  if (scopeId === EVERYWHERE_SCOPE_ID) return t('Everywhere')
  return findScope(scopeId)?.name ?? t('Unknown scope')
}

/** Whether a scope reads Everywhere facts and documents. Everywhere and unknown scopes get the project defaults. */
export function getScopeReads(scopeId: string): { facts: boolean; documents: boolean } {
  const scope = scopeId === EVERYWHERE_SCOPE_ID ? undefined : findScope(scopeId)
  return scope ? readsEverywhereFor(scope) : everywhereDefaults('project')
}

export function _resetScopesForTests(): void {
  snapshot = []
}
