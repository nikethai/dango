import type { ReviewEntry, ReviewRefType } from '@shared/types/review'
import { readTrustLevel, type TrustLevel } from '@shared/types/settings'
import { isArrivalCandidate, NEVER_AUTO_REFS, updateReviewEntry, updateReviewEntryIf } from './store'

export type ReviewApplier = { apply(e: ReviewEntry): Promise<void>; undo(e: ReviewEntry): Promise<void> }
type AppliableRefType = Exclude<ReviewRefType, 'proposal' | 'conflict' | 'knowledge'>

const NEVER_AUTO = NEVER_AUTO_REFS
const inFlight = new Set<string>()
const appliers = new Map<ReviewRefType, ReviewApplier>()
const arrivals = new Map<string, string>()

// Lazy: the undo module touches localStorage at import, and the review barrel is imported by node-side code.
type UndoModule = typeof import('@/packages/undo')
let undoMod: UndoModule | undefined
async function loadUndo(): Promise<UndoModule> {
  undoMod ??= await import('@/packages/undo')
  return undoMod
}

/** Settings are loaded lazily so importing the review package stays platform-free. */
export async function getTrustLevel(): Promise<TrustLevel> {
  const { settingsStore } = await import('@/stores/settingsStore')
  return readTrustLevel(settingsStore.getState().trustLevel)
}

export function registerReviewApplier(refType: AppliableRefType, a: ReviewApplier): () => void {
  if (NEVER_AUTO.includes(refType)) throw new Error(`No applier may be registered for "${refType}" (ADR 0001)`)
  appliers.set(refType, a)
  return () => {
    if (appliers.get(refType) === a) appliers.delete(refType)
  }
}

/** Test seam: installs an applier without the register guard, to prove the arrival guards hold on their own. */
export function setReviewApplierForTests(refType: ReviewRefType, a: ReviewApplier | undefined): void {
  if (a) appliers.set(refType, a)
  else appliers.delete(refType)
}

export function getReviewApplier(refType: ReviewRefType): ReviewApplier | undefined {
  return appliers.get(refType)
}

/**
 * Applies the entry, marks its row Done, and pushes a silent-or-toast undo record. Returns false, changing nothing,
 * when no applier is registered, `apply` throws, another apply for the same row is running, or the row stopped
 * being an open proposal while `apply` ran (then the action is undone, best effort).
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
    try {
      const { pushUndo, DEFAULT_UNDO_MS } = await loadUndo()
      const now = opts.now ?? Date.now()
      const marked = await updateReviewEntryIf(entry.id, (e) => e.state === 'open' && e.kind === 'proposal', {
        kind: 'done',
        state: 'done',
        undoUntil: now + DEFAULT_UNDO_MS,
        resolvedAt: now,
      })
      if (!marked) {
        await applier.undo(entry).catch((error) => console.warn('[review] undo of a superseded apply failed', error))
        return false
      }
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
      return true
    } catch (error) {
      console.warn('[review] applied, but recording it failed', error)
      return false
    }
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
