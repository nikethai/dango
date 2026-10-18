import type { ReviewEntry } from '@shared/types/review'
import { describe, expect, it } from 'vitest'
import {
  clip,
  displayKind,
  formatLastChecked,
  groupByDay,
  hasSources,
  nextFocusAfterRemoval,
  visibleEntries,
} from './feedSelectors'

const now = new Date(2026, 9, 17, 9, 0).getTime()

function entry(over: Partial<ReviewEntry> = {}): ReviewEntry {
  return {
    id: 'e1',
    kind: 'needs-you',
    scopeId: 'everywhere',
    text: 'Something',
    ref: { type: 'question', id: 'q1' },
    state: 'open',
    createdAt: now,
    ...over,
  }
}

const hm = (at: number) => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(at)
const dayMonth = (at: number) => new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(at)

describe('visibleEntries', () => {
  it('drops dismissed, filters by scope and sorts newest first', () => {
    const rows = [
      entry({ id: 'a', createdAt: 1 }),
      entry({ id: 'b', createdAt: 3 }),
      entry({ id: 'c', scopeId: 'p1', createdAt: 5 }),
      entry({ id: 'd', state: 'dismissed', createdAt: 9 }),
    ]
    expect(visibleEntries(rows, 'everywhere').map((e) => e.id)).toEqual(['b', 'a'])
    expect(visibleEntries(rows, 'p1').map((e) => e.id)).toEqual(['c'])
    expect(visibleEntries(rows).map((e) => e.id)).toEqual(['c', 'b', 'a'])
  })
})

describe('groupByDay', () => {
  it('splits at local midnight and omits empty groups', () => {
    const today = entry({ id: 't', createdAt: new Date(2026, 9, 17, 8, 0).getTime() })
    const yest = entry({ id: 'y', createdAt: new Date(2026, 9, 16, 23, 59).getTime() })
    const earlier = entry({ id: 'e', createdAt: new Date(2026, 9, 15, 12, 0).getTime() })
    expect(groupByDay([today, yest, earlier], now)).toEqual([
      { label: 'Today', entries: [today] },
      { label: 'Yesterday', entries: [yest] },
      { label: 'Earlier', entries: [earlier] },
    ])
    expect(groupByDay([earlier], now)).toEqual([{ label: 'Earlier', entries: [earlier] }])
    expect(groupByDay([], now)).toEqual([])
  })
})

describe('displayKind', () => {
  it('is done for a done proposal, else the kind', () => {
    expect(displayKind(entry({ kind: 'proposal', state: 'done' }))).toBe('done')
    expect(displayKind(entry({ kind: 'proposal' }))).toBe('proposal')
  })
})

describe('formatLastChecked', () => {
  it('formats today, yesterday and earlier', () => {
    const t = new Date(2026, 9, 17, 7, 5).getTime()
    const y = new Date(2026, 9, 16, 18, 30).getTime()
    const o = new Date(2026, 9, 3, 18, 30).getTime()
    expect(formatLastChecked(t, now)).toBe(`Last checked ${hm(t)}`)
    expect(formatLastChecked(y, now)).toBe(`Last checked yesterday at ${hm(y)}`)
    expect(formatLastChecked(o, now)).toBe(`Last checked ${dayMonth(o)}`)
  })
})

describe('hasSources', () => {
  it('uses sourceCount when given, else the stand-in', () => {
    expect(hasSources({ entries: [] })).toBe(false)
    expect(hasSources({ entries: [entry()] })).toBe(true)
    expect(hasSources({ entries: [], lastCheckedAt: 1 })).toBe(true)
    expect(hasSources({ sourceCount: 0, entries: [entry()] })).toBe(false)
    expect(hasSources({ sourceCount: 2, entries: [] })).toBe(true)
  })
})

describe('nextFocusAfterRemoval', () => {
  it('prefers the row below, then above, then null', () => {
    expect(nextFocusAfterRemoval(['a', 'b', 'c'], ['a', 'c'], 'b')).toBe('c')
    expect(nextFocusAfterRemoval(['a', 'b', 'c'], ['a', 'b'], 'c')).toBe('b')
    expect(nextFocusAfterRemoval(['a'], [], 'a')).toBeNull()
  })
})

describe('clip', () => {
  it('cuts at 60 characters plus an ellipsis', () => {
    expect(clip('x'.repeat(70))).toBe(`${'x'.repeat(60)}…`)
    expect(clip('x'.repeat(60))).toBe('x'.repeat(60))
  })
})
