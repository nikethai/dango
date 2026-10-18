import { useTranslation } from 'react-i18next'
import { Mascot } from '@/components/brand/Mascot'
import { startNewChat } from '@/lib/startNewChat'
import { navigateToSettings } from '@/modals/Settings'
import platform from '@/platform'
import { lastCheckedParts } from './feedSelectors'
import './review-home.css'

export type ReviewEmptyProps = { variant: 'caught-up' | 'no-sources'; lastCheckedAt?: number }

/** RV5 (caught up) and EM2 (before any source). Headings are h2, like the day groups; the page title is not an h1. */
export function ReviewEmpty({ variant, lastCheckedAt }: ReviewEmptyProps) {
  const { t } = useTranslation()

  if (variant === 'caught-up') {
    const parts = lastCheckedAt === undefined ? undefined : lastCheckedParts(lastCheckedAt, Date.now())
    return (
      <section className="dango-review-empty">
        <Mascot state="done" size={56} />
        <h2 className="dango-review-empty__title dg-type-title-2">{t('Nothing needs you')}</h2>
        {parts ? <p className="dango-review-empty__line dg-type-body">{t(parts.key, { time: parts.time })}</p> : null}
      </section>
    )
  }

  return (
    <section className="dango-review-empty">
      <Mascot state="idle" size={56} />
      <h2 className="dango-review-empty__title dg-type-title-2">{t('Connect a source to get started')}</h2>
      <p className="dango-review-empty__line dg-type-body">
        {t('Dango reads a folder, Gmail or Asana and tells you here what needs you.')}
      </p>
      <div className="dango-review-empty__actions">
        <button type="button" className="dg-btn dg-btn--primary" onClick={() => navigateToSettings('/sources')}>
          {t('Connect a source')}
        </button>
        <button
          type="button"
          className="dg-btn"
          onClick={() => {
            if (platform.showQuickWindow) void platform.showQuickWindow()
            else startNewChat()
          }}
        >
          {t('Ask anything')}
        </button>
      </div>
    </section>
  )
}
