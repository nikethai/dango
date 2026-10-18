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

describe('rollingSummary hardening', () => {
  it('never returns code inside fences', () => {
    expect(rollingSummary('Plan the fix\n```ts\nconst a = 1\n```')).toBe('Plan the fix')
    expect(rollingSummary('Plan the fix\n```ts\nconst a = 1')).toBe('Plan the fix')
    expect(rollingSummary('```ts\nconst a = 1\n```')).toBe('')
    expect(rollingSummary('```\ncode\n```\nAfter code')).toBe('After code')
  })
  it('keeps identifiers, strips emphasis at word boundaries', () => {
    expect(rollingSummary('read_file my_var')).toBe('read_file my_var')
    expect(rollingSummary('a *b* and _c_ and __d__')).toBe('a b and c and d')
    expect(rollingSummary('2 * 3 * 4')).toBe('2 * 3 * 4')
  })
  it('truncates by code points', () => {
    const out = rollingSummary(`${'a'.repeat(118)}😀😀😀`)
    expect(out).toBe(`${'a'.repeat(118)}😀…`)
    expect(rollingSummary(`${'a'.repeat(119)}😀😀`)).toBe(`${'a'.repeat(119)}…`)
  })
  it('handles links, rules, tables, task lists', () => {
    expect(rollingSummary('see [the docs](https://x.y/z) now')).toBe('see the docs now')
    expect(rollingSummary('Real\n---')).toBe('Real')
    expect(rollingSummary('Real\n***')).toBe('Real')
    expect(rollingSummary('Real\n| a | b |\n| --- | :-: |')).toBe('| a | b |')
    expect(rollingSummary('- [ ] todo')).toBe('todo')
    expect(rollingSummary('- [x] done')).toBe('done')
  })
  it('clamps maxChars and skips a bare ellipsis', () => {
    expect(rollingSummary('abcdef', 0)).toBe('a…')
    expect(rollingSummary('Real\n…')).toBe('Real')
  })
  it('handles CRLF and trims before the ellipsis', () => {
    expect(rollingSummary('one\r\ntwo\r\n')).toBe('two')
    expect(rollingSummary(`${'a'.repeat(118)} bbbbb`)).toBe(`${'a'.repeat(118)}…`)
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
    expect(formatDangoDuration(Number.NaN)).toBe('1 s')
    expect(formatDangoDuration(-5)).toBe('1 s')
    expect(formatDangoDuration(59_600)).toBe('1 m')
    expect(formatDangoDuration(119_600)).toBe('2 m')
  })
})
