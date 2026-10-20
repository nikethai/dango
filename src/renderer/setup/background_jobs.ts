import type { BackgroundJob } from '@shared/types/background'
import {
  listJobs,
  registerJobHandler,
  registerJobReviewOpener,
  resumeJobs,
  subscribeBackgroundJobs,
} from '@/packages/background'
// Registers the built-in source kinds; must load before the job opener is registered.
import {
  adoptExistingFolderBindings,
  dueCheckIntervalMs,
  loadSources,
  registerSourceFixHandlers,
  registerSourcesResolver,
  reviewJobHandler,
  sourcesStore,
  startDueJobs,
  syncJobHandler,
} from '@/packages/sources'
import platform from '@/platform'
import { getWindowRole } from '@/platform/windowRole'

const CHECK_EVERY_MS = 15 * 60 * 1000

let started = false
let stop: (() => void) | null = null

/** Jobs run in one window: `main` on desktop (never the quick window), the only window on web and mobile (R6). */
async function isJobWindow(): Promise<boolean> {
  return (await getWindowRole()) === 'jobs'
}

/**
 * Starts background work in the main window: registers the sync and review handlers, the sources' fix handlers,
 * the Review opener and (desktop) the Gmail and Asana adapters, removes folder bindings left over from an unfinished
 * Add a source, resumes stored jobs, turns folder bindings made before sources existed into sources, then starts due
 * syncs and reviews at launch, every 15 minutes (sooner when a kind polls more often) and whenever a sync finishes.
 * Nothing is started before the stored jobs are resumed; when resuming fails, the next check tries it again first.
 * Returns at once in any other window.
 */
export async function initBackgroundJobs(): Promise<void> {
  if (started) return
  // Checked again after the await: a second call may have started meanwhile.
  if (!(await isJobWindow()) || started) return
  started = true

  registerSourcesResolver()
  registerJobHandler('sync', syncJobHandler)
  registerJobHandler('review', reviewJobHandler)
  registerSourceFixHandlers()
  registerJobReviewOpener()
  // Slice 10: Gmail and Asana read and sync on desktop. After the built-in kinds, before stored jobs resume (a resumed
  // Gmail sync must find its adapter) and before the due-check interval is set (it honours their pollMs).
  if (platform.type === 'desktop') {
    try {
      const { registerPmAdapters } = await import('@/packages/pm-pilot')
      registerPmAdapters()
    } catch (error) {
      console.warn('[background] Could not register the Gmail and Asana adapters', error)
    }
  }

  try {
    await platform.discardDraftFolderBindings?.()
  } catch (error) {
    console.warn('[background] Could not remove leftover folder bindings', error)
  }

  let resumed = false
  const ensureResumed = async (): Promise<boolean> => {
    if (!resumed) {
      try {
        await resumeJobs()
        resumed = true
      } catch (error) {
        console.warn('[background] Could not resume jobs; trying again at the next check', error)
      }
    }
    return resumed
  }

  let checking: Promise<void> | null = null
  let again = false
  const check = (): Promise<void> => {
    if (checking) {
      again = true
      return checking
    }
    checking = (async () => {
      do {
        again = false
        try {
          if (!(await ensureResumed())) return
          if (!sourcesStore.getState().loaded) await loadSources()
          if (!sourcesStore.getState().loaded) return
          startDueJobs(sourcesStore.getState().sources, listJobs())
        } catch (error) {
          console.warn('[background] Could not check for due work', error)
        }
      } while (again)
    })().finally(() => {
      checking = null
    })
    return checking
  }

  // Every 15 minutes, or sooner when a registered kind polls more often (Gmail, Asana).
  const interval = setInterval(() => void check(), dueCheckIntervalMs(CHECK_EVERY_MS))
  // A sync that finishes may make its source due a review.
  const syncStatus = new Map<string, BackgroundJob['status']>()
  const unsubscribe = subscribeBackgroundJobs((jobs) => {
    let finished = false
    for (const job of jobs) {
      if (job.kind !== 'sync') continue
      if (job.status === 'done' && syncStatus.get(job.id) === 'running') finished = true
      syncStatus.set(job.id, job.status)
    }
    if (finished) void check()
  })
  stop = () => {
    clearInterval(interval)
    unsubscribe()
  }

  await ensureResumed()
  try {
    const { readScopes } = await import('@/hooks/useScopes')
    await adoptExistingFolderBindings((await readScopes()).map((scope) => scope.id))
  } catch (error) {
    console.warn('[background] Could not adopt existing folder bindings', error)
  }
  await check()
}

/** Tests: clears the timer and subscription so the next `initBackgroundJobs` starts again. */
export function _stopBackgroundJobsForTests(): void {
  stop?.()
  stop = null
  started = false
}
