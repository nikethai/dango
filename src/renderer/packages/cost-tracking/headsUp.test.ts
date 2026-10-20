import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OUTPUT_TOKENS,
  estimateTurnCostUsd,
  formatUsdEstimate,
  isLocalModelProvider,
  shouldShowCostSheet,
} from './headsUp'

describe('shouldShowCostSheet', () => {
  it('stays quiet for local models', () => {
    expect(shouldShowCostSheet({ estimateUsd: 5, limitUsd: 0.5, local: true })).toBe(false)
  })
  it('stays quiet when the limit is 0 (heads-up off)', () => {
    expect(shouldShowCostSheet({ estimateUsd: 5, limitUsd: 0, local: false })).toBe(false)
  })
  it('stays quiet when the model has no price', () => {
    expect(shouldShowCostSheet({ estimateUsd: null, limitUsd: 0.5, local: false })).toBe(false)
  })
  it('stays quiet at or under the limit', () => {
    expect(shouldShowCostSheet({ estimateUsd: 0.5, limitUsd: 0.5, local: false })).toBe(false)
    expect(shouldShowCostSheet({ estimateUsd: 0.2, limitUsd: 0.5, local: false })).toBe(false)
  })
  it('shows over the limit', () => {
    expect(shouldShowCostSheet({ estimateUsd: 0.51, limitUsd: 0.5, local: false })).toBe(true)
  })
})

describe('isLocalModelProvider', () => {
  it('treats Ollama, LM Studio and localhost hosts as local', () => {
    expect(isLocalModelProvider('ollama')).toBe(true)
    expect(isLocalModelProvider('lm-studio')).toBe(true)
    expect(isLocalModelProvider('custom', 'http://localhost:1234/v1')).toBe(true)
  })
  it('treats cloud providers as not local', () => {
    expect(isLocalModelProvider('openai')).toBe(false)
    expect(isLocalModelProvider('openai', 'https://api.openai.com/v1')).toBe(false)
  })
})

describe('estimateTurnCostUsd', () => {
  it('prices input plus output for every run', () => {
    const usd = estimateTurnCostUsd({
      providerId: 'openai',
      modelId: 'gpt-4o',
      inputTokens: 100_000,
      maxOutputTokens: 4_096,
      runs: 2,
    })
    expect(usd).toBeCloseTo(2 * (0.1 * 2.5 + 0.004096 * 10), 10)
  })
  it('uses DEFAULT_OUTPUT_TOKENS when no max output is set', () => {
    expect(DEFAULT_OUTPUT_TOKENS).toBe(4_096)
    const usd = estimateTurnCostUsd({ providerId: 'openai', modelId: 'gpt-4o', inputTokens: 100_000, runs: 1 })
    expect(usd).toBeCloseTo(0.1 * 2.5 + 0.004096 * 10, 10)
  })
  it('follows user price overrides', () => {
    const usd = estimateTurnCostUsd(
      { providerId: 'custom', modelId: 'my-model', inputTokens: 1_000_000, maxOutputTokens: 0, runs: 1 },
      { custom: { 'my-model': { input: 3, output: 6, cachedInput: 1 } } }
    )
    expect(usd).toBeCloseTo(3, 10)
  })
  it('returns null for an unknown model', () => {
    expect(
      estimateTurnCostUsd({ providerId: 'openai', modelId: 'no-such-model', inputTokens: 100_000, runs: 1 })
    ).toBeNull()
  })
})

describe('formatUsdEstimate', () => {
  it('rounds to cents', () => {
    expect(formatUsdEstimate(0.7321)).toBe('$0.73')
  })
  it('shows tiny amounts as under a cent', () => {
    expect(formatUsdEstimate(0.004)).toBe('<$0.01')
  })
})
