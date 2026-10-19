import {
  type BackgroundJob,
  JOB_FIX_LABELS,
  type JobFix,
  type JobFixAction,
  retryDelayAfter,
} from '@shared/types/background'
import type { ReviewEntryInput, ReviewRef } from '@shared/types/review'
import { readBackgroundPaused } from '@shared/types/settings'
import { v4 as uuidv4 } from 'uuid'
import i18n from '@/i18n'
import { addReviewEntry, registerReviewOpener, setLastCheckedAt, setReviewEntryState } from '@/packages/review'
import { settingsStore } from '@/stores/settingsStore'
import { NeedsUserError } from './errors'
import { _resetJobsStoreForTests, getBackgroundJob, jobsStore, loadJobs, putJob } from './jobs-store'

export type JobContext = { job: BackgroundJob; signal: AbortSignal; progress(text: string): void }
export type JobOutcome = { summary: string; addDoneEntry: boolean }
export type JobHandler = (ctx: JobContext) => Promise<JobOutcome>
type FixHandler = (job: BackgroundJob) => Promise<boolean>

const MAX_REASON_CHARS = 120

const handlers = new Map<BackgroundJob['kind'], JobHandler>()
const fixHandlers = new Map<JobFixAction, FixHandler>()
/** Runs in flight in this window. Only the window that starts or resumes jobs ever runs handlers. */
const active = new Map<string, AbortController>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
// The Review entry's `source`. Not a job field, so it is known only for jobs started in this window's lifetime.
const sourceLabels = new Map<string, string>()
let unwatchPause: (() => void) | null = null
// Fixes in flight per job id, so two quick opens run one fix.
const fixing = new Map<string, Promise<void>>()

/** Slice-internal hook for the sources store (Task 3). */
export type JobSourceResolver = {
  exists(sourceId: string): boolean
  label(sourceId: string): string | undefined
}
let sourceResolver: JobSourceResolver | null = null

/** Lets the job opener refuse entries whose source was removed, and names the source on entries of resumed jobs. */
export function setJobSourceResolver(resolver: JobSourceResolver | null): void {
  sourceResolver = resolver
}

function sourceLabelFor(job: BackgroundJob): string | undefined {
  const known = sourceLabels.get(job.id)
  if (known !== undefined || job.sourceId === undefined) return known
  return sourceResolver?.label(job.sourceId)
}

/** Same source and kind; jobs without a source (swarm, plan) never match. */
const sameSlot = (a: BackgroundJob, b: Pick<BackgroundJob, 'sourceId' | 'kind'>) =>
  a.sourceId !== undefined && a.sourceId === b.sourceId && a.kind === b.kind

function runningSibling(job: BackgroundJob): BackgroundJob | undefined {
  return jobsStore.getState().jobs.find((j) => j.id !== job.id && j.status === 'running' && sameSlot(j, job))
}

const jobRef = (id: string): ReviewRef => ({ type: 'job', id })
const isPaused = () => readBackgroundPaused(settingsStore.getState().backgroundPaused)

/** Called by every entry point that runs jobs: from then on, turning `backgroundPaused` off resumes waiting jobs. */
function startWatchingPause(): void {
  if (unwatchPause) return
  unwatchPause = settingsStore.subscribe((s, prev) => {
    if (readBackgroundPaused(prev.backgroundPaused) && !readBackgroundPaused(s.backgroundPaused)) {
      void resumeJobs().catch((error) => console.warn('[background] Could not resume jobs', error))
    }
  })
}

function clearTimer(id: string): void {
  const timer = timers.get(id)
  if (timer === undefined) return
  clearTimeout(timer)
  timers.delete(id)
}

