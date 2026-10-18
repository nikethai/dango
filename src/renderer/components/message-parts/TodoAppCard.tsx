/**
 * In-chat Todo mini-app — studio checklist bound to taskStore (live) with snapshot fallback.
 */

import clsx from 'clsx'
import { type FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TaskSnapshot } from '@/packages/tools/task-tools'
import { type TaskStatus, taskStore, useTaskStore } from '@/stores/taskStore'

const statusLabelKey: Record<TaskStatus, string> = {
  pending: 'Pending',
  'in-progress': 'In Progress',
  done: 'Done',
  failed: 'Failed',
}

/** Collapse completed rows by default when the list would otherwise be a wall of Done. */
const COMPLETED_COLLAPSE_THRESHOLD = 2

function StatusGlyph({ status }: { status: TaskStatus }) {
  if (status === 'done') {
    return (
      <span className="todo-app-glyph is-done" aria-hidden>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M2.5 6.2L4.8 8.5L9.5 3.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    )
  }
  if (status === 'in-progress') {
    return <span className="todo-app-glyph is-progress" aria-hidden />
  }
  if (status === 'failed') {
    return (
      <span className="todo-app-glyph is-failed" aria-hidden>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3.5 3.5L8.5 8.5M8.5 3.5L3.5 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>
    )
  }
  return <span className="todo-app-glyph is-pending" aria-hidden />
}

export type TodoAppCardProps = {
  sessionId: string
  /** Frozen tasks from message tool results when store is empty */
  snapshot?: TaskSnapshot[]
  /** Allow user to toggle done/pending (v1) */
  interactive?: boolean
  className?: string
  /** Skip staggered enter (history rehydrate) */
  skipEnterAnimation?: boolean
}

const EMPTY_SNAPSHOT: TaskSnapshot[] = []

