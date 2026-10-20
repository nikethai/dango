import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * A quiet line above the composer once a chat fills 80% of its model's context window: early messages may be left
 * out, and the fix is a new chat that starts from a summary (same model, same scope).
 */
export function ContextNearFullNotice(props: { ratio: number; onStartNewChat(): unknown }) {
  const { ratio, onStartNewChat } = props
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const pct = Math.min(100, Math.floor(ratio * 100))

  const start = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onStartNewChat()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dg-composer-notice dg-composer-notice--quiet" role="status">
      <p className="dg-composer-notice__text dg-type-caption">
        {t('This chat is {{pct}}% full. Early messages may be left out.', { pct })}
      </p>
      <div className="dg-composer-notice__actions">
        <button type="button" className="dg-btn dg-btn--ghost" disabled={busy} onClick={() => void start()}>
          {t('Start a new chat with a summary')}
        </button>
      </div>
    </div>
  )
}
