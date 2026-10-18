process.env.TZ = 'America/New_York'

import { describe, expect, it } from 'vitest'
import { groupByDay } from './feedSelectors'

const entry = (id: string, createdAt: number) => ({
  id,
  kind: 'needs-you' as const,
  scopeId: 'everywhere',
  text: id,
  ref: { type: 'question' as const, id },
  state: 'open' as const,
  createdAt,
})

describe('groupByDay across a DST change', () => {
  it('treats yesterday as the previous local day when the clocks went forward', () => {
    // US clocks went forward on 8 March 2026, so the 9th starts 23 hours after the 8th.
    const now = new Date(2026, 2, 9, 9, 0).getTime()
    const early = entry('early', new Date(2026, 2, 8, 0, 30).getTime())
    const before = entry('before', new Date(2026, 2, 7, 23, 59).getTime())
    expect(groupByDay([early, before], now)).toEqual([
      { label: 'Yesterday', entries: [early] },
      { label: 'Earlier', entries: [before] },
    ])
  })
})
