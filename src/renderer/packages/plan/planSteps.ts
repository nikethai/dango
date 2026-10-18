/**
 * Plan card rules (slice 6a): which steps a plan has, which state its card is in, and how far a run got.
 * Pure; the card and the plan lifecycle (`planTitle`) share this one step parser.
 */
import type { MessagePlanPart } from '@shared/types'
import type { Task, TaskStatus } from '@/stores/taskStore'

export type PlanCardState = 'proposed' | 'running' | 'stopped' | 'finished' | 'rejected' | 'revised'

export type PlanStepView = { title: string; status: 'pending' | 'current' | 'done' | 'failed' }

export const MAX_PLAN_STEPS = 20

/** "1. Find", "2) Update", "- Move", "* Log". */
const STEP_LINE = /^\s*(?:\d+[.)]|[-*])\s+(.+)$/

/** The plan's numbered or bulleted lines, in order, at most 20. Prose without such lines has no steps. */
export function parsePlanSteps(planText: string): string[] {
  const steps: string[] = []
  for (const line of planText.split('\n')) {
    const step = STEP_LINE.exec(line)?.[1]?.trim()
    if (!step) continue
    steps.push(step)
    if (steps.length === MAX_PLAN_STEPS) break
  }
  return steps
}

/**
 * pending → proposed; revised → revised; rejected → rejected. An approved plan is running while its message generates,
 * finished once it has `finishedAt`, and stopped otherwise. A legacy approved plan (no `startedAt`) reads as finished.
 */
export function planCardState(plan: MessagePlanPart, generating: boolean): PlanCardState {
  switch (plan.status) {
    case 'revised':
      return 'revised'
    case 'rejected':
      return 'rejected'
    case 'approved':
      if (generating) return 'running'
      if (plan.finishedAt !== undefined || plan.startedAt === undefined) return 'finished'
      return 'stopped'
    default:
      return 'proposed'
  }
}

/**
 * The tasks of one plan run: the session's tasks created since the run started (`startedAt`), so a stopped or finished
 * earlier run's checklist never counts. Without `startedAt` (legacy) every task of the session counts.
 */
export function planRunTasks(tasks: Task[], sessionId: string, startedAt: number | undefined): Task[] {
  return tasks.filter(
    (task) => task.sessionId === sessionId && (startedAt === undefined || task.createdAt >= startedAt)
  )
}

/** Whether a stopped plan's card offers Continue: ready, disabled (plan mode off), or not at all. */
export type PlanContinueState = 'ready' | 'blocked' | 'hidden'

/**
 * Continue resumes only the chat's latest plan while it is still the last message and nothing else generates; with
 * plan mode off it shows disabled (the run would lose its plan).
 */
export function planContinueState(chat: {
  latestPlan: boolean
  isTail: boolean
  generationActive: boolean
  planModeOn: boolean
}): PlanContinueState {
  if (!chat.latestPlan || !chat.isTail || chat.generationActive) return 'hidden'
  return chat.planModeOn ? 'ready' : 'blocked'
}

const TASK_STEP: Record<TaskStatus, PlanStepView['status']> = {
  done: 'done',
  'in-progress': 'current',
  pending: 'pending',
  failed: 'failed',
}

/** The run's tasks (creation order) when there are any; otherwise the parsed steps, all pending. */
export function planStepViews(planText: string, tasks: Task[]): PlanStepView[] {
  if (tasks.length > 0) {
    return [...tasks]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((task) => ({ title: task.title, status: TASK_STEP[task.status] }))
  }
  return parsePlanSteps(planText).map((title) => ({ title, status: 'pending' }))
}

const STATUS_SORT: Record<TaskStatus, number> = {
  'in-progress': 0,
  pending: 1,
  failed: 2,
  done: 3,
}

/** Active work first, completed last; creation order within a status. */
export function sortTasksForDisplay(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const byStatus = STATUS_SORT[a.status] - STATUS_SORT[b.status]
    if (byStatus !== 0) return byStatus
    return a.createdAt - b.createdAt
  })
}
