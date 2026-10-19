import { type BackgroundJob, isWaitingToRetry, type JobFix } from '@shared/types/background'
import { readBackgroundPaused } from '@shared/types/settings'
import type { ConnectedSource } from '@shared/types/sources'
import { IconDots } from '@tabler/icons-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { useNow } from '@/hooks/useNow'
import { useWindowRole } from '@/hooks/useWindowRole'
import i18n from '@/i18n'
import { runJobFix, startJob, useBackgroundJobs } from '@/packages/background'
import { BACKGROUND_REVIEW_LINE, getSourceKind, revokeSource, syncJobLabel, updateSource } from '@/packages/sources'
import { pushUndo } from '@/packages/undo'
import { useSettingsStore } from '@/stores/settingsStore'
import { add as addToast } from '@/stores/toastActions'
import { openConfiguration, SOURCES_SETTINGS_ROUTE } from './AddSourceSheet'

const REMOVE_DELAY_MS = 5_000
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export type SourceStatusLine = { text: string; fix?: JobFix; jobId?: string }

function syncedText(lastSyncAt: number, now: number): string {
  const ago = Math.max(0, now - lastSyncAt)
  if (ago < MINUTE) return i18n.t('Synced just now')
  if (ago < HOUR) return i18n.t('Synced {{count}} min ago', { count: Math.floor(ago / MINUTE) })
  if (ago < DAY) return i18n.t('Synced {{count}} h ago', { count: Math.floor(ago / HOUR) })
  return i18n.t('Synced {{count}} days ago', { count: Math.floor(ago / DAY) })
}

/**
 * One line for a source's row: Paused (a job waits while background work is paused), the running job's progress (or
 * Syncing…/Reviewing…), the latest job's "{label} stopped: {error}" with its fix (before a running job of the other
 * kind), "Synced {time}", or Connected.
 * Never a retry count.
 */
export function sourceStatusLine(
  source: ConnectedSource,
  jobs: BackgroundJob[],
  now: number,
  paused: boolean
): SourceStatusLine {
  const mine = jobs.filter((j) => j.sourceId === source.id).sort((a, b) => b.startedAt - a.startedAt)
  // The newest needs-you job that is still the latest of its kind: a later run of that kind supersedes it. It comes
  // before a running job of the other kind, so its fix is never hidden.
  const stuck = mine.find((j) => j.status === 'needs-you' && mine.find((k) => k.kind === j.kind) === j)
  const running = mine.find((j) => j.status === 'running')
  if (running && !stuck) {
    // A run already in progress finishes while paused, so its progress still shows.
    if (running.progress) return { text: running.progress }
    if (paused) return { text: i18n.t('Paused') }
    if (isWaitingToRetry(running, now)) return { text: i18n.t('Trying again shortly') }
    return { text: running.kind === 'review' ? i18n.t('Reviewing…') : i18n.t('Syncing…') }
  }
  if (stuck) {
    // The label is stored display text and the error a service's message: both are values, never keys.
    const text = i18n.t('{{label}} stopped: {{reason}}', {
      label: stuck.label,
      reason: stuck.error ?? i18n.t('Unknown error'),
    })
    return stuck.fix ? { text, fix: stuck.fix, jobId: stuck.id } : { text, jobId: stuck.id }
  }
  if (source.lastSyncAt !== undefined) return { text: syncedText(source.lastSyncAt, now) }
  return { text: i18n.t('Connected') }
}

// Sources removed in the last 5 s: hidden at once, revoked when the undo window ends. Module-level, so leaving the
// page does not cancel a removal.
const hiddenStore = createStore<{ ids: ReadonlySet<string> }>()(() => ({ ids: new Set<string>() }))
const removalTimers = new Map<string, ReturnType<typeof setTimeout>>()

function setHidden(id: string, hidden: boolean): void {
  hiddenStore.setState((s) => {
    const ids = new Set(s.ids)
    if (hidden) ids.add(id)
    else ids.delete(id)
    return { ids }
  })
}

/** Ids of sources whose removal is waiting out its undo window; lists leave them out. */
export function useHiddenSourceIds(): ReadonlySet<string> {
  return useStore(hiddenStore, (s) => s.ids)
}

function removeWithUndo(source: ConnectedSource): void {
  if (removalTimers.has(source.id)) return
  setHidden(source.id, true)
  removalTimers.set(
    source.id,
    setTimeout(() => {
      removalTimers.delete(source.id)
      revokeSource(source.id)
        .catch((error) => {
          console.warn('[sources] Could not remove the source', error)
          // The row comes back; removing it again repeats every step. The label is user or service text (a value).
          addToast(i18n.t("Couldn't remove {{label}}", { label: source.label }))
        })
        .finally(() => setHidden(source.id, false))
    }, REMOVE_DELAY_MS)
  )
  pushUndo({
    // The label is user or service text, passed as a value.
    message: i18n.t('Removed {{label}}. Approved knowledge stays.', { label: source.label }),
    undo: () => {
      const timer = removalTimers.get(source.id)
      if (timer === undefined) return
      clearTimeout(timer)
      removalTimers.delete(source.id)
      setHidden(source.id, false)
    },
    group: 'other',
  })
}