/** Runs a running job now, or arms a timer for its `nextRetryAt`. A due run waits while background work is paused. */
function schedule(id: string, now = Date.now()): void {
  clearTimer(id)
  const job = getBackgroundJob(id)
  if (!job || job.status !== 'running' || active.has(id)) return
  if (job.nextRetryAt !== undefined && job.nextRetryAt > now) {
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id)
        schedule(id)
      }, job.nextRetryAt - now)
    )
    return
  }
  if (isPaused() || !handlers.has(job.kind)) return
  void execute(job).catch((error) => console.warn('[background] Job run failed unexpectedly', error))
}

function without<K extends keyof BackgroundJob>(job: BackgroundJob, ...keys: K[]): Omit<BackgroundJob, K> {
  const copy = { ...job }
  for (const k of keys) delete copy[k]
  return copy
}

async function safely(what: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (error) {
    console.warn(`[background] ${what} failed`, error)
  }
}

function entryFor(job: BackgroundJob, kind: 'done' | 'needs-you', text: string, fix?: JobFix): ReviewEntryInput {
  return {
    kind,
    scopeId: job.scopeId,
    source: sourceLabelFor(job),
    text,
    actionLabel: fix?.label,
    ref: jobRef(job.id),
  }
}

async function execute(job: BackgroundJob): Promise<void> {
  const handler = handlers.get(job.kind)
  if (!handler) return
  const id = job.id
  const controller = new AbortController()
  active.set(id, controller)
  const running: BackgroundJob = without(job, 'nextRetryAt')
  void putJob(running)
  const ctx: JobContext = {
    job: running,
    signal: controller.signal,
    progress(text) {
      if (active.get(id) !== controller || controller.signal.aborted) return
      const cur = getBackgroundJob(id)
      if (cur?.status === 'running') void putJob({ ...cur, progress: text }, { persist: false })
    },
  }
  let result: { ok: true; outcome: JobOutcome } | { ok: false; error: unknown }
  try {
    result = { ok: true, outcome: await handler(ctx) }
  } catch (error) {
    result = { ok: false, error }
  }
  // Stopped (or stopped and started again) while running: an abort never counts as a failure.
  if (active.get(id) !== controller) return
  active.delete(id)
  if (controller.signal.aborted) return
  const cur = getBackgroundJob(id)
  if (!cur || cur.status !== 'running') return
  if (result.ok) await succeed(cur, result.outcome)
  else await fail(cur, result.error)
}

async function succeed(job: BackgroundJob, outcome: JobOutcome): Promise<void> {
  const done: BackgroundJob = {
    ...without(job, 'progress', 'nextRetryAt', 'error', 'fix'),
    status: 'done',
    finishedAt: Date.now(),
    outcome: outcome.summary,
  }
  // Review hears of it at once; the job write and the Review writes run side by side.
  const writes = [putJob(done)]
  if (outcome.addDoneEntry)
    writes.push(safely('Done entry', () => addReviewEntry(entryFor(done, 'done', outcome.summary))))
  if (job.kind === 'sync' || job.kind === 'review')
    writes.push(safely('Last checked', () => setLastCheckedAt(Date.now())))
  await Promise.all(writes)
}

/** The first line of an error's message, at most 120 characters. Shown as a value, never used as a key. */
function errorLine(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const line = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean)
  if (!line) return i18n.t('Unknown error')
  return line.length > MAX_REASON_CHARS ? `${line.slice(0, MAX_REASON_CHARS - 1)}…` : line
}

async function fail(job: BackgroundJob, error: unknown): Promise<void> {
  if (error instanceof NeedsUserError) return needsYou(job, i18n.t(error.reason), error.fix)
  const attempts = job.attempts + 1
  const delay = retryDelayAfter(attempts)
  if (delay === null) {
    return needsYou({ ...job, attempts }, errorLine(error), { action: 'try-again', label: JOB_FIX_LABELS['try-again'] })
  }
  // Arm the timer before the write settles, so the wait counts from the failure.
  const saved = putJob({ ...without(job, 'progress'), attempts, nextRetryAt: Date.now() + delay })
  schedule(job.id)
  await saved
}

