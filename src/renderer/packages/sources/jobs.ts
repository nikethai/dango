import { type BackgroundJob, REVIEW_INTERVAL_MS } from '@shared/types/background'
import type { ConnectedSource } from '@shared/types/sources'
import i18n from '@/i18n'
import { startJob } from '@/packages/background'
import { syncJobLabel } from './connect'
import { getSourceKind, listSourceKinds } from './kinds'
import { isRemovalPending } from './store'

/** The due check never runs more often than this, whatever a kind's `pollMs`. */
export const MIN_DUE_CHECK_MS = 30_000

/**
 * How often to look for due work: `defaultMs`, or half the shortest registered `pollMs` when that is sooner (a sync is
 * then started at most half an interval late), never under `MIN_DUE_CHECK_MS`. Kinds without `pollMs` change nothing.
 */
export function dueCheckIntervalMs(defaultMs: number): number {
  const polls = listSourceKinds().flatMap((def) => (def.pollMs && def.pollMs > 0 ? [def.pollMs / 2] : []))
  return Math.max(MIN_DUE_CHECK_MS, Math.min(defaultMs, ...polls))
}

/** The newest job of this source and kind. */
function latestJob(jobs: BackgroundJob[], sourceId: string, kind: BackgroundJob['kind']): BackgroundJob | undefined {
  let latest: BackgroundJob | undefined
  for (const job of jobs) {
    if (job.sourceId !== sourceId || job.kind !== kind) continue
    if (!latest || job.startedAt > latest.startedAt) latest = job
  }
  return latest
}

/**
 * True when nothing of this source and kind should start now: one is running (or waiting to retry), the latest waits
 * for its fix (a new run would only fail the same way), or the latest was stopped less than `intervalMs` ago.
 */
function blocked(
  jobs: BackgroundJob[],
  sourceId: string,
  kind: BackgroundJob['kind'],
  now: number,
  intervalMs: number
): boolean {
  if (jobs.some((j) => j.sourceId === sourceId && j.kind === kind && j.status === 'running')) return true
  const latest = latestJob(jobs, sourceId, kind)
  if (latest?.status === 'needs-you') return true
  return latest?.stoppedAt !== undefined && now - latest.stoppedAt < intervalMs
}

/**
 * Sources due a background review: not pending removal (S11), the switch is on, the kind can `read`, a kind that syncs has synced once, no review
 * is running, and the last review is at least `REVIEW_INTERVAL_MS` ago (or there was none).
 */
export function dueReviews(sources: ConnectedSource[], jobs: BackgroundJob[], now: number): string[] {
  return sources
    .filter((source) => {
      const def = getSourceKind(source.kind)
      if (isRemovalPending(source) || !source.backgroundReview || !def?.read) return false
      if (def.sync && source.lastSyncAt === undefined) return false
      if (blocked(jobs, source.id, 'review', now, REVIEW_INTERVAL_MS)) return false
      return source.lastReviewAt === undefined || now - source.lastReviewAt >= REVIEW_INTERVAL_MS
    })
    .map((source) => source.id)
}

/**
 * Sources due a sync: not pending removal (S11), the kind can sync, no sync is running or waits for its fix, and either the source never synced
 * (whatever the kind's `pollMs`: a folder adopted at launch or a first sync that never finished would otherwise never
 * sync, and so never be reviewed; after a stop it waits `pollMs`, else `REVIEW_INTERVAL_MS`) or the kind polls
 * (`pollMs`) and the last sync is at least `pollMs` ago.
 */
export function dueSyncs(sources: ConnectedSource[], jobs: BackgroundJob[], now: number): string[] {
  return sources
    .filter((source) => {
      const def = getSourceKind(source.kind)
      if (isRemovalPending(source) || !def?.sync) return false
      const pollMs = def.pollMs
      if (source.lastSyncAt === undefined) return !blocked(jobs, source.id, 'sync', now, pollMs || REVIEW_INTERVAL_MS)
      if (!pollMs || blocked(jobs, source.id, 'sync', now, pollMs)) return false
      return now - source.lastSyncAt >= pollMs
    })
    .map((source) => source.id)
}

/** Starts the due syncs and reviews. Main window only, after `resumeJobs()` has loaded the stored jobs. */
export function startDueJobs(sources: ConnectedSource[], jobs: BackgroundJob[], now = Date.now()): void {
  const byId = new Map(sources.map((s) => [s.id, s]))
  for (const id of dueSyncs(sources, jobs, now)) {
    const source = byId.get(id) as ConnectedSource
    startJob({
      kind: 'sync',
      label: syncJobLabel(source.kind),
      scopeId: source.scopeId,
      sourceId: id,
      sourceLabel: source.label,
    })
  }
  for (const id of dueReviews(sources, jobs, now)) {
    const source = byId.get(id) as ConnectedSource
    startJob({
      kind: 'review',
      // The source's name is user text, passed as a value.
      label: i18n.t('Background review of {{label}}', { label: source.label }),
      scopeId: source.scopeId,
      sourceId: id,
      sourceLabel: source.label,
    })
  }
}
