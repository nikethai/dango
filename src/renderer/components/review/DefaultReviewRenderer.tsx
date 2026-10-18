import { isEverywhere } from '@shared/types/scope'
import { useEffect, useMemo, useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import { useScopes } from '@/hooks/useScopes'
import {
  applyReviewEntry,
  canUndoArrival,
  getReviewApplier,
  hasReviewOpener,
  openReviewEntry,
  type ReviewRendererProps,
  setReviewEntryState,
  undoArrival,
  useReviewEntries,
} from '@/packages/review'
import { defaultActions } from './defaultActions'
import { clip, displayKind } from './feedSelectors'
import { ReviewItem } from './ReviewItem'

async function pushDismissUndo(message: string, reopen: () => Promise<unknown>) {
  const { pushUndo } = await import('@/packages/undo')
  pushUndo({ message, group: 'other', undo: async () => void (await reopen()) })
}

export function DefaultReviewRenderer({ entry: initial, focused }: ReviewRendererProps) {
  const { t } = useTranslation()
  const { getScope } = useScopes()
  const live = useReviewEntries().find((e) => e.id === initial.id)
  const entry = live ?? initial
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

  const canOpen = hasReviewOpener(entry)
  const canApply = !!getReviewApplier(entry.ref.type) && displayKind(entry) === 'proposal' && entry.state === 'open'
  const canUndo = canUndoArrival(entry.id) && entry.undoUntil !== undefined && entry.undoUntil > Date.now()

  const actions = useMemo(
    () =>
      defaultActions(
        entry,
        {
          open: () => void openReviewEntry(entry),
          undo: () => void undoArrival(entry.id).finally(rerender),
          approve: () =>
            void applyReviewEntry(entry, {
              silent: false,
              message: t('Done: "{{text}}"', { text: clip(entry.text) }),
            }).finally(rerender),
          dismiss: () =>
            void setReviewEntryState({ id: entry.id }, 'dismissed').then(() =>
              pushDismissUndo(t('Dismissed "{{text}}"', { text: clip(entry.text) }), () =>
                setReviewEntryState({ id: entry.id }, 'open')
              )
            ),
        },
        { canOpen, canUndo, canApply }
      ).map((a) => ({ ...a, label: t(a.label) })),
    [entry, canOpen, canUndo, canApply, t]
  )

  const scope = isEverywhere(entry.scopeId) ? t('Everywhere') : (getScope(entry.scopeId)?.name ?? '')
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
