import { readTrustLevel, type TrustLevel } from '@shared/types/settings'
import { useNavigate } from '@tanstack/react-router'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TRUST_LABELS, TRUST_OPTIONS } from '@/components/settings/TrustSheet'
import { type FirstRunRecord, finishFirstRun } from '@/packages/first-run/firstRun'
import { settingsStore, useSettingsStore } from '@/stores/settingsStore'
import { FirstRunCard } from './FirstRunCard'

/**
 * FR4: how much Dango does on its own. Radio cards with TR1's lines (Auto first, recommended), the always-asks note and
 * Start, which saves the level, finishes first run and opens Review (FR5). An inline card, not the Trust sheet.
 */
export function TrustStep() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const noteId = useId()
  // trustLevel defaults to 'auto' (readTrustLevel), so Auto is checked unless the user picked Ask first before.
  const saved = useSettingsStore((s) => s.trustLevel)
  const [choice, setChoice] = useState<TrustLevel>(() => readTrustLevel(saved))
  const [busy, setBusy] = useState(false)
  const starting = useRef(false)

  const start = async () => {
    if (starting.current) return
    starting.current = true
    setBusy(true)
    const state = settingsStore.getState()
    state.setSettings({ trustLevel: choice })
    const record: FirstRunRecord = state.firstRun ?? { step: 4, sourceSkipped: false }
    await finishFirstRun(record, Date.now())
    void navigate({ to: '/', replace: true })
  }

  return (
    <FirstRunCard
      step={4}
      title={t('How much should it do on its own?')}
      footer={
        <button type="button" className="dg-btn dg-btn--primary" disabled={busy} onClick={() => void start()}>
          {t('Start')}
        </button>
      }
    >
      <div
        className="dg-first-run__trust"
        role="radiogroup"
        aria-label={t('How much should it do on its own?')}
        aria-describedby={noteId}
      >
        {TRUST_OPTIONS.map((o) => (
          <label
            key={o.level}
            className={choice === o.level ? 'dg-first-run__trust-option is-checked' : 'dg-first-run__trust-option'}
          >
            <input
              type="radio"
              name="first-run-trust"
              value={o.level}
              checked={choice === o.level}
              onChange={() => setChoice(o.level)}
            />
            <span className="dg-first-run__trust-text">
              <span className="dg-type-body dg-first-run__choice-title">
                {t(TRUST_LABELS[o.level])}
                {o.level === 'auto' ? ' ' : null}
                {o.level === 'auto' ? <span className="dg-first-run__recommended">{t('(recommended)')}</span> : null}
              </span>
              <span className="dg-type-body">{t(o.line)}</span>
              <span className="dg-type-caption dg-first-run__choice-line">{t(o.detail)}</span>
            </span>
          </label>
        ))}
      </div>
      <p id={noteId} className="dg-type-caption dg-first-run__note">
        {t(
          'Always asks, whatever you choose: sending anything, deleting, editing files, changing a decision, saving knowledge. Change this later under Settings → Memory and privacy.'
        )}
      </p>
    </FirstRunCard>
  )
}