export function _resetPendingRemovalsForTests(): void {
  for (const timer of removalTimers.values()) clearTimeout(timer)
  removalTimers.clear()
  hiddenStore.setState({ ids: new Set<string>() })
}

/** Focuses the first button of a listed source's row (after the sheet connected it and the list re-rendered). */
export function focusSourceRow(sourceId: string): void {
  requestAnimationFrame(() => {
    const row = Array.from(document.querySelectorAll('[data-source-id]')).find(
      (el): el is HTMLElement => el instanceof HTMLElement && el.dataset.sourceId === sourceId
    )
    row?.querySelector<HTMLElement>('button')?.focus()
  })
}

/**
 * A connected source: kind and label, status line (with the fix button when a job needs you), the Background review
 * switch for kinds that support it, and a menu with Sync now (kinds that sync, main window only) and Remove.
 * Outside the jobs window, changes open Sources in the main window instead. Until the window's role is known, the fix
 * is hidden and Remove and the switch are disabled, so a click never navigates where it should have acted.
 */
export function SourceRow({ source, scopeName }: { source: ConnectedSource; scopeName?: string }) {
  const { t } = useTranslation()
  const def = getSourceKind(source.kind)
  const jobs = useBackgroundJobs(source.scopeId)
  const paused = readBackgroundPaused(useSettingsStore((s) => s.backgroundPaused))
  const now = useNow()
  const role = useWindowRole()
  const hidden = useHiddenSourceIds().has(source.id)
  const [menuOpen, setMenuOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const switchLabelId = useId()
  const switchHintId = useId()

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => {
      const target = e.target as Node
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  if (hidden) return null

  const status = sourceStatusLine(source, jobs, now, paused)
  const syncRunning = jobs.some((j) => j.sourceId === source.id && j.kind === 'sync' && j.status === 'running')
  // Jobs start only in the jobs window (R6); a source that never synced can still be synced now.
  const canSyncNow = role === 'jobs' && !!def?.sync

  const roleKnown = role !== undefined

  /** Runs `fn` in the jobs window; anywhere else opens Sources in the main window, where configuring happens. */
  const inJobsWindow = (fn: () => void | Promise<void>) => {
    if (!roleKnown) return
    if (role === 'jobs') return void Promise.resolve(fn()).catch((e) => console.warn('[sources] Action failed', e))
    void openConfiguration(SOURCES_SETTINGS_ROUTE)
  }

  const syncNow = () => {
    setMenuOpen(false)
    if (role !== 'jobs') return
    startJob({
      kind: 'sync',
      label: syncJobLabel(source.kind),
      scopeId: source.scopeId,
      sourceId: source.id,
      sourceLabel: source.label,
    })
  }

  const remove = () => {
    setMenuOpen(false)
    inJobsWindow(() => removeWithUndo(source))
  }

  return (
    <li className="dg-item" data-source-id={source.id} style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
      <div className="dg-item__text">
        <div className="dg-type-body">
          <span className="dg-item__meta">{def ? t(def.name) : source.kind}</span>{' '}
          {/* Source labels are user or service text: rendered as children. */}
          <span>{source.label}</span>
        </div>
        <div className="dg-item__meta">
          {scopeName ? <span>{scopeName} · </span> : null}
          <span>{status.text}</span>
        </div>
        {status.fix && status.jobId && roleKnown ? (
          <div className="dg-item__actions" style={{ justifyContent: 'flex-start' }}>
            <button
              type="button"
              className="dg-btn"
              onClick={() => inJobsWindow(() => runJobFix(status.jobId as string))}
            >
              {t(status.fix.label)}
            </button>
          </div>
        ) : null}
        {def?.supportsBackgroundReview ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                role="switch"
                className="dg-switch"
                aria-checked={source.backgroundReview ? 'true' : 'false'}
                aria-labelledby={switchLabelId}
                aria-describedby={switchHintId}
                disabled={!roleKnown}
                onClick={() =>
                  inJobsWindow(() => updateSource(source.id, { backgroundReview: !source.backgroundReview }))
                }
              />
              <span id={switchLabelId} className="dg-type-callout">
                {t('Background review')}
              </span>
            </div>
            <span id={switchHintId} className="dg-item__meta">
              {t(BACKGROUND_REVIEW_LINE)}
            </span>
          </div>
        ) : null}
      </div>
      <div className="dg-item__actions">
        <button
          ref={trigger}
          type="button"
          className="dg-btn dg-btn--ghost dg-btn--icon"
          aria-label={t('Actions for {{label}}', { label: source.label })}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <IconDots size={16} aria-hidden />
        </button>
      </div>
      {menuOpen ? (
        <div
          ref={menu}
          role="menu"
          className="dg-menu"
          style={{ gridColumn: '1 / -1', justifySelf: 'end' }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setMenuOpen(false)
              trigger.current?.focus()
            }
          }}
        >
          {canSyncNow ? (
            <button type="button" role="menuitem" disabled={syncRunning} onClick={syncNow}>
              {t('Sync now')}
            </button>
          ) : null}
          <button type="button" role="menuitem" className="is-danger" disabled={!roleKnown} onClick={remove}>
            {t('Remove')}
          </button>
        </div>
      ) : null}
    </li>
  )
}