export const TodoAppCard: FC<TodoAppCardProps> = ({
  sessionId,
  snapshot = EMPTY_SNAPSHOT,
  interactive = true,
  className,
  skipEnterAnimation = false,
}) => {
  const { t } = useTranslation()
  // Select stable store slice — never `.filter()` inside the selector (new array → infinite re-render / React #185)
  const allTasks = useTaskStore((s) => s.tasks)
  const toggleTaskDone = useTaskStore((s) => s.toggleTaskDone)
  const liveTasks = useMemo(() => allTasks.filter((task) => task.sessionId === sessionId), [allTasks, sessionId])

  // The task dock used to load the session's tasks; the card does now, so toggles work after a reload.
  useEffect(() => {
    void taskStore.getState().hydrateSessionTasks(sessionId)
  }, [sessionId])

  const items: TaskSnapshot[] = useMemo(() => {
    if (snapshot.length > 0) {
      if (liveTasks.length === 0) return snapshot
      const liveById = new Map(liveTasks.map((task) => [task.id, task]))
      return snapshot.map((entry) => {
        const live = liveById.get(entry.id)
        if (!live) return entry
        return {
          id: live.id,
          title: live.title,
          status: live.status,
          progress: live.progress,
        }
      })
    }
    return liveTasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      progress: task.progress,
    }))
  }, [liveTasks, snapshot])

  const summary = useMemo(() => {
    const total = items.length
    const done = items.filter((i) => i.status === 'done').length
    const failed = items.filter((i) => i.status === 'failed').length
    const inProgress = items.filter((i) => i.status === 'in-progress').length
    const remaining = items.filter((i) => i.status === 'pending' || i.status === 'in-progress').length
    const pct = total > 0 ? Math.round(((done + failed) / total) * 100) : 0
    const allComplete = total > 0 && remaining === 0 && failed === 0
    return { total, done, failed, inProgress, remaining, pct, allComplete }
  }, [items])

  // Collapse by default when the checklist is finished or would be a huge Done wall.
  const [collapsed, setCollapsed] = useState(() => summary.allComplete || summary.done >= COMPLETED_COLLAPSE_THRESHOLD)
  const [showCompleted, setShowCompleted] = useState(false)

  const activeItems = useMemo(
    () => items.filter((item) => item.status !== 'done'),
    [items]
  )
  const completedItems = useMemo(
    () => items.filter((item) => item.status === 'done'),
    [items]
  )
  const collapseCompleted = completedItems.length > COMPLETED_COLLAPSE_THRESHOLD
  const visibleCompleted =
    !collapseCompleted || showCompleted ? completedItems : ([] as TaskSnapshot[])

  const onToggle = useCallback(
    (id: string, status: TaskStatus) => {
      if (!interactive) return
      // Only toggle between done and pending/in-progress when live store owns the id
      if (!liveTasks.some((t) => t.id === id)) return
      if (status === 'failed') {
        toggleTaskDone(id)
        return
      }
      toggleTaskDone(id)
    },
    [interactive, liveTasks, toggleTaskDone]
  )

  if (items.length === 0) return null

  const headSubtitle = summary.allComplete
    ? t('All done')
    : summary.inProgress > 0
      ? t('In Progress')
      : summary.remaining > 0
        ? t('{{count}} remaining', { count: summary.remaining })
        : null

  return (
    <div
      className={clsx(
        'todo-app',
        className,
        skipEnterAnimation && 'is-static',
        summary.allComplete && 'is-all-complete'
      )}
    >
      <div className="todo-app-shell">
        <div className="todo-app-core">
          <button
            type="button"
            className="todo-app-head"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
          >
            <span className="todo-app-eyebrow">{t('Tasks')}</span>
            <span className="todo-app-count tabular-nums">
              {summary.done}/{summary.total}
            </span>
            {headSubtitle ? (
              <span
                className={clsx('todo-app-live', summary.allComplete && 'is-complete')}
                aria-hidden
              >
                {headSubtitle}
              </span>
            ) : null}
            <span className={clsx('todo-app-chevron', !collapsed && 'is-open')} aria-hidden>
              ›
            </span>
          </button>

          {!collapsed && (
            <>
              <div className="todo-app-progress-track" aria-hidden>
                <div
                  className={clsx(
                    'todo-app-progress-fill',
                    summary.failed > 0 && 'is-warn',
                    summary.allComplete && 'is-complete'
                  )}
                  style={{ transform: `scaleX(${summary.pct / 100})` }}
                />
              </div>
              <ul className="todo-app-list" role="list">
                {activeItems.map((item, index) => {
                  const canToggle = interactive && liveTasks.some((t) => t.id === item.id)
                  return (
                    <li
                      key={item.id}
                      className={clsx('todo-app-row', `is-${item.status}`)}
                      style={
                        skipEnterAnimation
                          ? undefined
                          : { animationDelay: `${Math.min(index, 12) * 40}ms` }
                      }
                    >
                      <button
                        type="button"
                        className={clsx('todo-app-check', canToggle && 'is-interactive')}
                        onClick={() => onToggle(item.id, item.status)}
                        disabled={!canToggle}
                        aria-label={t('Mark as done: {{title}}', { title: item.title })}
                        aria-pressed={false}
                      >
                        <StatusGlyph status={item.status} />
                      </button>
                      <div className="todo-app-row-main min-w-0">
                        <span className="todo-app-title">{item.title}</span>
                        {item.status === 'in-progress' && item.progress != null && (
                          <span className="todo-app-row-meta tabular-nums">{item.progress}%</span>
                        )}
                      </div>
                      {item.status !== 'pending' ? (
                        <span className={clsx('todo-app-status', `is-${item.status}`)}>
                          {t(statusLabelKey[item.status])}
                        </span>
                      ) : null}
                    </li>
                  )
                })}

                {collapseCompleted && !showCompleted && completedItems.length > 0 ? (
                  <li className="todo-app-row is-toggle">
                    <button
                      type="button"
                      className="todo-app-completed-toggle"
                      onClick={() => setShowCompleted(true)}
                    >
                      {t('Show {{count}} completed', { count: completedItems.length })}
                    </button>
                  </li>
                ) : null}

                {visibleCompleted.map((item) => {
                  const canToggle = interactive && liveTasks.some((t) => t.id === item.id)
                  return (
                    <li key={item.id} className="todo-app-row is-done is-complete">
                      <button
                        type="button"
                        className={clsx('todo-app-check', canToggle && 'is-interactive')}
                        onClick={() => onToggle(item.id, item.status)}
                        disabled={!canToggle}
                        aria-label={t('Mark as pending: {{title}}', { title: item.title })}
                        aria-pressed
                      >
                        <StatusGlyph status={item.status} />
                      </button>
                      <div className="todo-app-row-main min-w-0">
                        <span className="todo-app-title">{item.title}</span>
                      </div>
                    </li>
                  )
                })}

                {collapseCompleted && showCompleted && completedItems.length > 0 ? (
                  <li className="todo-app-row is-toggle">
                    <button
                      type="button"
                      className="todo-app-completed-toggle"
                      onClick={() => setShowCompleted(false)}
                    >
                      {t('Hide completed')}
                    </button>
                  </li>
                ) : null}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default TodoAppCard
