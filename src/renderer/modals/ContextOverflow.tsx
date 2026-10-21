import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { IconAlertTriangle } from '@tabler/icons-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '@/components/ui/Sheet'
import { useSettingsStore } from '@/stores/settingsStore'

export type ContextOverflowAction = 'compact' | 'truncate' | 'continue'

export interface ContextOverflowModalProps {
  currentTokens: number
  thresholdTokens: number
  contextWindow: number
}

const ContextOverflowModal = NiceModal.create(
  ({ currentTokens, thresholdTokens, contextWindow }: ContextOverflowModalProps) => {
    const modal = useModal()
    const { t } = useTranslation()
    const { setSettings } = useSettingsStore((state) => state)
    const [rememberChoice, setRememberChoice] = useState(false)
    const usageLabelId = useId()

    const usagePercent = Math.min(Math.round((currentTokens / contextWindow) * 100), 100)
    const thresholdPercent = Math.min(Math.round((thresholdTokens / contextWindow) * 100), 100)

    const formatTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

    const handleAction = (action: ContextOverflowAction) => {
      if (rememberChoice && action !== 'continue') {
        setSettings({ contextOverflowBehavior: action === 'compact' ? 'auto-compact' : 'truncate' })
      }
      modal.resolve(action)
      modal.hide()
    }

    const handleClose = () => {
      // Dismiss without choosing → treat as "continue" so the send is not blocked
      modal.resolve('continue' as ContextOverflowAction)
      modal.hide()
    }

    const level = usagePercent >= 90 ? 'is-high' : 'is-near'

    // Esc, the scrim and Cancel dismiss without choosing; first focus is the primary action, Compact.
    return (
      <Sheet
        opened={modal.visible}
        onClose={handleClose}
        title={t('Context Window Nearly Full')}
        actions={
          <>
            <button type="button" className="dg-btn dg-btn--ghost" onClick={handleClose}>
              {t('Cancel')}
            </button>
            <button type="button" className="dg-btn" onClick={() => handleAction('continue')}>
              {t('Continue Anyway')}
            </button>
            <button type="button" className="dg-btn" onClick={() => handleAction('truncate')}>
              {t('Truncate Context')}
            </button>
            <button type="button" className="dg-btn dg-btn--primary" onClick={() => handleAction('compact')}>
              {t('Compact')}
            </button>
          </>
        }
      >
        <div className="dango-overflow">
          <p className="dg-type-body dango-overflow__warning">
            <IconAlertTriangle size={16} stroke={1.75} aria-hidden="true" className="dango-overflow__icon" />
            <span>
              {t(
                "The conversation context is approaching the model's token limit. Choose how to handle this to continue chatting."
              )}
            </span>
          </p>

          {/* Token usage */}
          <div className="dango-overflow__usage">
            <div className="dango-overflow__usage-head">
              <span id={usageLabelId} className="dg-type-caption">
                {t('Token Usage')}
              </span>
              <span className={`dg-type-caption dango-overflow__usage-value ${level}`}>
                {`${formatTokens(currentTokens)} / ${formatTokens(contextWindow)} (${usagePercent}%)`}
              </span>
            </div>
            <div
              className={`dango-overflow__meter ${level}`}
              role="progressbar"
              aria-labelledby={usageLabelId}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={usagePercent}
            >
              <span style={{ width: `${usagePercent}%` }} />
            </div>
            <span className="dg-type-caption">
              {t('Compaction threshold: {{threshold}}', {
                threshold: `${formatTokens(thresholdTokens)} (${thresholdPercent}%)`,
              })}
            </span>
          </div>

          {/* Remember choice */}
          <label className="dg-type-body dango-overflow__remember">
            <input
              type="checkbox"
              checked={rememberChoice}
              onChange={(e) => setRememberChoice(e.currentTarget.checked)}
            />
            <span>{t('Remember my choice and apply automatically next time')}</span>
          </label>
        </div>
      </Sheet>
    )
  }
)

export default ContextOverflowModal
