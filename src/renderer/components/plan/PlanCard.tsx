import type { MessagePlanPart } from '@shared/types'
import type { TFunction } from 'i18next'
import { ChevronRight } from 'lucide-react'
import { type JSX, type KeyboardEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mascot } from '@/components/brand/Mascot'
import Markdown from '@/components/Markdown'
import { formatDangoDuration, useThinkingTimer } from '@/hooks/useThinkingTimer'
import {
  type PlanContinueState,
  type PlanStepView,
  parsePlanSteps,
  planCardState,
  planRunOrigin,
  planRunTasks,
  planStepViews,
} from '@/packages/plan/planSteps'
import { type Task, taskStore, useTaskStore } from '@/stores/taskStore'
import { isEditableTarget } from '@/utils/isEditableTarget'

export type PlanCardProps = {
  plan: MessagePlanPart
  sessionId: string
  generating: boolean
  touchesFiles: boolean
  /** The chat's latest plan: only its card reads the session's tasks for progress. Default false (MessageList opts in). */
  latestPlan?: boolean
  onRun(): Promise<void>
  onRequestChanges(feedback: string): Promise<void>
  onReject(): Promise<void>
  onStop(): void
  /** Continue a stopped run of this plan. */
  onContinue(): Promise<void>
  /** Whether a stopped card offers Continue (see planContinueState). Default hidden. */
  continueState?: PlanContinueState
}

type Action = 'run' | 'request-changes' | 'reject' | 'continue'

const NO_TASKS: Task[] = []

/** Runs one card action at a time; a failure is shown on the card and the buttons come back. */
function useCardAction() {
  const [pending, setPending] = useState<Action | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(async (action: Action, operation: () => Promise<unknown>) => {
    setPending(action)
    setError(null)
    try {
      await operation()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(null)
    }
  }, [])
  return { pending, error, run }
}

