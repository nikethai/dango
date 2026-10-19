import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '@/components/ui/Sheet'
import { getCostWarningUsd } from '@/packages/chat-settings'
import {
  type CostEstimateInput,
  DEFAULT_OUTPUT_TOKENS,
  estimateTurnCostUsd,
  formatUsdEstimate,
  isLocalModelProvider,
  shouldShowCostSheet,
} from '@/packages/cost-tracking/headsUp'
import type { PricingOverrides } from '@/packages/cost-tracking/types'
import { settingsStore } from '@/stores/settingsStore'

export type CostHeadsUpInput = CostEstimateInput & {
  /** Shown in the sheet; falls back to the model id. */
  modelName?: string
}

type Pending = {
  cost: string
  limit: string
  model: string
  tokens: string
  resolve: (run: boolean) => void
}

/**
 * CS1: before a send that may cost more than the user's limit, ask once. Run sends; Cancel or Esc keeps the draft.
 * Call `confirm` before sending only — never during a turn.
 */
export function useCostHeadsUp(): { confirm(input: CostHeadsUpInput): Promise<boolean>; sheet: ReactNode } {
  const { t } = useTranslation()
  const [pending, setPending] = useState<Pending | null>(null)
  const pendingRef = useRef<Pending | null>(null)

  const settle = useCallback((run: boolean) => {
    const current = pendingRef.current
    pendingRef.current = null
    setPending(null)
    current?.resolve(run)
  }, [])

  // A composer that goes away answers Cancel, so no send waits forever.
  useEffect(() => () => pendingRef.current?.resolve(false), [])

  const confirm = useCallback((input: CostHeadsUpInput): Promise<boolean> => {
    const settings = settingsStore.getState()
    const limitUsd = getCostWarningUsd(settings)
    const overrides = (settings as { usagePricingOverrides?: PricingOverrides }).usagePricingOverrides
    const estimateUsd = estimateTurnCostUsd(input, overrides)
    const local = isLocalModelProvider(input.providerId, input.apiHost)
    if (!shouldShowCostSheet({ estimateUsd, limitUsd, local })) return Promise.resolve(true)
    // A second ask replaces the first; the first one is a Cancel.
    pendingRef.current?.resolve(false)
    const runs = Math.max(1, input.runs)
    const tokens = (Math.max(0, input.inputTokens) + (input.maxOutputTokens ?? DEFAULT_OUTPUT_TOKENS)) * runs
    return new Promise<boolean>((resolve) => {
      const next: Pending = {
        cost: formatUsdEstimate(estimateUsd ?? 0),
        limit: formatUsdEstimate(limitUsd),
        model: input.modelName || input.modelId,
        tokens: tokens.toLocaleString(),
        resolve,
      }
      pendingRef.current = next
      setPending(next)
    })
  }, [])

  const sheet = (
    <Sheet
      opened={pending !== null}
      onClose={() => settle(false)}
      title={t('This run may cost about {{cost}}', { cost: pending?.cost ?? '' })}
      actions={
        <>
          <button type="button" className="dg-btn dg-btn--ghost" onClick={() => settle(false)}>
            {t('Cancel')}
          </button>
          <button type="button" className="dg-btn dg-btn--primary" onClick={() => settle(true)}>
            {t('Run')}
          </button>
        </>
      }
    >
      <p className="dg-type-body" style={{ margin: 0 }}>
        {t(
          '{{model}} · about {{tokens}} tokens. You asked to hear about runs over {{limit}}. Change the limit in Settings › Models and keys.',
          { model: pending?.model ?? '', tokens: pending?.tokens ?? '', limit: pending?.limit ?? '' }
        )}
      </p>
    </Sheet>
  )

  return { confirm, sheet }
}
