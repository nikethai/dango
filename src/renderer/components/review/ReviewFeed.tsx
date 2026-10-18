import type { ReviewEntry } from '@shared/types/review'
import {
  type FocusEvent,
  Fragment,
  type KeyboardEventHandler,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
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

type FeedRowProps = {
  entry: ReviewEntry
  focused: boolean
  rowsRef: RefObject<Map<string, HTMLElement>>
  onFocus(id: string): void
  onKeyDown: KeyboardEventHandler<HTMLElement>
}

function FeedRow({ entry, focused, rowsRef, onFocus, onKeyDown }: FeedRowProps) {
  // A resolved row renders as Done, so a done knowledge row never gets slice 4's live Approve.
  const Registered = useReviewRenderer({ kind: displayKind(entry), ref: entry.ref })
  const Renderer = Registered ?? DefaultReviewRenderer
  return (
    <li
      tabIndex={0}
      data-entry-id={entry.id}
      data-feed-default={Registered ? undefined : ''}
      aria-label={entry.text}
      aria-keyshortcuts={KEYS}
      className="dango-review-feed__row"
      ref={(el) => {
        if (el) rowsRef.current?.set(entry.id, el)
        else rowsRef.current?.delete(entry.id)
      }}
      onFocus={() => onFocus(entry.id)}
      onKeyDown={onKeyDown}
    >
      <Renderer entry={entry} focused={focused} />
    </li>
  )
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
  // The last row that held focus, kept after focus leaves the feed (which clears the ring) for the removal logic.
  const lastFocusedRef = useRef<string | null>(null)
  const onRowFocus = useCallback((id: string) => {
    lastFocusedRef.current = id
    setFocusedId(id)
  }, [])
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null
    if (!next || !rootRef.current?.contains(next)) setFocusedId(null)
  }

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

    const last = lastFocusedRef.current
    if (!last || ids.includes(last)) return
    // No surviving neighbour but rows remain (they were all replaced): the first row.
    const next = nextFocusAfterRemoval(prev, ids, last) ?? ids[0] ?? null
    lastFocusedRef.current = next
    if (!focusIsOurs) return
    setFocusedId(next)
    if (next) rowsRef.current.get(next)?.focus()
    else emptyRef.current?.focus()
  }, [ids])

  // A row that changes in place (Approve from its Edit field, an undo) can take the focused control with it, which
  // drops DOM focus to the body while the feed still shows the ring. Put focus back on the row so the keys keep working.
  // Clicking away clears `focusedId` first, so this never pulls focus back from outside. It runs after every render because the loss has no event of its own.
  useLayoutEffect(() => {
    const id = focusedRef.current
    const row = id ? rowsRef.current.get(id) : undefined
    const active = document.activeElement
    if (row && (!active || active === document.body)) row.focus()
  })

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
    <div ref={rootRef} className="dango-review-feed" onBlur={onBlur}>
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
              <FeedRow
                key={entry.id}
                entry={entry}
                focused={entry.id === focusedId}
                rowsRef={rowsRef}
                onFocus={onRowFocus}
                onKeyDown={onKeyDown}
              />
            ))}
          </ol>
        </Fragment>
      ))}
    </div>
  )
}
