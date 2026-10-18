import type { ReviewEntry } from '@shared/types/review'
import { Fragment, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { reviewStore, useReviewEntries, useReviewRenderer, waitingCount } from '@/packages/review'
import { DefaultReviewRenderer } from './DefaultReviewRenderer'
import { dismissReviewEntry } from './dismissEntry'
import { clip, displayKind, groupByDay, nextFocusAfterRemoval, visibleEntries } from './feedSelectors'
import { useReviewKeys } from './useReviewKeys'
import './review-home.css'

export type ReviewFeedProps = { scopeId?: string; caughtUp?: ReactNode }

const CONTROLS = 'button, a[href], input, textarea, select'
const SAVED = 'data-feed-tabindex'
const KEYS = 'ArrowUp ArrowDown J K A E X Enter'

function FeedRowBody({ entry, focused }: { entry: ReviewEntry; focused: boolean }) {
  // A resolved row renders as Done, so a done knowledge row never gets slice 4's live Approve.
  const Renderer = useReviewRenderer({ kind: displayKind(entry), ref: entry.ref }) ?? DefaultReviewRenderer
  return <Renderer entry={entry} focused={focused} />
}

/** Leave one tab stop per row: controls in rows without focus get tabindex -1; the focused row gets its own back. */
function syncTabStops(rows: Map<string, HTMLElement>, focusedId: string | null) {
  for (const [id, row] of rows) {
    for (const el of Array.from(row.querySelectorAll<HTMLElement>(CONTROLS))) {
      if (id === focusedId) {
        const saved = el.getAttribute(SAVED)
        if (saved === null) continue
        if (saved === '') el.removeAttribute('tabindex')
        else el.setAttribute('tabindex', saved)
        el.removeAttribute(SAVED)
      } else if (!el.hasAttribute(SAVED)) {
        el.setAttribute(SAVED, el.getAttribute('tabindex') ?? '')
        el.setAttribute('tabindex', '-1')
      }
    }
  }
}

export function ReviewFeed({ scopeId, caughtUp }: ReviewFeedProps) {
  const { t } = useTranslation()
  const all = useReviewEntries()
  const visible = useMemo(() => visibleEntries(all, scopeId), [all, scopeId])
  const ids = useMemo(() => visible.map((e) => e.id), [visible])
  const groups = groupByDay(visible, Date.now())
  const nothingWaiting = waitingCount(visible) === 0

  const rootRef = useRef<HTMLDivElement>(null)
  const emptyRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef(new Map<string, HTMLElement>())
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const focusedRef = useRef(focusedId)
  focusedRef.current = focusedId

  const dismissFallback = useCallback(
    (id: string) => {
      const entry = reviewStore.getState().entries.find((e) => e.id === id)
      if (!entry) return
      dismissReviewEntry(id, t('Dismissed "{{text}}"', { text: clip(entry.text) })).catch((error: unknown) =>
        console.warn('[review] dismiss failed', error)
      )
    },
    [t]
  )
  const { onKeyDown } = useReviewKeys({ rowsRef, ids, focusedId, setFocusedId, dismissFallback })

  // When the focused row leaves (by key, by click, from another window), focus the row below, else above,
  // else the caught-up block. DOM focus moves only when it was in the feed (or fell to the body with the row).
  const prevIdsRef = useRef<string[]>([])
  const didInitialFocus = useRef(false)
  useLayoutEffect(() => {
    const prev = prevIdsRef.current
    prevIdsRef.current = ids
    const active = document.activeElement
    const focusIsOurs = !active || active === document.body || !!rootRef.current?.contains(active)

    if (!didInitialFocus.current && ids.length > 0) {
      didInitialFocus.current = true
      if (!active || active === document.body) rowsRef.current.get(ids[0])?.focus()
      return
    }

    const focused = focusedRef.current
    if (!focused || ids.includes(focused)) return
    const next = nextFocusAfterRemoval(prev, ids, focused)
    setFocusedId(next)
    if (!focusIsOurs) return
    if (next) rowsRef.current.get(next)?.focus()
    else emptyRef.current?.focus()
  }, [ids])

  // On focus change here; rows and controls added later are caught by the observer below.
  useLayoutEffect(() => {
    syncTabStops(rowsRef.current, focusedId)
  }, [focusedId])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new MutationObserver(() => syncTabStops(rowsRef.current, focusedRef.current))
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={rootRef} className="dango-review-feed">
      {nothingWaiting ? (
        <div ref={emptyRef} tabIndex={-1} data-testid="review-empty" className="dango-review-feed__empty">
          {caughtUp}
        </div>
      ) : null}
      {groups.map((group) => (
        <Fragment key={group.label}>
          <h2 className="dango-review-feed__day dg-type-caption">{t(group.label)}</h2>
          <ol className="dango-review-feed__list">
            {group.entries.map((entry) => (
              <li
                key={entry.id}
                tabIndex={0}
                data-entry-id={entry.id}
                aria-keyshortcuts={KEYS}
                className="dango-review-feed__row"
                ref={(el) => {
                  if (el) rowsRef.current.set(entry.id, el)
                  else rowsRef.current.delete(entry.id)
                }}
                onFocus={() => setFocusedId(entry.id)}
                onKeyDown={onKeyDown}
              >
                <FeedRowBody entry={entry} focused={entry.id === focusedId} />
              </li>
            ))}
          </ol>
        </Fragment>
      ))}
    </div>
  )
}
