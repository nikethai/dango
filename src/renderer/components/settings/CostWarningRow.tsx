import { NumberInput } from '@mantine/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsPrefRow } from './SettingsPrefRow'

/** Empty, junk or non-finite keeps `previous`; negative becomes 0 (off); otherwise rounded to cents. */
export function normalizeCostWarning(input: string | number, previous: number): number {
  if (typeof input === 'string' && input.trim() === '') return previous
  const n = typeof input === 'number' ? input : Number(input)
  if (!Number.isFinite(n)) return previous
  if (n < 0) return 0
  return Math.round(n * 100) / 100
}

export function CostWarningRow({ value, onChange }: { value: number; onChange(next: number): void }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<string | number>(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  const commit = () => {
    const next = normalizeCostWarning(draft, value)
    setDraft(next)
    if (next !== value) onChange(next)
  }

  return (
    <SettingsPrefRow
      title={t('Ask before a costly run')}
      description={t(
        'Dango asks before a run whose estimate is over this amount. 0 turns it off. Local models never ask.'
      )}
      control={
        <NumberInput
          prefix="$"
          min={0}
          allowNegative={false}
          step={0.1}
          decimalScale={2}
          w={120}
          aria-label={t('Cost limit in US dollars')}
          value={draft}
          onChange={setDraft}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
          }}
        />
      }
    />
  )
}
