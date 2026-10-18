import { describe, expect, it } from 'vitest'
import { getCostWarningUsd, getShowThinking, scopeKindOf } from './chat-settings'

describe('chat settings accessors', () => {
  it('getShowThinking defaults to auto', () => {
    expect(getShowThinking({})).toBe('auto')
    expect(getShowThinking({ showThinking: 'loud' })).toBe('auto')
    expect(getShowThinking({ showThinking: 'closed' })).toBe('closed')
    expect(getShowThinking(null)).toBe('auto')
  })
  it('getCostWarningUsd defaults to 0.5', () => {
    expect(getCostWarningUsd({})).toBe(0.5)
    expect(getCostWarningUsd({ costWarningUsd: 0 })).toBe(0)
    expect(getCostWarningUsd({ costWarningUsd: -1 })).toBe(0.5)
    expect(getCostWarningUsd({ costWarningUsd: 'x' })).toBe(0.5)
  })
  it('scopeKindOf defaults to project', () => {
    expect(scopeKindOf({ kind: 'client' })).toBe('client')
    expect(scopeKindOf({})).toBe('project')
    expect(scopeKindOf(undefined)).toBe('project')
    expect(scopeKindOf(null)).toBe('project')
  })
})
