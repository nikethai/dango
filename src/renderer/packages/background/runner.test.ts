import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BackgroundJob } from '@shared/types/background'
import { JOB_HISTORY_PER_SCOPE } from '@shared/types/background'
import type { ReviewEntry } from '@shared/types/review'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addReviewEntry, registerReviewOpener, setLastCheckedAt, setReviewEntryState } from '@/packages/review'
import { router } from '@/router'
import { settingsStore } from '@/stores/settingsStore'
import { NeedsUserError } from './errors'
import {
  _resetBackgroundJobsForTests,
  getBackgroundJob,
  type JobContext,
  type JobHandler,
  listJobs,
  registerFixHandler,
  registerJobHandler,
  registerJobReviewOpener,
  resumeJobs,
  runJobFix,
  setJobSourceResolver,
  startJob,
  stopJob,
  subscribeBackgroundJobs,
} from './index'

const KEY = 'background-jobs'
const memory = new Map<string, unknown>()
const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v))

vi.mock('@/storage', () => {
  return {
    StorageKey: { BackgroundJobs: 'background-jobs' },
    default: {
      getItem: <T>(key: string, fallback: T): Promise<T> =>
        Promise.resolve(memory.has(key) ? (clone(memory.get(key)) as T) : fallback),
      setItemNow: (key: string, value: unknown): Promise<void> => {
        memory.set(key, clone(value))
        return Promise.resolve()
      },
    },
  }
})
vi.mock('@/packages/review', () => ({
  addReviewEntry: vi.fn(async () => ({})),
  setReviewEntryState: vi.fn(async () => undefined),
  setLastCheckedAt: vi.fn(async () => undefined),
  registerReviewOpener: vi.fn(() => () => undefined),
}))
vi.mock('@/stores/settingsStore', async () => {
  const { createStore } = await import('zustand/vanilla')
  return { settingsStore: createStore(() => ({ backgroundPaused: false as unknown })) }
})
vi.mock('@/router', () => ({ router: { navigate: vi.fn(async () => undefined) } }))
vi.mock('@/packages/notifications', () => ({ notifySystemEvent: vi.fn() }))

const T0 = 1_700_000_000_000
const stored = () => (memory.get(KEY) as BackgroundJob[] | undefined) ?? []
const flush = () => vi.advanceTimersByTimeAsync(0)
const gmail = (over: Partial<Parameters<typeof startJob>[0]> = {}) =>
  startJob({ scopeId: 's1', kind: 'sync', label: 'Gmail sync', sourceId: 'src1', sourceLabel: 'me@work', ...over })

function handlerThat(fn: (ctx: JobContext) => Promise<{ summary: string; addDoneEntry: boolean }>) {
  const h = vi.fn<JobHandler>(fn)
  return h
}

beforeEach(async () => {
  // Warm the store's lazy `@/storage` import, so a first load settles within fake-timer flushes.
  await import('@/storage')
  vi.useFakeTimers({ now: T0 })
  memory.clear()
  _resetBackgroundJobsForTests()
  settingsStore.setState({ backgroundPaused: false })
  vi.mocked(addReviewEntry).mockClear()
  vi.mocked(setReviewEntryState).mockClear()
  vi.mocked(setLastCheckedAt).mockClear()
  vi.mocked(registerReviewOpener).mockClear()
  vi.mocked(router.navigate).mockClear()
})

afterEach(() => {
  _resetBackgroundJobsForTests()
  vi.useRealTimers()
})

