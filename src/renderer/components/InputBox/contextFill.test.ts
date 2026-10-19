import { describe, expect, test } from 'vitest'
import { CONTEXT_WARN_RATIO, contextFillRatio, shouldWarnContextFill } from './contextFill'

describe('contextFillRatio', () => {
  test('just under 80% gives no notice', () => {
    expect(contextFillRatio(79_999, 100_000)).toBe(0.79999)
    expect(shouldWarnContextFill(contextFillRatio(79_999, 100_000))).toBe(false)
  })

  test('80% gives the notice', () => {
    expect(contextFillRatio(80_000, 100_000)).toBe(0.8)
    expect(CONTEXT_WARN_RATIO).toBe(0.8)
    expect(shouldWarnContextFill(contextFillRatio(80_000, 100_000))).toBe(true)
  })

  test('an unknown window or count gives no ratio', () => {
    expect(contextFillRatio(1, 0)).toBeNull()
    expect(contextFillRatio(undefined, 1)).toBeNull()
    expect(contextFillRatio(1, undefined)).toBeNull()
    expect(shouldWarnContextFill(null)).toBe(false)
  })
})
