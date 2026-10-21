import type { BackgroundJob } from '@shared/types/background'
import type { ConnectedSource } from '@shared/types/sources'
import { describe, expect, it } from 'vitest'
import { firstReadJob } from './firstRead'

const SOURCE: ConnectedSource = {
  id: 'src1',
  kind: 'folder',
  scopeId: 's1',
  label: 'dango',
  backgroundReview: true,
  localOnly: false,
  config: {},
  connectedAt: 1,
}

function job(patch: Partial<BackgroundJob>): BackgroundJob {
  return {
    id: 'j1',
    scopeId: 's1',
    kind: 'sync',
    label: 'Folder sync',
    status: 'running',
    attempts: 0,
    startedAt: 10,
    sourceId: 'src1',
    ...patch,
  }
}

const record = {
  step: 5,
  sourceSkipped: false,
  firstReadJobId: 'j1',
  firstReadSourceId: 'src1',
  completedAt: 5,
} as const

describe('firstReadJob', () => {
  it('is nothing without a first read job (skipped source, upgrade)', () => {
    expect(firstReadJob(undefined, [SOURCE], [job({})])).toBeUndefined()
    expect(firstReadJob({ step: 5, sourceSkipped: true, completedAt: 5 }, [SOURCE], [job({})])).toBeUndefined()
  })

  it('follows the first sync while it runs', () => {
    const sync = job({})
    expect(firstReadJob(record, [SOURCE], [sync])).toBe(sync)
  })

  it('is nothing when the sync is missing, failed or stopped', () => {
    expect(firstReadJob(record, [SOURCE], [])).toBeUndefined()
    expect(firstReadJob(record, [SOURCE], [job({ status: 'failed' })])).toBeUndefined()
    expect(firstReadJob(record, [SOURCE], [job({ status: 'failed', stoppedAt: 20 })])).toBeUndefined()
    expect(firstReadJob(record, [SOURCE], [job({ status: 'needs-you' })])).toBeUndefined()
  })

  it('after the sync, follows the first review of the source while it runs', () => {
    const review = job({ id: 'r1', kind: 'review', label: 'Background review of dango', startedAt: 30 })
    expect(firstReadJob(record, [SOURCE], [review, job({ status: 'done', finishedAt: 25 })])).toBe(review)
  })

  it('prefers a running review over the sync', () => {
    const review = job({ id: 'r1', kind: 'review', startedAt: 30 })
    expect(firstReadJob(record, [SOURCE], [job({}), review])).toBe(review)
  })

  it('stops showing once the first review is done, failed or stopped, even if a later one runs', () => {
    const sync = job({ status: 'done', finishedAt: 25 })
    for (const first of [
      job({ id: 'r1', kind: 'review', status: 'done', startedAt: 30 }),
      job({ id: 'r1', kind: 'review', status: 'failed', stoppedAt: 31, startedAt: 30 }),
    ]) {
      const later = job({ id: 'r2', kind: 'review', startedAt: 90 })
      expect(firstReadJob(record, [SOURCE], [later, first, sync])).toBeUndefined()
    }
  })

  it('is nothing once the source has a review on record (its jobs were pruned)', () => {
    const sync = job({ status: 'done', finishedAt: 25 })
    expect(firstReadJob(record, [{ ...SOURCE, lastReviewAt: 40 }], [sync])).toBeUndefined()
  })

  it('stops after the sync when Background review is off or the source is gone', () => {
    const sync = job({ status: 'done', finishedAt: 25 })
    const review = job({ id: 'r1', kind: 'review', startedAt: 30 })
    expect(firstReadJob(record, [{ ...SOURCE, backgroundReview: false }], [sync, review])).toBeUndefined()
    expect(firstReadJob(record, [], [sync, review])).toBeUndefined()
  })

  it('ignores reviews that started before the first sync, and other sources', () => {
    const sync = job({ status: 'done', finishedAt: 25 })
    const older = job({ id: 'r0', kind: 'review', startedAt: 5 })
    const other = job({ id: 'r9', kind: 'review', startedAt: 30, sourceId: 'src2' })
    expect(firstReadJob(record, [SOURCE], [sync, older, other])).toBeUndefined()
  })

  it('falls back to the sync job’s source when the record has no source id', () => {
    const review = job({ id: 'r1', kind: 'review', startedAt: 30 })
    const { firstReadSourceId: _id, ...withoutSource } = record
    expect(firstReadJob(withoutSource, [SOURCE], [job({ status: 'done' }), review])).toBe(review)
  })
})