function StepList({ steps }: { steps: PlanStepView[] }) {
  const { t } = useTranslation()
  const numbered = steps.map((step, index) => ({ ...step, n: index + 1 }))
  return (
    <ol>
      {numbered.map((step) => (
        <li
          key={step.n}
          className={step.status === 'pending' ? undefined : `is-${step.status}`}
          aria-current={step.status === 'current' ? 'step' : undefined}
        >
          <span className="dg-plan__n">{step.n}</span>
          {/* Step text is the model's: rendered as children, never through i18next. */}
          <span className="dg-plan__step">{step.title}</span>
          {step.status === 'done' || step.status === 'failed' ? (
            <span className="sr-only">{step.status === 'done' ? t('Done') : t('Failed')}</span>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

function PlanBody({ steps, planText }: { steps: PlanStepView[]; planText: string }) {
  if (steps.length > 0) return <StepList steps={steps} />
  return (
    <div className="dg-plan__body">
      <Markdown enableLaTeXRendering={false} enableMermaidRendering={false}>
        {planText}
      </Markdown>
    </div>
  )
}

function ProposedPlan({
  plan,
  steps,
  touchesFiles,
  onRun,
  onRequestChanges,
  onReject,
}: Pick<PlanCardProps, 'plan' | 'touchesFiles' | 'onRun' | 'onRequestChanges' | 'onReject'> & {
  steps: PlanStepView[]
}) {
  const { t } = useTranslation()
  const { pending, error, run } = useCardAction()
  const [showForm, setShowForm] = useState(false)
  const [feedback, setFeedback] = useState('')
  const cardRef = useRef<HTMLElement>(null)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const busy = pending !== null

  useEffect(() => {
    if (showForm) fieldRef.current?.focus()
  }, [showForm])

  const closeForm = () => {
    setShowForm(false)
    cardRef.current?.focus()
  }

  const runPlan = () => void run('run', onRun)
  const reject = () => void run('reject', onReject)
  const requestChanges = () => void run('request-changes', () => onRequestChanges(feedback))

  // Card keys: only when the card itself (or plain text in it) has focus, never from a field or a button.
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (busy || e.metaKey || e.ctrlKey || e.altKey) return
    const target = e.target as Element | null
    if (isEditableTarget(target) || target?.closest?.('button, a, summary')) return
    if (e.key === 'Enter') {
      e.preventDefault()
      runPlan()
    } else if (e.key === 'e' || e.key === 'E') {
      e.preventDefault()
      setShowForm(true)
    } else if (e.key === 'Escape') {
      // Escape stays with the card: window-level Escape handlers (the workspace panel's) ignore defaultPrevented.
      e.preventDefault()
      e.stopPropagation()
      if (showForm) closeForm()
      else reject()
    }
  }

  return (
    <section
      ref={cardRef}
      className="dg-plan"
      // The card takes focus so its keys (↵ run · E change · Esc reject) work.
      tabIndex={0}
      aria-label={t('Proposed plan')}
      aria-keyshortcuts="Enter E Escape"
      aria-busy={busy}
      onKeyDown={onKeyDown}
    >
      <div className="dg-plan__head">
        <strong>{t('Proposed plan')}</strong>
        {steps.length > 0 ? <span className="dg-chip">{t('{{count}} steps', { count: steps.length })}</span> : null}
        {touchesFiles ? <span className="dg-chip dg-chip--blue">{t('edits files · asks before applying')}</span> : null}
      </div>
      <PlanBody steps={steps} planText={plan.planText} />
      {showForm ? (
        <div className="dg-plan__feedback">
          <textarea
            ref={fieldRef}
            className="dango-field"
            aria-label={t('Request changes')}
            placeholder={t('Describe what the revised plan should change')}
            value={feedback}
            rows={3}
            disabled={busy}
            onChange={(e) => setFeedback(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return
              e.preventDefault()
              e.stopPropagation()
              closeForm()
            }}
          />
          <div className="dg-plan__actions">
            <button
              type="button"
              className="dg-btn dg-btn--primary"
              disabled={busy || !feedback.trim()}
              onClick={requestChanges}
            >
              {t('Request revised plan')}
            </button>
            <button type="button" className="dg-btn dg-btn--ghost" disabled={busy} onClick={closeForm}>
              {t('Cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div className="dg-plan__actions">
          <button type="button" className="dg-btn dg-btn--primary" disabled={busy} onClick={runPlan}>
            {t('Run plan')}
          </button>
          <button type="button" className="dg-btn" disabled={busy} onClick={() => setShowForm(true)}>
            {t('Request changes')}
          </button>
          <button type="button" className="dg-btn dg-btn--ghost" disabled={busy} onClick={reject}>
            {t('Reject')}
          </button>
          <span className="dg-kbd">{t('↵ run · E change · Esc reject')}</span>
        </div>
      )}
      {error ? (
        <p role="alert" className="dg-plan__error dg-type-caption">
          {error}
        </p>
      ) : null}
    </section>
  )
}

function LivePlan({
  plan,
  steps,
  running,
  touchesFiles,
  onStop,
  onContinue,
  continueState,
}: Pick<PlanCardProps, 'plan' | 'touchesFiles' | 'onStop' | 'onContinue'> & {
  continueState: PlanContinueState
  steps: PlanStepView[]
  running: boolean
}) {
  const { t } = useTranslation()
  const { pending, error, run } = useCardAction()
  const runOrigin = planRunOrigin(plan)
  const elapsed = useThinkingTimer(runOrigin, running)
  const total = steps.length
  const done = steps.filter((step) => step.status === 'done').length
  const currentIndex = steps.findIndex((step) => step.status === 'current')
  const current = currentIndex >= 0 ? currentIndex + 1 : Math.min(done + 1, total)

  const title = running
    ? total > 0
      ? t('Running plan · step {{current}} of {{total}}', { current, total })
      : t('Running plan')
    : total > 0
      ? t('Plan stopped · {{done}} of {{total}} done', { done, total })
      : t('Plan stopped')
  // Every step done: nothing is left to continue.
  const showContinue = continueState !== 'hidden' && !(total > 0 && done === total)
  const blockedHintId = useId()

  return (
    <section className="dg-plan" aria-label={title}>
      <div className="dg-plan__head">
        {running ? <Mascot state="working" size={20} /> : null}
        <strong>{title}</strong>
        {running && runOrigin !== undefined ? (
          <span className="dg-plan__time">{formatDangoDuration(elapsed)}</span>
        ) : null}
      </div>
      <PlanBody steps={steps} planText={plan.planText} />
      <div className="dg-plan__actions">
        {running ? (
          <button type="button" className="dg-btn dg-btn--ghost" onClick={onStop}>
            {t('Stop')}
          </button>
        ) : showContinue ? (
          <button
            type="button"
            className="dg-btn"
            disabled={pending !== null || continueState === 'blocked'}
            aria-describedby={continueState === 'blocked' ? blockedHintId : undefined}
            onClick={() => void run('continue', onContinue)}
          >
            {t('Continue')}
          </button>
        ) : null}
        {!running && showContinue && continueState === 'blocked' ? (
          <span id={blockedHintId} className="dg-plan__note">
            {t("Plan mode is off in this chat, so this plan can't continue.")}
          </span>
        ) : null}
        {running && touchesFiles ? (
          <span className="dg-plan__note">{t('Edits are staged and arrive in Review as one Change.')}</span>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="dg-plan__error dg-type-caption">
          {error}
        </p>
      ) : null}
    </section>
  )
}

function FoldedPlan({ title, steps, planText }: { title: string; steps: PlanStepView[]; planText: string }) {
  return (
    <details className="dg-think dg-plan-fold">
      <summary>
        <span className="dg-think__title">
          {title}
          <ChevronRight className="dg-think__chevron" size={15} strokeWidth={1.8} aria-hidden="true" />
        </span>
      </summary>
      <div className="dg-think__body">
        <PlanBody steps={steps} planText={planText} />
      </div>
    </details>
  )
}

/**
 * A plan in the thread: proposed (Run plan / Request changes / Reject with keys), running with progress and Stop,
 * stopped with Continue, or folded once it finished, was rejected or was revised.
 */
export default function PlanCard({
  plan,
  sessionId,
  generating,
  touchesFiles,
  latestPlan = false,
  onRun,
  onRequestChanges,
  onReject,
  onStop,
  onContinue,
  continueState = 'hidden',
}: PlanCardProps): JSX.Element {
  const { t } = useTranslation()
  const state = planCardState(plan, generating)
  // Tasks are session-wide: only the latest plan's run (running or stopped) reads them.
  const readsTasks = latestPlan && (state === 'running' || state === 'stopped')
  const allTasks = useTaskStore((s) => s.tasks)
  const tasks = useMemo(
    () => (readsTasks ? planRunTasks(allTasks, sessionId, plan.startedAt) : NO_TASKS),
    [readsTasks, allTasks, sessionId, plan.startedAt]
  )

  useEffect(() => {
    if (readsTasks) void taskStore.getState().hydrateSessionTasks(sessionId)
  }, [readsTasks, sessionId])

  const steps = useMemo(() => planStepViews(plan.planText, tasks), [plan.planText, tasks])

  switch (state) {
    case 'proposed':
      return (
        <ProposedPlan
          plan={plan}
          steps={steps}
          touchesFiles={touchesFiles}
          onRun={onRun}
          onRequestChanges={onRequestChanges}
          onReject={onReject}
        />
      )
    case 'running':
    case 'stopped':
      return (
        <LivePlan
          plan={plan}
          steps={steps}
          running={state === 'running'}
          touchesFiles={touchesFiles}
          onStop={onStop}
          onContinue={onContinue}
          continueState={continueState}
        />
      )
    default:
      return <FoldedPlan title={foldedTitle(t, state, plan)} steps={steps} planText={plan.planText} />
  }
}

function foldedTitle(t: TFunction, state: 'finished' | 'rejected' | 'revised', plan: MessagePlanPart): string {
  if (state === 'revised') return t('Plan v{{version}}', { version: plan.version ?? 1 })
  if (state === 'rejected') return t('Rejected plan')
  const count = parsePlanSteps(plan.planText).length
  if (count === 0) return t('Ran plan')
  const runOrigin = planRunOrigin(plan)
  if (runOrigin === undefined || plan.finishedAt === undefined) return t('Ran plan · {{count}} steps', { count })
  const duration = formatDangoDuration(plan.finishedAt - runOrigin)
  return t('Ran plan · {{count}} steps · {{duration}}', { count, duration })
}