/** `reason` is display text (already translated, or an error line); `error` keeps it for every surface. */
async function needsYou(job: BackgroundJob, reason: string, fix: JobFix): Promise<void> {
  const stopped: BackgroundJob = {
    ...without(job, 'progress', 'nextRetryAt'),
    status: 'needs-you',
    finishedAt: Date.now(),
    error: reason,
    fix,
  }
  const text = i18n.t('{{label}} stopped: {{reason}}', { label: job.label, reason })
  await Promise.all([
    putJob(stopped),
    safely('Needs you entry', () => addReviewEntry(entryFor(stopped, 'needs-you', text, fix))),
  ])
}

function closeEntry(id: string): Promise<void> {
  return safely('Closing the entry', () => setReviewEntryState({ ref: jobRef(id) }, 'done'))
}

export function registerJobHandler(kind: BackgroundJob['kind'], handler: JobHandler): void {
  handlers.set(kind, handler)
  if (!unwatchPause) return
  // Jobs started or resumed before their handler registered run now.
  for (const job of jobsStore.getState().jobs) {
    if (job.kind === kind && job.status === 'running' && !timers.has(job.id)) schedule(job.id)
  }
}

/** `run` returns false when the user cancelled; the job then stays needs-you and its entry stays open. */
export function registerFixHandler(action: JobFixAction, run: FixHandler): void {
  fixHandlers.set(action, run)
}

/**
 * Starts a job and returns it, or returns the running job (including one waiting to retry) with the same `sourceId`
 * and `kind`. `label` is display text (callers translate it, e.g. `t('Gmail sync')`).
 */
export function startJob(input: {
  scopeId: string
  kind: BackgroundJob['kind']
  label: string
  sourceId?: string
  sourceLabel?: string
}): BackgroundJob {
  startWatchingPause()
  const running = jobsStore.getState().jobs.find((j) => j.status === 'running' && sameSlot(j, input))
  if (running) return running
  const job: BackgroundJob = {
    id: uuidv4(),
    scopeId: input.scopeId,
    kind: input.kind,
    label: input.label,
    status: 'running',
    attempts: 0,
    startedAt: Date.now(),
    ...(input.sourceId !== undefined ? { sourceId: input.sourceId } : {}),
  }
  if (input.sourceLabel) sourceLabels.set(job.id, input.sourceLabel)
  void putJob(job)
  if (jobsStore.getState().loaded) {
    closeSupersededEntry(job)
    schedule(job.id)
  } else {
    // Stored jobs are not known yet: load them first, so resume keeps one running job per source and kind.
    void resumeJobs()
      .then(() => closeSupersededEntry(job))
      .catch((error) => console.warn('[background] Could not load jobs', error))
  }
  return job
}

/** A new run supersedes the Needs you entry of the latest earlier job for the same source and kind (R15). */
function closeSupersededEntry(job: BackgroundJob): void {
  let latest: BackgroundJob | undefined
  for (const j of jobsStore.getState().jobs) {
    if (j.id === job.id || !sameSlot(j, job) || j.startedAt > job.startedAt) continue
    if (!latest || j.startedAt > latest.startedAt) latest = j
  }
  if (latest?.status === 'needs-you') void closeEntry(latest.id)
}

/** Stops a running job for good: `failed` with `stoppedAt`, no retry and no Review entry. */
export async function stopJob(id: string): Promise<void> {
  const job = getBackgroundJob(id)
  if (!job || job.status !== 'running') return
  await halt(job)
}

function halt(job: BackgroundJob): Promise<void> {
  const id = job.id
  clearTimer(id)
  const controller = active.get(id)
  active.delete(id)
  controller?.abort()
  const now = Date.now()
  return putJob({ ...without(job, 'progress', 'nextRetryAt'), status: 'failed', stoppedAt: now, finishedAt: now })
}

