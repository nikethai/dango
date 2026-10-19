import { type BackgroundJob, JOB_HISTORY_PER_SCOPE, parseJobs } from '@shared/types/background'
import { useEffect, useMemo } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { createLockedQueue } from '@/lib/lockedQueue'

type JobsState = { jobs: BackgroundJob[]; loaded: boolean }

/** This window's jobs. `progress` lives only here; everything else is written to `StorageKey.BackgroundJobs`. */
export const jobsStore = createStore<JobsState>()(() => ({ jobs: [], loaded: false }))

type JobsStorage = {
  key: string
  getItem<T>(key: string, fallback: T): Promise<T>
  setItemNow(key: string, value: unknown): Promise<void>
}

// Lazy, key included: `@/storage` (and `StorageKey`'s module) reach the platform at load; tests mock `@/storage`.
async function getStorage(): Promise<JobsStorage> {
  const mod = await import('@/storage')
  const storage = mod.default as Omit<JobsStorage, 'key'>
  return {
    key: mod.StorageKey.BackgroundJobs,
    getItem: (key, fallback) => storage.getItem(key, fallback),
    setItemNow: (key, value) => storage.setItemNow(key, value),
  }
}

// One read-merge-write at a time, across windows (Web Lock) and within this one.
const enqueue = createLockedQueue('dango:background-jobs')

// Ids this window pruned, so a later merge with the stored list never brings them back.
const pruned = new Set<string>()

const finishedAt = (j: BackgroundJob) => j.finishedAt ?? j.stoppedAt ?? j.startedAt

/** Keeps every running job and the newest `JOB_HISTORY_PER_SCOPE` finished jobs of each scope. */
function prune(jobs: BackgroundJob[]): BackgroundJob[] {
  const finishedByScope = new Map<string, BackgroundJob[]>()
  for (const j of jobs) {
    if (j.status === 'running') continue
    const list = finishedByScope.get(j.scopeId) ?? []
    list.push(j)
    finishedByScope.set(j.scopeId, list)
  }
  const drop = new Set<string>()
  for (const list of finishedByScope.values()) {
    if (list.length <= JOB_HISTORY_PER_SCOPE) continue
    list.sort((a, b) => finishedAt(b) - finishedAt(a))
    for (const j of list.slice(JOB_HISTORY_PER_SCOPE)) drop.add(j.id)
  }
  if (drop.size === 0) return jobs
  for (const id of drop) pruned.add(id)
  return jobs.filter((j) => !drop.has(j.id))
}

/** This window's rows win; stored rows it does not know (another window's) are kept. */
function mergeWithStored(mine: BackgroundJob[], stored: BackgroundJob[]): BackgroundJob[] {
  const ids = new Set(mine.map((j) => j.id))
  return [...mine, ...stored.filter((j) => !ids.has(j.id) && !pruned.has(j.id))]
}

async function readStored(storage: JobsStorage): Promise<BackgroundJob[]> {
  return parseJobs(await storage.getItem<unknown>(storage.key, []))
}

/** Reads the stored jobs (invalid rows dropped) and merges them under this window's rows. */
export function loadJobs(): Promise<void> {
  return enqueue(async () => {
    const stored = await readStored(await getStorage())
    jobsStore.setState((s) => ({ jobs: prune(mergeWithStored(s.jobs, stored)), loaded: true }))
  })
}

function persistJobs(): Promise<void> {
  return enqueue(async () => {
    const storage = await getStorage()
    const merged = prune(mergeWithStored(jobsStore.getState().jobs, await readStored(storage)))
    await storage.setItemNow(
      storage.key,
      merged.map(({ progress: _progress, ...rest }) => rest)
    )
  }).catch((error) => {
    console.warn('[background] Could not save jobs', error)
  })
}

/**
 * Puts `job` in this window's store at once. Unless `persist` is false (progress ticks), it is also written to
 * storage; the returned promise settles when that write has finished (it never rejects).
 */
export function putJob(job: BackgroundJob, opts?: { persist?: boolean }): Promise<void> {
  jobsStore.setState((s) => {
    const exists = s.jobs.some((j) => j.id === job.id)
    const jobs = exists ? s.jobs.map((j) => (j.id === job.id ? job : j)) : [job, ...s.jobs]
    return { jobs: prune(jobs) }
  })
  return opts?.persist === false ? Promise.resolve() : persistJobs()
}

export function getBackgroundJob(id: string): BackgroundJob | undefined {
  return jobsStore.getState().jobs.find((j) => j.id === id)
}

type JobFilter = { scopeId?: string; sourceId?: string }

function filterJobs(jobs: BackgroundJob[], filter?: JobFilter): BackgroundJob[] {
  return jobs
    .filter(
      (j) =>
        (filter?.scopeId === undefined || j.scopeId === filter.scopeId) &&
        (filter?.sourceId === undefined || j.sourceId === filter.sourceId)
    )
    .sort((a, b) => b.startedAt - a.startedAt)
}

/** Jobs matching `filter`, newest first. */
export function listJobs(filter?: JobFilter): BackgroundJob[] {
  return filterJobs(jobsStore.getState().jobs, filter)
}

/** Calls `cb` with the job list after every change in this window (status, progress, new jobs). */
export function subscribeBackgroundJobs(cb: (jobs: BackgroundJob[]) => void): () => void {
  return jobsStore.subscribe((s, prev) => {
    if (s.jobs !== prev.jobs) cb(s.jobs)
  })
}

function useLoadJobs(): void {
  const loaded = useStore(jobsStore, (s) => s.loaded)
  useEffect(() => {
    if (!loaded) void loadJobs().catch(() => undefined)
  }, [loaded])
}

export function useBackgroundJob(id: string): BackgroundJob | undefined {
  useLoadJobs()
  return useStore(jobsStore, (s) => s.jobs.find((j) => j.id === id))
}

/** The jobs of `scopeId` (all jobs when omitted), newest first. */
export function useBackgroundJobs(scopeId?: string): BackgroundJob[] {
  useLoadJobs()
  const jobs = useStore(jobsStore, (s) => s.jobs)
  return useMemo(() => filterJobs(jobs, { scopeId }), [jobs, scopeId])
}

export function _resetJobsStoreForTests(): void {
  pruned.clear()
  jobsStore.setState({ jobs: [], loaded: false })
}
