import { describe, expect, it } from 'vitest'
import { isWaitingToRetry, JOB_FIX_LABELS, parseJobs, RETRY_DELAYS_MS, retryDelayAfter } from './background'
import { parseSources } from './sources'

it('RETRY_DELAYS_MS matches the roadmap', () => {
  expect([...RETRY_DELAYS_MS]).toEqual([10_000, 60_000, 300_000])
})

describe('retryDelayAfter', () => {
  it('maps failed runs to the roadmap delays, then null', () => {
    expect(retryDelayAfter(1)).toBe(10_000)
    expect(retryDelayAfter(2)).toBe(60_000)
    expect(retryDelayAfter(3)).toBe(300_000)
    expect(retryDelayAfter(4)).toBeNull()
    expect(retryDelayAfter(0)).toBeNull()
  })
})

it('JOB_FIX_LABELS names the four fixes', () => {
  expect(JOB_FIX_LABELS).toEqual({
    reconnect: 'Sign in again',
    'relink-folder': 'Find the folder',
    'choose-model': 'Choose a model',
    'try-again': 'Try again',
  })
})

describe('parseSources', () => {
  const valid = { id: 's1', kind: 'folder', scopeId: 'p1', label: 'Docs', backgroundReview: true, connectedAt: 1 }
  const valid2 = { id: 's2', kind: 'gmail', scopeId: 'p1', label: 'Mail', connectedAt: 2 }

  it('drops invalid rows one by one', () => {
    expect(parseSources([valid, { id: 'x' }, valid2]).map((s) => s.id)).toEqual(['s1', 's2'])
  })

  it('defaults backgroundReview, localOnly and config', () => {
    const [source] = parseSources([valid2])
    expect(source.backgroundReview).toBe(false)
    expect(source.localOnly).toBe(false)
    expect(source.config).toEqual({})
  })

  it('returns [] for a non-array', () => {
    expect(parseSources('nope')).toEqual([])
  })
})

describe('parseJobs', () => {
  const old = { id: 'j1', scopeId: 'p1', kind: 'sync', label: 'Sync', status: 'done', attempts: 1, startedAt: 1 }

  it('parses a job saved before the new fields existed', () => {
    expect(parseJobs([old])).toEqual([old])
  })

  it('drops rows with an unknown status', () => {
    expect(parseJobs([old, { ...old, id: 'j2', status: 'weird' }]).map((j) => j.id)).toEqual(['j1'])
  })

  it('returns [] for a non-array', () => {
    expect(parseJobs({})).toEqual([])
  })
})

describe('isWaitingToRetry', () => {
  const job = (nextRetryAt?: number) =>
    ({
      id: 'j',
      scopeId: 's',
      kind: 'sync',
      label: 'x',
      status: 'running',
      attempts: 1,
      startedAt: 0,
      nextRetryAt,
    }) as const

  it('is true only while the next retry is still ahead', () => {
    expect(isWaitingToRetry(job(2000), 1000)).toBe(true)
    expect(isWaitingToRetry(job(1000), 1000)).toBe(false)
    expect(isWaitingToRetry(job(500), 1000)).toBe(false)
    expect(isWaitingToRetry(job(), 1000)).toBe(false)
  })
})
