import type { TrustLevel } from '@shared/types/settings'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '@/components/ui/Sheet'

export const TRUST_LABELS: Record<TrustLevel, string> = { auto: 'Auto', ask: 'Ask first' }

const OPTIONS: { level: TrustLevel; line: string; detail: string }[] = [
  {
    level: 'auto',
    line: 'Dango does safe things first and shows them in Review as Done, with Undo.',
    detail: 'Labels and Gmail drafts, never sent. Knowledge always waits for you.',
  },
  {
    level: 'ask',
    line: 'The same items wait in Review until you approve them.',
    detail: 'Nothing is applied until you press Approve.',
  },
]

export function TrustSheet(props: {
  opened: boolean
  value: TrustLevel
  onClose(): void
  onSave(level: TrustLevel): void
}) {
  const { opened, value, onClose, onSave } = props
  const { t } = useTranslation()
  const [choice, setChoice] = useState<TrustLevel>(value)
  const [seen, setSeen] = useState({ opened, value })
  if (seen.opened !== opened || seen.value !== value) {
    setSeen({ opened, value })
    if (opened) setChoice(value)
  }
  return (
    <Sheet
      opened={opened}
      onClose={onClose}
      title={t('Trust')}
      hint={t(
        'Always asks, whatever you choose: sending anything, deleting, editing files, changing a decision, saving knowledge. Applies to items that arrive from now on.'
      )}
      actions={
        <>
          <button type="button" className="dg-btn dg-btn--ghost" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="button" className="dg-btn dg-btn--primary" onClick={() => onSave(choice)}>
            {choice === 'auto' ? t('Use Auto') : t('Use Ask first')}
          </button>
        </>
      }
    >
      <div role="radiogroup" aria-label={t('Trust')} style={{ display: 'grid', gap: 'var(--dango-space-3)' }}>
        {OPTIONS.map((o) => (
          <label
            key={o.level}
            style={{ display: 'flex', gap: 'var(--dango-space-3)', alignItems: 'flex-start', cursor: 'pointer' }}
          >
            <input
              type="radio"
              style={{ accentColor: 'var(--dango-green)' }}
              name="trust-level"
              value={o.level}
              checked={choice === o.level}
              onChange={() => setChoice(o.level)}
            />
            <span>
              <span className="dg-type-body" style={{ display: 'block', fontWeight: 600 }}>
                {t(TRUST_LABELS[o.level])}
              </span>
              <span className="dg-type-body" style={{ display: 'block' }}>
                {t(o.line)}
              </span>
              <span className="dg-type-caption" style={{ display: 'block' }}>
                {t(o.detail)}
              </span>
            </span>
          </label>
        ))}
      </div>
    </Sheet>
  )
}
