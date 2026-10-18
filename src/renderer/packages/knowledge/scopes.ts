import { EVERYWHERE_SCOPE_ID, everywhereDefaults, readsEverywhereFor, type Scope } from '@shared/types/scope'
import { t } from 'i18next'
import { getDefaultStore } from 'jotai'

// Synchronous scope reads for the knowledge package (preflight C2). The scope list lives in
// `myProjectsAtom`, which can hold a pending storage read after a reload, so it is never read
// synchronously here. Instead a snapshot is refreshed with `readScopes()` by `ensureKnowledgeLoaded()`
// (which `stream-text` awaits before each turn, and `initKnowledge()` runs) and by `watchScopes()`.
// The scope modules are imported lazily: they reach `@/storage` (and through it the platform) at load.

let snapshot: Scope[] = []
// Concurrent refreshes can finish out of order; a read never replaces one that started after it.
let started = 0
let applied = 0
let readOverride: (() => Promise<Scope[]>) | null = null

/** Tests: replace `readScopes()` (null restores it). */
export function _setScopeReaderForTests(read: (() => Promise<Scope[]>) | null): void {
  readOverride = read
}

/** Re-reads the scope list into the snapshot. */
export async function refreshScopes(): Promise<void> {
  const seq = ++started
  const scopes = await (readOverride ?? (await import('@/hooks/useScopes')).readScopes)()
  if (seq < applied) return
  applied = seq
  snapshot = scopes
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

/** Everywhere, or a scope in the snapshot. */
export function scopeExists(scopeId: string): boolean {
  return scopeId === EVERYWHERE_SCOPE_ID || findScope(scopeId) !== undefined
}

/** `Everywhere`, the scope's name, or `Unknown scope`. */
export function scopeName(scopeId: string): string {
  if (scopeId === EVERYWHERE_SCOPE_ID) return t('Everywhere')
  return findScope(scopeId)?.name ?? t('Unknown scope')
}

/**
 * Whether a scope reads Everywhere facts and documents. Everywhere gets the project defaults. An unknown
 * scope gets the client defaults, so it never reads Everywhere documents it may not be allowed to.
 */
export function getScopeReads(scopeId: string): { facts: boolean; documents: boolean } {
  if (scopeId === EVERYWHERE_SCOPE_ID) return everywhereDefaults('project')
  const scope = findScope(scopeId)
  return scope ? readsEverywhereFor(scope) : everywhereDefaults('client')
}

export function _resetScopesForTests(): void {
  snapshot = []
  started = 0
  applied = 0
  readOverride = null
}
