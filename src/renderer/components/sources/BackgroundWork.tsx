import { type BackgroundJob, isWaitingToRetry } from '@shared/types/background'
import { readBackgroundPaused } from '@shared/types/settings'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNow } from '@/hooks/useNow'
import { useWindowRole } from '@/hooks/useWindowRole'
import i18n from '@/i18n'
import { runJobFix, startJob, stopJob, useBackgroundJobs, useBackgroundJobsLoaded } from '@/packages/background'
import { getSource } from '@/packages/sources'
import { pushUndo } from '@/packages/undo'
import { useSettingsStore } from '@/stores/settingsStore'
import { openConfiguration } from './AddSourceSheet'

const FINISHED_SHOWN = 5

/** Where a job action taken outside the jobs window goes: this scope's page in the main window. */
const scopeRoute = (scopeId: string) => `/scope/${encodeURIComponent(scopeId)}`

/** Running line: progress, else Paused, Trying again shortly or Starting…. Never a count. */
function runningLine(job: BackgroundJob, paused: boolean, now: number): string {
  // A run already in progress finishes while paused, so its progress still shows.
  if (job.progress) return job.progress
  if (paused) return i18n.t('Paused')
  if (isWaitingToRetry(job, now)) return i18n.t('Trying again shortly')
  return i18n.t('Starting…')
}

/** "{label} stopped: {error}": the label is stored display text and the error a service message, both values. */
function stoppedLine(job: BackgroundJob): string {
  return i18n.t('{{label}} stopped: {{reason}}', { label: job.label, reason: job.error ?? i18n.t('Unknown error') })
}

/** One sentence for a status change worth announcing (started, stopped, done, needs you); undefined otherwise. */
function transitionText(job: BackgroundJob, before: BackgroundJob['status'] | undefined): string | undefined {
  if (before === job.status) return undefined
  if (job.status === 'running') return i18n.t('{{label}} started', { label: job.label })
  if (job.status === 'done') return i18n.t('{{label}} done', { label: job.label })
  if (job.status === 'needs-you') return stoppedLine(job)
  return job.stoppedAt !== undefined ? i18n.t('Stopped {{label}}', { label: job.label }) : stoppedLine(job)
}

/**
 * The visible list is not live (progress ticks would be read out); this node gets one sentence per status change.
 * The baseline is what the stored jobs hold once loaded, so jobs that load late are never read out.
 */
function useStatusAnnouncement(jobs: BackgroundJob[], loaded: boolean): string {
  const seen = useRef<Map<string, BackgroundJob['status']> | null>(null)
  const [text, setText] = useState('')
  useEffect(() => {
    if (!loaded) return
    const before = seen.current
    seen.current = new Map(jobs.map((j) => [j.id, j.status]))
    // The first loaded render only records what is there.
    if (!before) return
    const changes = jobs.map((j) => transitionText(j, before.get(j.id))).filter((s): s is string => !!s)
    if (changes.length > 0) setText(changes.join(' '))
  }, [jobs, loaded])
  return text
}

/** A needs-you job's fix applies only while it is the latest job for its source and kind. */
function isLatestOfSlot(job: BackgroundJob, jobs: BackgroundJob[]): boolean {
  if (job.sourceId === undefined) return true
  return jobs.find((j) => j.sourceId === job.sourceId && j.kind === job.kind) === job
}

/**
 * The scope's Background work: running jobs (label, progress line, Stop), then the five newest finished jobs (outcome,
 * "{label} stopped: {error}" with its fix, or Stopped). Only its (empty) live region when the scope has no jobs, so
 * the region exists before the first announcement. Stop, Undo and fixes act only in the window that runs jobs (R6);
 * elsewhere they open this scope in the main window. They are hidden until the window's role is known.
 */
export function BackgroundWork({ scopeId }: { scopeId: string }) {
  const { t } = useTranslation()
  const jobs = useBackgroundJobs(scopeId)
  const paused = readBackgroundPaused(useSettingsStore((s) => s.backgroundPaused))
  const loaded = useBackgroundJobsLoaded()
  const now = useNow()
  const role = useWindowRole()
  const announcement = useStatusAnnouncement(jobs, loaded)
  const headingId = useId()

  const running = jobs.filter((j) => j.status === 'running')
  const finished = jobs.filter((j) => j.status !== 'running').slice(0, FINISHED_SHOWN)

  /** Runs `fn` in the jobs window; anywhere else opens this scope in the main window. */
  const inJobsWindow = (fn: () => void | Promise<void>) => {
    if (role === undefined) return
    if (role === 'jobs') return void Promise.resolve(fn()).catch((e) => console.warn('[background] Action failed', e))
    void openConfiguration(scopeRoute(scopeId))
  }

  const stop = (job: BackgroundJob) =>
    inJobsWindow(async () => {
      await stopJob(job.id)
      pushUndo({
        message: i18n.t('Stopped {{label}}', { label: job.label }),
        undo: () => {
          // A removed source stays stopped.
          const source = job.sourceId === undefined ? undefined : getSource(job.sourceId)
          if (job.sourceId !== undefined && !source) return
          startJob({
            scopeId: job.scopeId,
            kind: job.kind,
            label: job.label,
            ...(source ? { sourceId: source.id, sourceLabel: source.label } : {}),
          })
        },
        group: 'other',
      })
    })

  // The live region is always rendered, after the section, so the node exists before its first sentence.
  return (
    <>
      {jobs.length > 0 ? (
        <section aria-labelledby={headingId} className="flex flex-col gap-2">
          <h2 id={headingId} className="dg-type-headline">
            {t('Background work')}
          </h2>
          <ul className="flex flex-col gap-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {running.map((job) => (
              <li key={job.id} className="dg-item" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
                <div className="dg-item__text">
                  {/* Labels and progress are stored display text: rendered as children. */}
                  <div className="dg-type-body">{job.label}</div>
                  <div className="dg-item__meta">{runningLine(job, paused, now)}</div>
                </div>
                {role !== undefined ? (
                  <div className="dg-item__actions">
                    <button
                      type="button"
                      className="dg-btn"
                      aria-label={t('Stop {{label}}', { label: job.label })}
                      onClick={() => stop(job)}
                    >
                      {t('Stop')}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
            {finished.map((job) => (
              <li key={job.id} className="dg-item" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
                {job.status === 'done' ? (
                  <div className="dg-item__text">
                    <div className="dg-type-body">{job.label}</div>
                    <div className="dg-item__meta">{job.outcome ?? t('Done')}</div>
                  </div>
                ) : job.stoppedAt !== undefined ? (
                  <div className="dg-item__text">
                    <div className="dg-type-body">{job.label}</div>
                    <div className="dg-item__meta">{t('Stopped')}</div>
                  </div>
                ) : (
                  <div className="dg-item__text">
                    <div className="dg-type-body">{stoppedLine(job)}</div>
                  </div>
                )}
                {role !== undefined && job.status === 'needs-you' && job.fix && isLatestOfSlot(job, jobs) ? (
                  <div className="dg-item__actions">
                    <button type="button" className="dg-btn" onClick={() => inJobsWindow(() => runJobFix(job.id))}>
                      {t(job.fix.label)}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
    </>
  )
}