/**
 * Runs the job's fix; when it succeeds, closes the Needs you entry and runs the same job again from zero attempts.
 * A fix that throws counts as cancelled. While a fix runs, opening it again joins that fix.
 */
export function runJobFix(id: string): Promise<void> {
  const inFlight = fixing.get(id)
  if (inFlight) return inFlight
  const run = fixJob(id).finally(() => fixing.delete(id))
  fixing.set(id, run)
  return run
}

async function fixJob(id: string): Promise<void> {
  const job = getBackgroundJob(id)
  if (!job || job.status !== 'needs-you' || !job.fix) return
  const run = fixHandlers.get(job.fix.action) ?? (job.fix.action === 'try-again' ? async () => true : undefined)
  if (!run) {
    console.warn(`[background] No fix handler for ${job.fix.action}`)
    return
  }
  let fixed = false
  try {
    fixed = await run(job)
  } catch (error) {
    console.warn(`[background] Fix ${job.fix.action} failed`, error)
  }
  if (!fixed) return
  const cur = getBackgroundJob(id)
  if (!cur || cur.status !== 'needs-you') return
  await closeEntry(id)
  // A newer run of the same source and kind started meanwhile: it does the work, this job stays as it was.
  if (runningSibling(cur)) return
  startWatchingPause()
  const saved = putJob({
    ...without(cur, 'error', 'fix', 'finishedAt', 'nextRetryAt', 'outcome', 'progress'),
    status: 'running',
    attempts: 0,
  })
  schedule(id)
  await saved
}

/** Loads stored jobs and continues every running one: at its `nextRetryAt`, or at once when it was interrupted. */
export async function resumeJobs(now = Date.now()): Promise<void> {
  startWatchingPause()
  await loadJobs()
  await stopOlderDuplicates()
  for (const job of jobsStore.getState().jobs) {
    if (job.status === 'running') schedule(job.id, now)
  }
}

/** Keeps the newest running job per source and kind; older ones are stopped, without an entry. */
function stopOlderDuplicates(): Promise<unknown> {
  const newest = new Map<string, BackgroundJob>()
  const older: BackgroundJob[] = []
  for (const job of jobsStore.getState().jobs) {
    if (job.status !== 'running' || job.sourceId === undefined) continue
    const key = JSON.stringify([job.sourceId, job.kind])
    const kept = newest.get(key)
    if (!kept) newest.set(key, job)
    else if (job.startedAt > kept.startedAt) {
      older.push(kept)
      newest.set(key, job)
    } else older.push(job)
  }
  return Promise.all(older.map(halt))
}

/** Registers the Review opener for job entries: Needs you runs the fix, Done opens the scope. */
export function registerJobReviewOpener(): () => void {
  return registerReviewOpener(
    'job',
    async (entry) => {
      if (entry.kind === 'needs-you') return runJobFix(entry.ref.id)
      // Loaded on demand: the router pulls in every route.
      const { router } = await import('@/router')
      await router.navigate({ to: '/scope/$scopeId', params: { scopeId: entry.scopeId }, search: { tab: 'overview' } })
    },
    {
      canOpen: (entry) => {
        if (entry.kind !== 'needs-you' && entry.kind !== 'done') return false
        // R15: an entry whose source was removed has nothing to fix or open.
        const sourceId = getBackgroundJob(entry.ref.id)?.sourceId
        return sourceId === undefined || !sourceResolver || sourceResolver.exists(sourceId)
      },
    }
  )
}

/** Tests: aborts runs, clears timers, handlers and the pause subscription, and empties the store. */
export function _resetBackgroundJobsForTests(): void {
  for (const controller of active.values()) controller.abort()
  active.clear()
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  handlers.clear()
  fixHandlers.clear()
  sourceLabels.clear()
  fixing.clear()
  sourceResolver = null
  unwatchPause?.()
  unwatchPause = null
  _resetJobsStoreForTests()
}
