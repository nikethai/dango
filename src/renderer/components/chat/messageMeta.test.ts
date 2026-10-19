import { describe, expect, it } from 'vitest'
import { formatAnswerMeta, formatTokenCount } from './messageMeta'

describe('formatTokenCount', () => {
  it('counts one token, hundreds, and thousands with one decimal', () => {
    expect(formatTokenCount(1)).toBe('1 token')
    expect(formatTokenCount(840)).toBe('840 tokens')
    expect(formatTokenCount(1240)).toBe('1.2k tokens')
    expect(formatTokenCount(2000)).toBe('2k tokens')
  })
})

describe('formatAnswerMeta', () => {
  it('joins model, tokens and time with " · "', () => {
    expect(formatAnswerMeta({ model: 'GPT-5', usage: { totalTokens: 1240 }, durationMs: 8_200 })).toBe(
      'GPT-5 · 1.2k tokens · 8 s'
    )
  })

  it('shows only the parts that are present', () => {
    expect(formatAnswerMeta({ model: 'GPT-5' })).toBe('GPT-5')
  })

  it('adds input and output tokens when there is no total', () => {
    expect(formatAnswerMeta({ model: 'GPT-5', usage: { inputTokens: 300, outputTokens: 540 } })).toContain('840 tokens')
  })

  it('falls back to the output token count', () => {
    expect(formatAnswerMeta({ tokenCount: 12 })).toBe('12 tokens')
  })
})
