import { isEverywhere } from '@shared/types/scope'
import { useEffect, useMemo, useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import { useScopes } from '@/hooks/useScopes'
import {
  applyReviewEntry,
  canUndoArrival,
  openReviewEntry,
  type ReviewRendererProps,
  undoArrival,
  useCanOpenReviewEntry,
  useReviewApplier,
} from '@/packages/review'
import { defaultActions } from './defaultActions'
import { dismissReviewEntry } from './dismissEntry'
import { clip, displayKind } from './feedSelectors'
import { ReviewItem } from './ReviewItem'

const warn = (what: string) => (error: unknown) => console.warn(`[review] ${what} failed`, error)

/**
 * Renders the entry it is given; the feed passes the live row and re-renders it on change, so this subscribes to
 * nothing but the opener and applier registries (which change when slices load late).
 */
export function DefaultReviewRenderer({ entry, focused }: ReviewRendererProps) {
  const { t } = useTranslation()
  const { getScope } = useScopes()
  const [, rerender] = useReducer((n: number) => n + 1, 0)

  // Undo goes away when the window closes: re-render once at expiry.
  const { undoUntil } = entry
  useEffect(() => {
    if (undoUntil === undefined) return
    const wait = undoUntil - Date.now()
    if (wait <= 0) return
    const timer = setTimeout(rerender, wait)
    return () => clearTimeout(timer)
  }, [undoUntil])

  const canOpen = useCanOpenReviewEntry(entry)
  const canApply = !!useReviewApplier(entry.ref.type) && displayKind(entry) === 'proposal' && entry.state === 'open'
  const canUndo = canUndoArrival(entry.id) && entry.undoUntil !== undefined && entry.undoUntil > Date.now()

  const actions = useMemo(
    () =>
      defaultActions(
        entry,
        {
          open: () => void openReviewEntry(entry).catch(warn('open')),
          undo: () => void undoArrival(entry.id).catch(warn('undo')).finally(rerender),
          approve: () =>
            void applyReviewEntry(entry, {
              silent: false,
              message: t('Done: "{{text}}"', { text: clip(entry.text) }),
            })
              .catch(warn('apply'))
              .finally(rerender),
          dismiss: () =>
            void dismissReviewEntry(entry.id, t('Dismissed "{{text}}"', { text: clip(entry.text) })).catch(
              warn('dismiss')
            ),
        },
        { canOpen, canUndo, canApply }
      ).map((a) => ({ ...a, label: t(a.label) })),
    [entry, canOpen, canUndo, canApply, t]
  )

  const scope = isEverywhere(entry.scopeId) ? t('Everywhere') : (getScope(entry.scopeId)?.name ?? t('Unknown scope'))
  return (
    <ReviewItem
      kind={displayKind(entry)}
      scope={scope}
      source={entry.source}
      text={entry.text}
      sub={entry.sub}
      actions={actions}
      focused={focused}
    />
  )
}
