import { describe, expect, it } from 'vitest'
import { computeTrayStatus } from './tray-status'

const now = 1_700_000_000_000

describe('computeTrayStatus', () => {
  it('is idle when nothing waits', () => {
    const s = computeTrayStatus({ waiting: 0, paused: false, lastCheckedAt: now - 30_000, now })
    expect(s.mood).toBe('idle')
    expect(s.statusLine).toBe('Nothing needs you · checked just now')
  })

  it('needs-you with a plural count and minutes', () => {
    const s = computeTrayStatus({ waiting: 2, paused: false, lastCheckedAt: now - 5 * 60_000, now })
    expect(s.mood).toBe('needs-you')
    expect(s.statusLine).toBe('2 things need you · checked 5 min ago')
  })

  it('omits the checked part without a last check', () => {
    expect(computeTrayStatus({ waiting: 1, paused: false, now }).statusLine).toBe('1 thing needs you')
  })

  it('paused mood and resume label', () => {
    const s = computeTrayStatus({ waiting: 2, paused: true, now })
    expect(s.mood).toBe('paused')
    expect(s.statusLine.startsWith('Paused · 2 things need you')).toBe(true)
    expect(s.pauseLabel).toBe('Resume background work')
  })

  it('unpaused label, hours and tooltip', () => {
    const s = computeTrayStatus({ waiting: 0, paused: false, lastCheckedAt: now - 3 * 3_600_000, now })
    expect(s.pauseLabel).toBe('Pause background work')
    expect(s.statusLine).toContain('checked 3 h ago')
    expect(s.tooltip).toBe(`Dango · ${s.statusLine}`)
  })

  it('carries the menu labels', () => {
    expect(computeTrayStatus({ waiting: 0, paused: false, now }).menu).toEqual({
      openReview: 'Open Review',
      quickChat: 'Quick chat',
      openDango: 'Open Dango',
      quit: 'Quit Dango',
    })
  })

  it('reads 1 and 2 minutes', () => {
    expect(computeTrayStatus({ waiting: 0, paused: false, lastCheckedAt: now - 60_000, now }).statusLine).toContain(
      'checked 1 min ago'
    )
    expect(computeTrayStatus({ waiting: 0, paused: false, lastCheckedAt: now - 120_000, now }).statusLine).toContain(
      'checked 2 min ago'
    )
  })

  it('switches from minutes to hours at 60 minutes', () => {
    const at = (min: number) =>
      computeTrayStatus({ waiting: 0, paused: false, lastCheckedAt: now - min * 60_000, now }).statusLine
    expect(at(59)).toContain('checked 59 min ago')
    expect(at(60)).toContain('checked 1 h ago')
  })

  it('treats a future timestamp as just now', () => {
    expect(computeTrayStatus({ waiting: 0, paused: false, lastCheckedAt: now + 5 * 60_000, now }).statusLine).toBe(
      'Nothing needs you · checked just now'
    )
  })
})
