import type { ReviewEntry, ReviewRefType } from '@shared/types/review'
import type { ComponentType } from 'react'
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useStore } from 'zustand'
import { lookupReviewRenderer, openerFor, type ReviewRendererProps, reviewRegistryStore } from './registry'
import { loadReviewEntries, reviewStore, waitingCount } from './store'
import { getReviewApplier, type ReviewApplier, subscribeReviewAppliers } from './trust'

/** Load review entries on mount, and again whenever this window regains focus or becomes visible. */
export function useReviewAutoload(): void {
  useEffect(() => {
    const reload = () => void loadReviewEntries().catch(() => undefined)
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload()
    }
    reload()
    window.addEventListener('focus', reload)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', reload)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
}

export function useReviewEntries(): ReviewEntry[] {
  useReviewAutoload()
  return useStore(reviewStore, (s) => s.entries)
}

export function useReviewWaitingCount(): number {
  useReviewAutoload()
  return useStore(reviewStore, (s) => waitingCount(s.entries))
}

export function useLastCheckedAt(): number | undefined {
  useReviewAutoload()
  return useStore(reviewStore, (s) => s.lastCheckedAt)
}

export function useReviewRenderer(
  entry: Pick<ReviewEntry, 'kind' | 'ref'>
): ComponentType<ReviewRendererProps> | undefined {
  return useStore(reviewRegistryStore, (s) => lookupReviewRenderer(s.renderers, entry))
}

/** Whether an opener is registered for `refType`; re-renders when one registers later (the default 'question' opener, slice 10). */
export function useHasReviewOpener(refType: ReviewRefType): boolean {
  return useStore(reviewRegistryStore, (s) => Boolean(s.openers[refType]))
}

/** Whether `entry` can be opened: an opener for its ref type that accepts it (`canOpen`). Re-renders on registration. */
export function useCanOpenReviewEntry(entry: ReviewEntry): boolean {
  return useStore(reviewRegistryStore, (s) => Boolean(openerFor(s.openers, entry)))
}

/** The applier registered for `refType`, re-rendering when slice 10 registers or removes one. */
export function useReviewApplier(refType: ReviewRefType): ReviewApplier | undefined {
  const get = useCallback(() => getReviewApplier(refType), [refType])
  return useSyncExternalStore(subscribeReviewAppliers, get, get)
}
