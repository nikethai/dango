import type { BackgroundJob } from '@shared/types/background'
import type { ConnectedSource } from '@shared/types/sources'
import type { FirstRunRecord } from './firstRun'

/**
 * The job FR5's card follows (R9), or undefined when the card should not show:
 * - the first sync (`firstReadJobId`) while it runs;
 * - after it is done, the source's first background review (the first review that started after that sync) while it
 *   runs. Proposals come from the review, so the card stays until items can appear.
 *
 * Nothing shows without a first read (skipped source, upgrade), once the sync failed, was stopped or is gone, once the
 * first review finished in any way (a later review never brings the card back), when the source has Background review
 * off (or cannot be reviewed), or while the source is unknown (removed, or not loaded yet). Between the sync ending and
 * the review starting (one due check), nothing.
 */
export function firstReadJob(
  record: FirstRunRecord | undefined,
  sources: ConnectedSource[],
  jobs: BackgroundJob[]
): BackgroundJob | undefined {
  const syncId = record?.firstReadJobId
  if (!syncId) return undefined
  const sync = jobs.find((j) => j.id === syncId)
  if (!sync) return undefined
  const sourceId = record.firstReadSourceId ?? sync.sourceId
  const source = sources.find((s) => s.id === sourceId)
  if (!source) return undefined
  // With Background review off (or a kind without review, like Documents) the card ends with the sync.
  const firstReview = source.backgroundReview
    ? jobs
        .filter((j) => j.kind === 'review' && j.sourceId === source.id && j.startedAt >= sync.startedAt)
        .sort((a, b) => a.startedAt - b.startedAt)[0]
    : undefined
  if (firstReview) return firstReview.status === 'running' ? firstReview : undefined
  return sync.status === 'running' ? sync : undefined
}
