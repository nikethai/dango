import { t } from 'i18next'
import { type ReviewAction, ReviewItem } from '@/components/review'
import { getLogger } from '@/lib/utils'
import { openReviewEntry, type ReviewRendererProps, setReviewEntryState } from '@/packages/review'
import { reapproveKnowledge } from '../lifecycle'

const log = getLogger('knowledge')

/** A re-check: something an answer relied on changed. Knowledge entries offer Approve again. */
export function RecheckRenderer({ entry, focused }: ReviewRendererProps) {
  const open: ReviewAction = {
    label: t('Open'),
    onClick: () => void openReviewEntry(entry).catch((error) => log.error('Open failed:', error)),
  }
  const dismiss: ReviewAction = {
    label: t('Dismiss'),
    variant: 'ghost',
    onClick: () =>
      void setReviewEntryState({ id: entry.id }, 'dismissed').catch((e) => log.error('Dismiss failed:', e)),
  }
  const actions: ReviewAction[] =
    entry.ref.type === 'knowledge'
      ? [
          {
            label: t('Approve again'),
            variant: 'primary',
            onClick: () => void reapproveKnowledge(entry.ref.id).catch((e) => log.error('Approve again failed:', e)),
          },
          open,
          dismiss,
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
