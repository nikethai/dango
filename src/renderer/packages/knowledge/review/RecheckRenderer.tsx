import { t } from 'i18next'
import { type ReviewAction, ReviewItem } from '@/components/review'
import { openReviewEntry, type ReviewRendererProps, setReviewEntryState } from '@/packages/review'
import { reapproveKnowledge } from '../lifecycle'
import { useGuarded } from './useGuarded'

/** A re-check: something an answer relied on changed. A knowledge entry offers only Approve again and Open. */
export function RecheckRenderer({ entry, focused }: ReviewRendererProps) {
  const { busy, run } = useGuarded()
  const open: ReviewAction = { label: t('Open'), disabled: busy, onClick: () => void run(() => openReviewEntry(entry)) }
  const dismiss: ReviewAction = {
    label: t('Dismiss'),
    variant: 'ghost',
    disabled: busy,
    onClick: () => void run(() => setReviewEntryState({ id: entry.id }, 'dismissed')),
  }
  const actions: ReviewAction[] =
    entry.ref.type === 'knowledge'
      ? [
          {
            label: t('Approve again'),
            variant: 'primary',
            disabled: busy,
            onClick: () => void run(() => reapproveKnowledge(entry.ref.id)),
          },
          open,
        ]
      : [open, dismiss]
  return (
    <ReviewItem
      kind={entry.kind}
      scope={entry.scopeId}
      text={entry.text}
      focused={focused}
      actions={actions}
      {...(entry.source !== undefined ? { source: entry.source } : {})}
      {...(entry.sub !== undefined ? { sub: entry.sub } : {})}
    />
  )
}