describe('background job runner', () => {
  it('a failing handler runs four times, then one needs-you entry', async () => {
    const handler = handlerThat(async () => {
      await Promise.resolve()
      throw new Error('Gmail did not answer')
    })
    registerJobHandler('sync', handler)
    const { id } = gmail()
    await flush()
    expect(handler).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(handler).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(handler).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(handler).toHaveBeenCalledTimes(4)
    const job = getBackgroundJob(id)
    expect(job?.status).toBe('needs-you')
    expect(job?.fix?.label).toBe('Try again')
    expect(job?.error).toBe('Gmail did not answer')
    expect(addReviewEntry).toHaveBeenCalledTimes(1)
    expect(addReviewEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'needs-you',
        scopeId: 's1',
        source: 'me@work',
        text: 'Gmail sync stopped: Gmail did not answer',
        actionLabel: 'Try again',
        ref: { type: 'job', id },
      })
    )
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(handler).toHaveBeenCalledTimes(4)
    expect(stored().find((j) => j.id === id)?.status).toBe('needs-you')
  })

  it('NeedsUserError skips the retries', async () => {
    const handler = handlerThat(async () => {
      await Promise.resolve()
      throw new NeedsUserError('sign in again', { action: 'reconnect', label: 'Sign in again' })
    })
    registerJobHandler('sync', handler)
    const { id } = gmail()
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(getBackgroundJob(id)).toMatchObject({ status: 'needs-you', error: 'sign in again', attempts: 0 })
    expect(addReviewEntry).toHaveBeenCalledTimes(1)
    expect(addReviewEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'needs-you',
        text: 'Gmail sync stopped: sign in again',
        actionLabel: 'Sign in again',
        ref: { type: 'job', id },
      })
    )
  })

  it('a long or multi-line error is clipped to one line of at most 120 characters', async () => {
    registerJobHandler('sync', async () => {
      await Promise.resolve()
      throw new Error(`${'x'.repeat(200)}\nstack-ish detail`)
    })
    const { id } = gmail()
    await vi.advanceTimersByTimeAsync(400_000)
    const reason = getBackgroundJob(id)?.error ?? ''
    expect(reason.length).toBeLessThanOrEqual(120)
    expect(reason).not.toContain('\n')
    expect(reason).not.toContain('stack-ish')
    expect(vi.mocked(addReviewEntry).mock.calls[0][0].text).toBe(`Gmail sync stopped: ${reason}`)
  })

  it('success adds one done entry with the summary', async () => {
    registerJobHandler('sync', async () => ({ summary: 'Read 12 files from Notes', addDoneEntry: true }))
    const { id } = gmail()
    await flush()
    expect(getBackgroundJob(id)).toMatchObject({ status: 'done', outcome: 'Read 12 files from Notes' })
    expect(getBackgroundJob(id)?.finishedAt).toBe(T0)
    expect(addReviewEntry).toHaveBeenCalledTimes(1)
    expect(addReviewEntry).toHaveBeenCalledWith({
      kind: 'done',
      scopeId: 's1',
      source: 'me@work',
      text: 'Read 12 files from Notes',
      actionLabel: undefined,
      ref: { type: 'job', id },
    })
    expect(stored().find((j) => j.id === id)?.status).toBe('done')
  })

  it('addDoneEntry: false adds none', async () => {
    registerJobHandler('sync', async () => ({ summary: 'Nothing new', addDoneEntry: false }))
    const { id } = gmail()
    await flush()
    expect(getBackgroundJob(id)?.status).toBe('done')
    expect(addReviewEntry).not.toHaveBeenCalled()
  })

  it('a finished sync or review sets last checked', async () => {
    registerJobHandler('sync', async () => ({ summary: 'ok', addDoneEntry: false }))
    registerJobHandler('review', async () => ({ summary: 'ok', addDoneEntry: false }))
    registerJobHandler('swarm', async () => ({ summary: 'ok', addDoneEntry: false }))
    gmail()
    await flush()
    expect(setLastCheckedAt).toHaveBeenCalledTimes(1)
    expect(setLastCheckedAt).toHaveBeenCalledWith(T0)
    vi.mocked(setLastCheckedAt).mockClear()
    await vi.advanceTimersByTimeAsync(5_000)
    gmail({ kind: 'review', label: 'Background review of me@work' })
    await flush()
    expect(setLastCheckedAt).toHaveBeenCalledTimes(1)
    expect(setLastCheckedAt).toHaveBeenCalledWith(T0 + 5_000)
    vi.mocked(setLastCheckedAt).mockClear()
    startJob({ scopeId: 's1', kind: 'swarm', label: 'Swarm' })
    await flush()
    expect(setLastCheckedAt).not.toHaveBeenCalled()
  })

  it('last checked is not set after a failure, a needs-you or a stop', async () => {
    let mode: 'fail' | 'needs' | 'hang' = 'fail'
    registerJobHandler('sync', (ctx) => {
      if (mode === 'fail') return Promise.reject(new Error('down'))
      if (mode === 'needs')
        return Promise.reject(new NeedsUserError('sign in again', { action: 'reconnect', label: 'Sign in again' }))
      return new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    })
    gmail()
    await vi.advanceTimersByTimeAsync(400_000)
    mode = 'needs'
    gmail({ sourceId: 'src2' })
    await flush()
    mode = 'hang'
    const hung = gmail({ sourceId: 'src3' })
    await flush()
    await stopJob(hung.id)
    await flush()
    expect(setLastCheckedAt).not.toHaveBeenCalled()
  })

  it('one job per source and kind', async () => {
    let release: () => void = () => undefined
    const handler = handlerThat(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ summary: 'ok', addDoneEntry: false })
        })
    )
    registerJobHandler('sync', handler)
    const a = gmail()
    const b = gmail()
    await flush()
    expect(b.id).toBe(a.id)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(listJobs({ sourceId: 'src1' })).toHaveLength(1)
    // A different kind for the same source is its own job.
    registerJobHandler('review', async () => ({ summary: 'ok', addDoneEntry: false }))
    const c = gmail({ kind: 'review', label: 'Background review of me@work' })
    expect(c.id).not.toBe(a.id)
    release()
    await flush()
    // Once done, a new start is a new job.
    const d = gmail()
    expect(d.id).not.toBe(a.id)
  })

  it('a job waiting to retry still counts as running for the same source and kind', async () => {
    const handler = handlerThat(async () => {
      await Promise.resolve()
      throw new Error('down')
    })
    registerJobHandler('sync', handler)
    const a = gmail()
    await flush()
    expect(gmail().id).toBe(a.id)
    await flush()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('starting a source and kind again closes the open entry of its needs-you job', async () => {
    registerJobHandler('sync', async () => {
      await Promise.resolve()
      throw new NeedsUserError('sign in again', { action: 'reconnect', label: 'Sign in again' })
    })
    const old = gmail()
    await flush()
    expect(getBackgroundJob(old.id)?.status).toBe('needs-you')
    vi.mocked(setReviewEntryState).mockClear()
    const next = gmail()
    expect(next.id).not.toBe(old.id)
    await flush()
    expect(setReviewEntryState).toHaveBeenCalledWith({ ref: { type: 'job', id: old.id } }, 'done')
  })

  it('paused: nothing starts until unpaused', async () => {
    let fail = true
    const handler = handlerThat(async () => {
      await Promise.resolve()
      if (fail) throw new Error('down')
      return { summary: 'ok', addDoneEntry: false }
    })
    registerJobHandler('sync', handler)
    const retrying = gmail({ sourceId: 'src-retry' })
    await flush()
    expect(handler).toHaveBeenCalledTimes(1)
    fail = false
    settingsStore.setState({ backgroundPaused: true })
    const fresh = gmail({ sourceId: 'src-new' })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(getBackgroundJob(fresh.id)?.status).toBe('running')
    expect(getBackgroundJob(retrying.id)?.status).toBe('running')
    settingsStore.setState({ backgroundPaused: false })
    await flush()
    expect(handler).toHaveBeenCalledTimes(3)
    expect(getBackgroundJob(fresh.id)?.status).toBe('done')
    expect(getBackgroundJob(retrying.id)?.status).toBe('done')
  })

  it('a run already in progress finishes when paused', async () => {
    let release: () => void = () => undefined
    registerJobHandler(
      'sync',
      () =>
        new Promise((resolve) => {
          release = () => resolve({ summary: 'ok', addDoneEntry: true })
        })
    )
    const { id } = gmail()
    await flush()
    settingsStore.setState({ backgroundPaused: true })
    release()
    await flush()
    expect(getBackgroundJob(id)?.status).toBe('done')
  })

  it('stop aborts and adds nothing', async () => {
    let signal: AbortSignal | undefined
    const handler = handlerThat(
      (ctx) =>
        new Promise((_, reject) => {
          signal = ctx.signal
          ctx.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
    )
    registerJobHandler('sync', handler)
    const { id } = gmail()
    await flush()
    await stopJob(id)
    await flush()
    expect(signal?.aborted).toBe(true)
    const job = getBackgroundJob(id)
    expect(job?.status).toBe('failed')
    expect(job?.stoppedAt).toBe(T0)
    expect(job?.nextRetryAt).toBeUndefined()
    expect(job?.attempts).toBe(0)
    expect(addReviewEntry).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(stored().find((j) => j.id === id)).toMatchObject({ status: 'failed', stoppedAt: T0 })
  })

  it('stop during a retry wait cancels the retry', async () => {
    const handler = handlerThat(async () => {
      await Promise.resolve()
      throw new Error('down')
    })
    registerJobHandler('sync', handler)
    const { id } = gmail()
    await flush()
    await stopJob(id)
    await vi.advanceTimersByTimeAsync(600_000)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(getBackgroundJob(id)).toMatchObject({ status: 'failed', stoppedAt: T0 })
    expect(getBackgroundJob(id)?.nextRetryAt).toBeUndefined()
    expect(addReviewEntry).not.toHaveBeenCalled()
  })

  it('resumes a waiting retry at its time', async () => {
    const now = Date.now()
    memory.set(KEY, [
      {
        id: 'j1',
        scopeId: 's1',
        kind: 'sync',
        label: 'Gmail sync',
        sourceId: 'src1',
        status: 'running',
        attempts: 2,
        nextRetryAt: now + 120_000,
        startedAt: now - 100_000,
      },
    ])
    const seen: number[] = []
    const handler = handlerThat(async (ctx) => {
      await Promise.resolve()
      seen.push(ctx.job.attempts)
      return { summary: 'ok', addDoneEntry: false }
    })
    registerJobHandler('sync', handler)
    await resumeJobs(now)
    await vi.advanceTimersByTimeAsync(119_000)
    expect(handler).not.toHaveBeenCalled()
    expect(getBackgroundJob('j1')?.attempts).toBe(2)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([2])
    expect(getBackgroundJob('j1')?.status).toBe('done')
  })

  it('resumes an interrupted run at once', async () => {
    memory.set(KEY, [
      {
        id: 'j1',
        scopeId: 's1',
        kind: 'sync',
        label: 'Gmail sync',
        status: 'running',
        attempts: 0,
        startedAt: Date.now() - 5_000,
      },
    ])
    const handler = handlerThat(async () => ({ summary: 'ok', addDoneEntry: false }))
    registerJobHandler('sync', handler)
    await resumeJobs()
    await flush()
    expect(handler).toHaveBeenCalledTimes(1)
    expect(getBackgroundJob('j1')?.status).toBe('done')
  })

  it('resume does not touch finished jobs and drops invalid rows', async () => {
    memory.set(KEY, [
      { id: 'd1', scopeId: 's1', kind: 'sync', label: 'Gmail sync', status: 'done', attempts: 0, startedAt: 1 },
      { id: 'bad', scopeId: 's1', kind: 'nope' },
      'junk',
    ])
    const handler = handlerThat(async () => ({ summary: 'ok', addDoneEntry: false }))
    registerJobHandler('sync', handler)
    await resumeJobs()
    await flush()
    expect(handler).not.toHaveBeenCalled()
    expect(listJobs().map((j) => j.id)).toEqual(['d1'])
  })

  it('runJobFix closes the entry and re-runs with attempts reset', async () => {
    const seen: number[] = []
    let failing = true
    const handler = handlerThat(async (ctx) => {
      await Promise.resolve()
      seen.push(ctx.job.attempts)
      if (failing) throw new Error('down')
      return { summary: 'ok', addDoneEntry: false }
    })
    registerJobHandler('sync', handler)
    const { id } = gmail()
    await vi.advanceTimersByTimeAsync(400_000)
    expect(getBackgroundJob(id)?.status).toBe('needs-you')
    expect(getBackgroundJob(id)?.attempts).toBe(4)
    const fix = vi.fn(async () => true)
    registerFixHandler('try-again', fix)
    failing = false
    await runJobFix(id)
    await flush()
    expect(fix).toHaveBeenCalledWith(expect.objectContaining({ id }))
    expect(setReviewEntryState).toHaveBeenCalledWith({ ref: { type: 'job', id } }, 'done')
    expect(seen).toEqual([0, 1, 2, 3, 0])
    const job = getBackgroundJob(id)
    expect(job?.status).toBe('done')
    expect(job?.error).toBeUndefined()
    expect(job?.fix).toBeUndefined()
  })

  it('Try again works without a registered fix handler', async () => {
    let failing = true
    const handler = handlerThat(async () => {
      await Promise.resolve()
      if (failing) throw new Error('down')
      return { summary: 'ok', addDoneEntry: false }
    })
    registerJobHandler('sync', handler)
    const { id } = gmail()
    await vi.advanceTimersByTimeAsync(400_000)
    failing = false
    await runJobFix(id)
    await flush()
    expect(getBackgroundJob(id)?.status).toBe('done')
  })

  it('a fix handler returning false leaves the job needs-you and the entry open', async () => {
    const handler = handlerThat(async () => {
      await Promise.resolve()
      throw new NeedsUserError('sign in again', { action: 'reconnect', label: 'Sign in again' })
    })
    registerJobHandler('sync', handler)
    registerFixHandler('reconnect', async () => false)
    const { id } = gmail()
    await flush()
    await runJobFix(id)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(getBackgroundJob(id)?.status).toBe('needs-you')
    expect(setReviewEntryState).not.toHaveBeenCalled()
  })

  it('the job opener runs the fix for needs-you and opens the scope for done', async () => {
    registerJobHandler('sync', async () => {
      await Promise.resolve()
      throw new NeedsUserError('sign in again', { action: 'reconnect', label: 'Sign in again' })
    })
    const fix = vi.fn(async () => false)
    registerFixHandler('reconnect', fix)
    const off = registerJobReviewOpener()
    expect(typeof off).toBe('function')
    expect(registerReviewOpener).toHaveBeenCalledWith('job', expect.any(Function), expect.anything())
    const open = vi.mocked(registerReviewOpener).mock.calls[0][1]
    const { id } = gmail()
    await flush()
    const entry = (over: Partial<ReviewEntry>): ReviewEntry => ({
      id: 'e1',
      kind: 'needs-you',
      scopeId: 's1',
      text: 'Gmail sync stopped: sign in again',
      ref: { type: 'job', id },
      state: 'open',
      createdAt: T0,
      ...over,
    })
    await open(entry({}))
    expect(fix).toHaveBeenCalledTimes(1)
    expect(router.navigate).not.toHaveBeenCalled()
    await open(entry({ kind: 'done', scopeId: 's9' }))
    expect(router.navigate).toHaveBeenCalledWith({
      to: '/scope/$scopeId',
      params: { scopeId: 's9' },
      search: { tab: 'overview' },
    })
    expect(fix).toHaveBeenCalledTimes(1)
  })

  it('progress stays in memory and is never persisted', async () => {
    let release: () => void = () => undefined
    registerJobHandler(
      'sync',
      (ctx) =>
        new Promise((resolve) => {
          ctx.progress('Reading your folder · 10 files')
          release = () => resolve({ summary: 'ok', addDoneEntry: false })
        })
    )
    const { id } = gmail()
    await flush()
    expect(getBackgroundJob(id)?.progress).toBe('Reading your folder · 10 files')
    expect(stored().find((j) => j.id === id)?.progress).toBeUndefined()
    release()
    await flush()
    expect(getBackgroundJob(id)?.progress).toBeUndefined()
  })

  it('keeps at most JOB_HISTORY_PER_SCOPE finished jobs per scope, newest first', async () => {
    registerJobHandler('swarm', async () => ({ summary: 'ok', addDoneEntry: false }))
    for (let i = 0; i < JOB_HISTORY_PER_SCOPE + 3; i++) {
      startJob({ scopeId: 's1', kind: 'swarm', label: 'Swarm' })
      await vi.advanceTimersByTimeAsync(1_000)
    }
    startJob({ scopeId: 's2', kind: 'swarm', label: 'Swarm' })
    await flush()
    const s1 = listJobs({ scopeId: 's1' })
    expect(s1).toHaveLength(JOB_HISTORY_PER_SCOPE)
    expect(s1[0].startedAt).toBeGreaterThan(s1[1].startedAt)
    expect(listJobs({ scopeId: 's2' })).toHaveLength(1)
    expect(stored().filter((j) => j.scopeId === 's1')).toHaveLength(JOB_HISTORY_PER_SCOPE)
  })

  it('subscribeBackgroundJobs reports changes until unsubscribed', async () => {
    registerJobHandler('sync', async () => ({ summary: 'ok', addDoneEntry: false }))
    const cb = vi.fn()
    const off = subscribeBackgroundJobs(cb)
    const { id } = gmail()
    await flush()
    expect(cb).toHaveBeenCalled()
    expect(cb.mock.lastCall?.[0].find((j: BackgroundJob) => j.id === id)?.status).toBe('done')
    off()
    cb.mockClear()
    gmail({ sourceId: 'other' })
    await flush()
    expect(cb).not.toHaveBeenCalled()
  })

  it('never imports or calls notifications (the needs-you watcher owns them)', async () => {
    const { notifySystemEvent } = await import('@/packages/notifications')
    registerJobHandler('sync', async () => ({ summary: 'ok', addDoneEntry: true }))
    gmail()
    await flush()
    expect(notifySystemEvent).not.toHaveBeenCalled()
    for (const file of ['runner.ts', 'jobs-store.ts', 'errors.ts', 'index.ts']) {
      const src = readFileSync(join(__dirname, file), 'utf8')
      expect(src).not.toMatch(/notifications/)
    }
  })
})

describe('background job runner: one job per source, fixes and resolver', () => {
  const needsSignIn = () => new NeedsUserError('sign in again', { action: 'reconnect', label: 'Sign in again' })
  const settle = async () => {
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0)
  }
  const runningFor = (sourceId: string) => listJobs({ sourceId }).filter((j) => j.status === 'running')

  it('a fix finishing after a new run of the same source and kind does not run the fixed job again', async () => {
    let calls = 0
    const handler = handlerThat(async () => {
      await Promise.resolve()
      calls += 1
      if (calls === 1) throw needsSignIn()
      return new Promise(() => undefined)
    })
    registerJobHandler('sync', handler)
    const { id } = gmail()
    await settle()
    expect(getBackgroundJob(id)?.status).toBe('needs-you')
    let finishFix: (ok: boolean) => void = () => undefined
    registerFixHandler(
      'reconnect',
      () =>
        new Promise<boolean>((resolve) => {
          finishFix = resolve
        })
    )
    const fixing = runJobFix(id)
    await settle()
    const fresh = gmail()
    await settle()
    expect(handler).toHaveBeenCalledTimes(2)
    vi.mocked(setReviewEntryState).mockClear()
    finishFix(true)
    await fixing
    await settle()
    expect(handler).toHaveBeenCalledTimes(2)
    expect(getBackgroundJob(id)?.status).toBe('needs-you')
    expect(setReviewEntryState).toHaveBeenCalledWith({ ref: { type: 'job', id } }, 'done')
    expect(runningFor('src1').map((j) => j.id)).toEqual([fresh.id])
  })

  it('pruning never drops a needs-you job', async () => {
    registerJobHandler('sync', async () => {
      await Promise.resolve()
      throw needsSignIn()
    })
    registerJobHandler('swarm', async () => {
      await Promise.resolve()
      return { summary: 'ok', addDoneEntry: false }
    })
    const { id } = gmail()
    await settle()
    for (let i = 0; i < JOB_HISTORY_PER_SCOPE + 5; i++) {
      await vi.advanceTimersByTimeAsync(1_000)
      startJob({ scopeId: 's1', kind: 'swarm', label: 'Swarm' })
      await settle()
    }
    expect(getBackgroundJob(id)?.status).toBe('needs-you')
    expect(stored().find((j) => j.id === id)?.status).toBe('needs-you')
    expect(listJobs({ scopeId: 's1' }).filter((j) => j.kind === 'swarm')).toHaveLength(JOB_HISTORY_PER_SCOPE)
  })

  it('resume keeps only the newest running job per source and kind', async () => {
    const now = Date.now()
    const base = { scopeId: 's1', kind: 'sync', label: 'Gmail sync', sourceId: 'src1', status: 'running' }
    memory.set(KEY, [
      { ...base, id: 'old', attempts: 1, nextRetryAt: now + 10_000, startedAt: now - 50_000 },
      { ...base, id: 'new', attempts: 0, startedAt: now - 1_000 },
    ])
    const seen: string[] = []
    registerJobHandler('sync', async (ctx) => {
      await Promise.resolve()
      seen.push(ctx.job.id)
      return { summary: 'ok', addDoneEntry: false }
    })
    await resumeJobs(now)
    await settle()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(seen).toEqual(['new'])
    expect(getBackgroundJob('old')).toMatchObject({ status: 'failed', stoppedAt: now })
    expect(getBackgroundJob('old')?.nextRetryAt).toBeUndefined()
    expect(stored().find((j) => j.id === 'old')?.status).toBe('failed')
    expect(addReviewEntry).not.toHaveBeenCalled()
  })

  it('startJob before the store has loaded still leaves one running job per source and kind', async () => {
    memory.set(KEY, [
      {
        id: 'stored',
        scopeId: 's1',
        kind: 'sync',
        label: 'Gmail sync',
        sourceId: 'src1',
        status: 'running',
        attempts: 0,
        startedAt: Date.now() - 5_000,
      },
    ])
    const handler = handlerThat(async () => {
      await Promise.resolve()
      return new Promise(() => undefined)
    })
    registerJobHandler('sync', handler)
    gmail()
    await settle()
    expect(runningFor('src1')).toHaveLength(1)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(stored().filter((j) => j.sourceId === 'src1' && j.status === 'running')).toHaveLength(1)
  })

  it('startJob before load still closes the entry of a stored needs-you job', async () => {
    memory.set(KEY, [
      {
        id: 'stuck',
        scopeId: 's1',
        kind: 'sync',
        label: 'Gmail sync',
        sourceId: 'src1',
        status: 'needs-you',
        attempts: 0,
        startedAt: Date.now() - 5_000,
        finishedAt: Date.now() - 4_000,
        error: 'sign in again',
        fix: { action: 'reconnect', label: 'Sign in again' },
      },
    ])
    registerJobHandler('sync', async () => {
      await Promise.resolve()
      return { summary: 'ok', addDoneEntry: false }
    })
    gmail()
    await settle()
    expect(setReviewEntryState).toHaveBeenCalledWith({ ref: { type: 'job', id: 'stuck' } }, 'done')
  })

  it('a throwing fix handler counts as cancelled', async () => {
    const handler = handlerThat(async () => {
      await Promise.resolve()
      throw needsSignIn()
    })
    registerJobHandler('sync', handler)
    registerFixHandler('reconnect', async () => {
      await Promise.resolve()
      throw new Error('browser closed')
    })
    const { id } = gmail()
    await settle()
    await expect(runJobFix(id)).resolves.toBeUndefined()
    await settle()
    expect(handler).toHaveBeenCalledTimes(1)
    expect(getBackgroundJob(id)?.status).toBe('needs-you')
    expect(setReviewEntryState).not.toHaveBeenCalled()
  })

  it('two quick opens run the fix once', async () => {
    registerJobHandler('sync', async () => {
      await Promise.resolve()
      throw needsSignIn()
    })
    let finishFix: (ok: boolean) => void = () => undefined
    const fix = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishFix = resolve
        })
    )
    registerFixHandler('reconnect', fix)
    const { id } = gmail()
    await settle()
    const a = runJobFix(id)
    const b = runJobFix(id)
    await settle()
    expect(fix).toHaveBeenCalledTimes(1)
    finishFix(false)
    await Promise.all([a, b])
    // Once settled, a later open runs the fix again.
    void runJobFix(id)
    await settle()
    expect(fix).toHaveBeenCalledTimes(2)
  })

  it('the job opener cannot open entries whose source is gone', async () => {
    setJobSourceResolver({ exists: (sourceId) => sourceId !== 'gone', label: () => undefined })
    registerJobHandler('sync', async () => {
      await Promise.resolve()
      throw needsSignIn()
    })
    registerJobHandler('swarm', async () => {
      await Promise.resolve()
      return { summary: 'ok', addDoneEntry: true }
    })
    registerJobReviewOpener()
    const canOpen = vi.mocked(registerReviewOpener).mock.calls[0][2]?.canOpen
    if (!canOpen) throw new Error('no canOpen')
    const kept = gmail()
    const gone = gmail({ sourceId: 'gone' })
    const swarm = startJob({ scopeId: 's1', kind: 'swarm', label: 'Swarm' })
    await settle()
    const entry = (id: string, kind: ReviewEntry['kind'] = 'needs-you'): ReviewEntry => ({
      id: `e-${id}`,
      kind,
      scopeId: 's1',
      text: 'x',
      ref: { type: 'job', id },
      state: 'open',
      createdAt: T0,
    })
    expect(canOpen(entry(kept.id))).toBe(true)
    expect(canOpen(entry(gone.id))).toBe(false)
    expect(canOpen(entry(swarm.id, 'done'))).toBe(true)
  })

  it('entries of a resumed job take the source label from the resolver', async () => {
    setJobSourceResolver({ exists: () => true, label: (sourceId) => `Label of ${sourceId}` })
    memory.set(KEY, [
      {
        id: 'j1',
        scopeId: 's1',
        kind: 'sync',
        label: 'Gmail sync',
        sourceId: 'src1',
        status: 'running',
        attempts: 0,
        startedAt: Date.now() - 5_000,
      },
    ])
    registerJobHandler('sync', async () => {
      await Promise.resolve()
      throw needsSignIn()
    })
    await resumeJobs()
    await settle()
    expect(addReviewEntry).toHaveBeenCalledWith(expect.objectContaining({ source: 'Label of src1' }))
  })

  it('a fix for a job whose source was removed never runs it again', async () => {
    const present = new Set(['src1'])
    setJobSourceResolver({ exists: (sourceId) => present.has(sourceId), label: () => undefined })
    const handler = handlerThat(async () => {
      await Promise.resolve()
      throw needsSignIn()
    })
    registerJobHandler('sync', handler)
    const fix = vi.fn(async () => true)
    registerFixHandler('reconnect', fix)
    const { id } = gmail()
    await settle()
    present.delete('src1')
    await runJobFix(id)
    await settle()
    expect(fix).not.toHaveBeenCalled()
    expect(handler).toHaveBeenCalledTimes(1)
    expect(getBackgroundJob(id)?.status).toBe('needs-you')
  })

  it('a fix that finishes after its source was removed does not run the job again', async () => {
    const present = new Set(['src1'])
    setJobSourceResolver({ exists: (sourceId) => present.has(sourceId), label: () => undefined })
    const handler = handlerThat(async () => {
      await Promise.resolve()
      throw needsSignIn()
    })
    registerJobHandler('sync', handler)
    let finishFix: (ok: boolean) => void = () => undefined
    registerFixHandler(
      'reconnect',
      () =>
        new Promise<boolean>((resolve) => {
          finishFix = resolve
        })
    )
    const { id } = gmail()
    await settle()
    const fixing = runJobFix(id)
    await settle()
    present.delete('src1')
    finishFix(true)
    await fixing
    await settle()
    expect(handler).toHaveBeenCalledTimes(1)
    expect(runningFor('src1')).toEqual([])
  })

  it('stopJob retires a needs-you job: failed with stoppedAt, no fix, no new entry', async () => {
    registerJobHandler('sync', async () => {
      await Promise.resolve()
      throw needsSignIn()
    })
    const { id } = gmail()
    await settle()
    vi.mocked(addReviewEntry).mockClear()
    await stopJob(id)
    const job = getBackgroundJob(id)
    expect(job?.status).toBe('failed')
    expect(job?.stoppedAt).toBeTypeOf('number')
    expect(job?.fix).toBeUndefined()
    expect(stored().find((j) => j.id === id)?.status).toBe('failed')
    expect(addReviewEntry).not.toHaveBeenCalled()
  })

  it('a superseded needs-you job counts toward the history cap; the latest of its source and kind never does', async () => {
    let fail = true
    registerJobHandler('sync', async () => {
      await Promise.resolve()
      if (fail) throw needsSignIn()
      return { summary: 'ok', addDoneEntry: false }
    })
    registerJobHandler('swarm', async () => {
      await Promise.resolve()
      return { summary: 'ok', addDoneEntry: false }
    })
    const superseded = gmail()
    await settle()
    await vi.advanceTimersByTimeAsync(1_000)
    // Sync now after the failure: the new run supersedes the needs-you job, and fails the same way.
    const latest = gmail()
    await settle()
    expect(getBackgroundJob(latest.id)?.status).toBe('needs-you')
    fail = false
    for (let i = 0; i < JOB_HISTORY_PER_SCOPE + 2; i++) {
      await vi.advanceTimersByTimeAsync(1_000)
      startJob({ scopeId: 's1', kind: 'swarm', label: 'Swarm' })
      await settle()
    }
    expect(getBackgroundJob(superseded.id)).toBeUndefined()
    expect(stored().find((j) => j.id === superseded.id)).toBeUndefined()
    expect(getBackgroundJob(latest.id)?.status).toBe('needs-you')
  })
})
