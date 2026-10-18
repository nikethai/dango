import type { ReviewEntry, ReviewRefType } from '@shared/types/review'
import { readTrustLevel, type TrustLevel } from '@shared/types/settings'
import { isArrivalCandidate, NEVER_AUTO_REFS, updateReviewEntry, updateReviewEntryIf } from './store'

export type ReviewApplier = { apply(e: ReviewEntry): Promise<void>; undo(e: ReviewEntry): Promise<void> }
type AppliableRefType = Exclude<ReviewRefType, 'proposal' | 'conflict' | 'knowledge'>

const NEVER_AUTO = NEVER_AUTO_REFS
const inFlight = new Set<string>()
const appliers = new Map<ReviewRefType, ReviewApplier>()
const applierListeners = new Set<() => void>()
const arrivals = new Map<string, string>()

function setApplier(refType: ReviewRefType, a: ReviewApplier | undefined): void {
  if (a) appliers.set(refType, a)
  else appliers.delete(refType)
  for (const cb of applierListeners) cb()
}

/** Calls `cb` whenever an applier is registered or removed, so rows can show Approve once slice 10 loads. */
export function subscribeReviewAppliers(cb: () => void): () => void {
  applierListeners.add(cb)
  return () => {
    applierListeners.delete(cb)
  }
}

// Lazy: the undo module touches localStorage at import, and the review barrel is imported by node-side code.
type UndoModule = typeof import('@/packages/undo')
let undoMod: UndoModule | undefined
async function loadUndo(): Promise<UndoModule> {
  undoMod ??= await import('@/packages/undo')
  return undoMod
}

/**
 * Settings are loaded lazily so importing the review package stays platform-free. Waits for settings to hydrate
 * (memoised), so an early background arrival never reads the default Auto over a stored Ask first.
 */
export async function getTrustLevel(): Promise<TrustLevel> {
  const { settingsStore, initSettingsStore } = await import('@/stores/settingsStore')
  await initSettingsStore()
  return readTrustLevel(settingsStore.getState().trustLevel)
}

export function registerReviewApplier(refType: AppliableRefType, a: ReviewApplier): () => void {
  if (NEVER_AUTO.includes(refType)) throw new Error(`No applier may be registered for "${refType}" (ADR 0001)`)
  setApplier(refType, a)
  return () => {
    if (appliers.get(refType) === a) setApplier(refType, undefined)
  }
}

/**
 * Test seam: installs an applier without the register guard, to prove the arrival guards hold on their own.
 * Not in the package barrel; tests import it from `./trust`.
 */
export function setReviewApplierForTests(refType: ReviewRefType, a: ReviewApplier | undefined): void {
  setApplier(refType, a)
}

export function getReviewApplier(refType: ReviewRefType): ReviewApplier | undefined {
  return appliers.get(refType)
}

/** The fields an apply acts on; if any changed while `apply` ran (a merge), the stored row is not what was applied. */
function sameAction(a: ReviewEntry, b: ReviewEntry): boolean {
  const pick = (e: ReviewEntry) =>
    JSON.stringify([e.ref, e.text, e.sub, e.actionLabel, e.options, e.risk, e.scopeId, e.source])
  return pick(a) === pick(b)
}

/**
 * Applies the entry, marks its row Done, and pushes a silent-or-toast undo record. Returns false when no applier is
 * registered, `apply` throws, another apply for the same row is running in this window, or the row stopped being the
 * open proposal that was applied while `apply` ran. In the last case the action is undone (best effort) when the row
 * was dismissed, removed or changed (a merge), but never when it is already Done: another window's apply won, and
 * undoing ours would revert the effect that row now reports. If only the undo record fails, the row stays Done and
 * this returns true, so callers agree with the stored row (it just has no Undo).
 */
export async function applyReviewEntry(
  entry: ReviewEntry,
  opts: { silent: boolean; message?: string; now?: number }
): Promise<boolean> {
  if (NEVER_AUTO.includes(entry.ref.type)) return false
  const applier = appliers.get(entry.ref.type)
  if (!applier) return false
  if (inFlight.has(entry.id)) return false
  inFlight.add(entry.id)
  try {
    try {
      await applier.apply(entry)
    } catch (error) {
      console.warn('[review] apply failed', error)
      return false
    }
    let undoMs: number
    let pushUndo: UndoModule['pushUndo']
    let marked: { ok: boolean; prev?: ReviewEntry }
    try {
      ;({ pushUndo, DEFAULT_UNDO_MS: undoMs } = await loadUndo())
      const now = opts.now ?? Date.now()
      marked = await updateReviewEntryIf(
        entry.id,
        (e) => e.state === 'open' && e.kind === 'proposal' && sameAction(e, entry),
        { kind: 'done', state: 'done', undoUntil: now + undoMs, resolvedAt: now }
      )
    } catch (error) {
      console.warn('[review] applied, but marking the row Done failed', error)
      return false
    }
    if (!marked.ok) {
      if (marked.prev?.state !== 'done') {
        await applier.undo(entry).catch((error) => console.warn('[review] undo of a superseded apply failed', error))
      }
      return false
    }
    try {
      const recordId = pushUndo({
        message: opts.message ?? '',
        silent: opts.silent,
        group: 'other',
        undo: async () => {
          await applier.undo(entry)
          await updateReviewEntry(entry.id, {
            kind: 'proposal',
            state: 'open',
            undoUntil: undefined,
            resolvedAt: undefined,
          })
        },
      })
      arrivals.set(entry.id, recordId)
    } catch (error) {
      console.warn('[review] applied and marked Done, but recording its undo failed', error)
    }
    return true
  } finally {
    inFlight.delete(entry.id)
  }
}

export async function arrive(entry: ReviewEntry, trust: TrustLevel, now: number): Promise<ReviewEntry> {
  if (trust !== 'auto' || !isArrivalCandidate(entry)) return entry
  const ok = await applyReviewEntry(entry, { silent: true, now })
  if (!ok) return entry
  const { DEFAULT_UNDO_MS } = await loadUndo()
  return { ...entry, kind: 'done', state: 'done', undoUntil: now + DEFAULT_UNDO_MS, resolvedAt: now }
}

export function canUndoArrival(entryId: string): boolean {
  const id = arrivals.get(entryId)
  if (!id) return false
  const live = !!undoMod && undoMod.canUndo(id)
  if (!live) arrivals.delete(entryId)
  return live
}

export async function undoArrival(entryId: string): Promise<boolean> {
  const id = arrivals.get(entryId)
  if (!id) return false
  const ok = await (await loadUndo()).undoEntry(id)
  if (ok) arrivals.delete(entryId)
  return ok
}
