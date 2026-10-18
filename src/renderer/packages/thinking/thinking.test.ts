import { describe, expect, it } from 'vitest'
import { formatDangoDuration } from '@/hooks/useThinkingTimer'
import { rollingSummary, thinkingOpenByDefault, thinkingStage } from './thinking'

describe('thinkingStage', () => {
  it('moves thinking -> still -> reassure at the thresholds', () => {
    expect(thinkingStage(7_999)).toBe('thinking')
    expect(thinkingStage(8_000)).toBe('still')
    expect(thinkingStage(29_999)).toBe('still')
    expect(thinkingStage(30_000)).toBe('reassure')
  })
})

describe('rollingSummary', () => {
  it('cleans markdown and truncates', () => {
    expect(rollingSummary('First idea\n\n## Checking the brief\n')).toBe('Checking the brief')
    expect(rollingSummary('Real line\n```ts')).toBe('Real line')
    expect(rollingSummary('> - **bold** step')).toBe('bold step')
    const long = rollingSummary('x'.repeat(400))
    expect(long).toHaveLength(120)
    expect(long.endsWith('…')).toBe(true)
    expect(rollingSummary('')).toBe('')
  })
})

describe('thinkingOpenByDefault', () => {
  it('follows the preference and scope kind', () => {
    expect(thinkingOpenByDefault('open', 'client')).toBe(true)
    expect(thinkingOpenByDefault('closed', 'project')).toBe(false)
    expect(thinkingOpenByDefault('auto', 'project')).toBe(true)
    expect(thinkingOpenByDefault('auto', 'client')).toBe(false)
    expect(thinkingOpenByDefault('auto', null)).toBe(true)
  })
})

describe('formatDangoDuration', () => {
  it('formats seconds and minutes', () => {
    expect(formatDangoDuration(0)).toBe('1 s')
    expect(formatDangoDuration(12_400)).toBe('12 s')
    expect(formatDangoDuration(72_000)).toBe('1 m 12 s')
    expect(formatDangoDuration(120_000)).toBe('2 m')
  })
})
