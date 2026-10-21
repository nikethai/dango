import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { IconTrash } from '@tabler/icons-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '@/components/ui/Sheet'
import { trackingEvent } from '@/packages/event'
import { useSessionList } from '@/stores/chatStore'
import { clearConversationList } from '@/stores/sessionActions'
import * as toastActions from '@/stores/toastActions'

/**
 * Product clean-up: pick how many newest chats to keep.
 * Small lists use chips; large lists use a calm slider (never a red “keep” control). A sheet (A11Y1 rule 4).
 */
const ClearSessionList = NiceModal.create(() => {
  const modal = useModal()
  const { t } = useTranslation()
  const { sessionMetaList } = useSessionList()
  const total = sessionMetaList?.length ?? 0

  /** Prefer keeping most recent; leave room to delete when list is non-trivial. */
  const defaultKeep = useMemo(() => {
    if (total <= 1) return total
    if (total <= 6) return Math.max(1, total - 1)
    if (total <= 40) return Math.min(20, Math.ceil(total * 0.6))
    if (total <= 120) return 50
    return 100
  }, [total])

  const [keepCount, setKeepCount] = useState(defaultKeep)
  const [submitting, setSubmitting] = useState(false)
  const keepLabelId = useId()

  useEffect(() => {
    setKeepCount(defaultKeep)
  }, [defaultKeep])

  useEffect(() => {
    trackingEvent('clear_conversation_list_window', { event_category: 'screen_view' })
  }, [])

  const keep = Math.min(total, Math.max(0, Math.floor(keepCount)))
  const remove = Math.max(0, total - keep)
  const canClean = total > 1 && remove > 0
  /** Chips feel better than a 0–2 slider for tiny libraries. */
  const useChips = total > 1 && total <= 8

  const chipOptions = useMemo(() => {
    if (!useChips) return [] as number[]
    // All, half-ish midpoints, and none — unique + sorted
    const set = new Set<number>([total, Math.max(1, Math.ceil(total / 2)), 1, 0])
    return Array.from(set)
      .filter((n) => n >= 0 && n <= total)
      .sort((a, b) => b - a)
  }, [total, useChips])

  const handleClose = () => {
    modal.resolve()
    modal.hide()
  }

  const clean = async () => {
    if (!canClean || submitting) return
    setSubmitting(true)
    try {
      await clearConversationList(keep)
      trackingEvent('clear_conversation_list', { event_category: 'user' })
      toastActions.add(
        keep === 0 ? t('All conversations deleted') : t('Deleted {{count}} older conversations', { count: remove })
      )
      handleClose()
    } catch (err) {
      toastActions.add(err instanceof Error ? err.message : t('Failed to clean up conversations'))
    } finally {
      setSubmitting(false)
    }
  }

  if (total <= 1) {
    return (
      <Sheet
        opened={modal.visible}
        onClose={handleClose}
        title={t('Clean up chats')}
        actions={
          <button type="button" className="dg-btn dg-btn--primary" onClick={handleClose}>
            {t('Done')}
          </button>
        }
      >
        <p className="dg-type-body dango-cleanup__text">
          {total === 0
            ? t('You have no conversations yet.')
            : t('You only have one conversation — nothing to clean up.')}
        </p>
      </Sheet>
    )
  }

  // Deleting chats is destructive: first focus is the safe action (Cancel), and Esc cancels.
  return (
    <Sheet
      opened={modal.visible}
      onClose={handleClose}
      title={t('Clean up chats')}
      actions={
        <>
          <button
            type="button"
            className="dg-btn dg-btn--ghost"
            data-autofocus
            onClick={handleClose}
            disabled={submitting}
          >
            {t('Cancel')}
          </button>
          <button
            type="button"
            className="dg-btn dg-btn--danger"
            onClick={() => void clean()}
            disabled={!canClean || submitting}
            aria-busy={submitting || undefined}
          >
            <IconTrash size={15} stroke={1.75} aria-hidden="true" />
            {keep === 0 ? t('Delete all') : t('Delete {{count}}', { count: remove })}
          </button>
        </>
      }
    >
      <div className="dango-cleanup">
        <p className="dg-type-body dango-cleanup__text">
          {t('Keep your newest chats. Older ones will be permanently deleted.', {
            total,
          })}
        </p>

        <p className="dg-type-caption dango-cleanup__count">{t('{{count}} conversations total', { count: total })}</p>

        <div className="dango-cleanup__keep">
          <div className="dango-cleanup__keep-head">
            <span id={keepLabelId} className="dg-type-body dango-cleanup__keep-label">
              {t('Keep newest')}
            </span>
            <span className="dg-type-body dango-cleanup__count">
              {keep === total ? t('All') : keep === 0 ? t('None') : t('{{count}} of {{total}}', { count: keep, total })}
            </span>
          </div>

          {useChips ? (
            <div className="dango-cleanup__chips" role="group" aria-labelledby={keepLabelId}>
              {chipOptions.map((n) => {
                const selected = keep === n
                const label = n === total ? t('All') : n === 0 ? t('None') : t('{{count}} newest', { count: n })
                return (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={selected}
                    className="dg-btn dango-cleanup__chip"
                    onClick={() => setKeepCount(n)}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="dango-cleanup__range">
              <input
                type="range"
                aria-labelledby={keepLabelId}
                min={0}
                max={total}
                step={1}
                value={keep}
                onChange={(e) => setKeepCount(Number(e.currentTarget.value))}
              />
              <div className="dg-type-caption dango-cleanup__marks" aria-hidden="true">
                <span>{t('None')}</span>
                <span>{t('All')}</span>
              </div>
            </div>
          )}
        </div>

        <div className={remove > 0 ? 'dango-cleanup__summary is-destructive' : 'dango-cleanup__summary'}>
          {remove > 0 ? (
            <>
              <p className="dg-type-body dango-cleanup__summary-title">
                {keep === 0
                  ? t('Delete all {{total}} conversations', { total })
                  : t('{{remove}} older chats will be deleted', { remove })}
              </p>
              <p className="dg-type-caption">
                {keep === 0
                  ? t('This cannot be undone.')
                  : t('Keeping {{keep}} newest. This cannot be undone.', { keep })}
              </p>
            </>
          ) : (
            <p className="dg-type-body dango-cleanup__text">
              {t('Select fewer chats to keep if you want to free space.')}
            </p>
          )}
        </div>
      </div>
    </Sheet>
  )
})

export default ClearSessionList
