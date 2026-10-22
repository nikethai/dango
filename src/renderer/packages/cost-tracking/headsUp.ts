/**
 * Cost heads-up (CS1): a rough price for the turn the user is about to send, checked before sending.
 * Never imported by generation or model calls — a run that has started is never interrupted.
 */

import { ModelProviderEnum } from '@shared/types/provider'
import { isLocalHost } from '@shared/utils/network_utils'
import { calculateCost, getModelPricing } from './calculator'
import type { PricingOverrides } from './types'

/** Output we assume when the chat sets no max output: a long answer, not the model's ceiling. */
export const DEFAULT_OUTPUT_TOKENS = 4_096

export type CostEstimateInput = {
  providerId: string
  modelId: string
  apiHost?: string
  inputTokens: number
  maxOutputTokens?: number
  /** Model calls this send makes (a Swarm room runs each agent more than once). */
  runs: number
}

const LOCAL_PROVIDERS = new Set<string>([ModelProviderEnum.Ollama, ModelProviderEnum.LMStudio])

/** Models on the user's own machine or network cost nothing per token. Not a privacy check (that is `isLocalModelIn`). */
export function isLocalModelProvider(providerId: string, apiHost?: string): boolean {
  if (LOCAL_PROVIDERS.has(providerId)) return true
  return !!apiHost && isLocalHost(apiHost)
}

/**
 * USD for the whole send, or null when the model has no price (never guess a dollar amount).
 * A rough upper guess: each run is priced as one model call at the uncached input price. Tool steps inside a run
 * (more calls) and prompt caching (cheaper input) are not counted.
 */
export function estimateTurnCostUsd(input: CostEstimateInput, overrides?: PricingOverrides): number | null {
  const pricing = getModelPricing(input.providerId, input.modelId, overrides)
  if (!pricing) return null
  const outputTokens = input.maxOutputTokens ?? DEFAULT_OUTPUT_TOKENS
  const { actualCost } = calculateCost(Math.max(0, input.inputTokens), Math.max(0, outputTokens), 0, pricing)
  return actualCost * Math.max(1, input.runs)
}

/** A limit of 0 turns the heads-up off; local and unpriced models never ask. */
export function shouldShowCostSheet(i: { estimateUsd: number | null; limitUsd: number; local: boolean }): boolean {
  if (i.local || i.limitUsd <= 0 || i.estimateUsd === null) return false
  return i.estimateUsd > i.limitUsd
}

export function formatUsdEstimate(usd: number): string {
  if (usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}
