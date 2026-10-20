/**
 * Plan card rules (slice 6a): which steps a plan has, which state its card is in, and how far a run got.
 * Pure; the card and the plan lifecycle (`planTitle`) share this one step parser.
 */
import type { Message, MessagePlanPart, Session } from '@shared/types'
import type { Task, TaskStatus } from '@/stores/taskStore'

export type PlanCardState = 'proposed' | 'running' | 'stopped' | 'finished' | 'rejected' | 'revised'

export type PlanStepView = { title: string; status: 'pending' | 'current' | 'done' | 'failed' }

export const MAX_PLAN_STEPS = 20

/** A list item: up to 3 spaces of indent, a marker ("1." "2)" or "-" "*" "+"), a space, the text. */
const ITEM_LINE = /^( {0,3}|\t?)(\d+[.)]|[-*+])\s+(.+)$/
const ANY_ITEM_LINE = /^\s*(?:\d+[.)]|[-*+])\s+\S/
const HEADING_LINE = /^\s{0,3}#{1,6}\s/
const FENCE_LINE = /^\s*(```|~~~)/
/** A section label such as "Risks:", "**Notes**" or "**Risks:**" on a line of its own. */
const LABEL_LINE = /^\s*(?:\*\*[^*]+\*\*:?|__[^_]+__:?|[^\s].*:)\s*$/

type ParsedSteps = { steps: string[]; stepLines: Set<number> }

/**
 * The steps are the top-level items of the plan's first list, at most 20:
 * - The first item line (outside code fences, indent 0–3) opens the list and fixes its indent and kind: numbered
 *   ("1." / "1)") or bulleted ("-", "*", "+").
 * - Items of the same kind at that indent (one extra space allowed) are steps. Deeper lines (nested bullets,
 *   continuation text, indented code) and blank lines belong to the current step.
 * - The list ends at a heading, a code fence, a section label ("Risks:", "**Notes**"), an item of the other kind at
 *   the list's indent, or a non-item line at the list's indent that follows a blank line (prose after the list).
 *   Such a line straight after an item line is a lazy continuation of that item.
 */
function parseSteps(planText: string): ParsedSteps {
  const steps: string[] = []
  const stepLines = new Set<number>()
  const lines = planText.split(/\r?\n/)
  let list: { indent: number; numbered: boolean } | null = null
  let inFence = false
  let afterBlank = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (FENCE_LINE.test(line)) {
      if (list && indentOf(line) <= list.indent + 1) break
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (!line.trim()) {
      afterBlank = true
      continue
    }
    const item = ITEM_LINE.exec(line)
    if (!list) {
      if (item) list = { indent: indentOf(line), numbered: /\d/.test(item[2]) }
      else continue
    }
    const indent = indentOf(line)
    const topLevel = indent <= list.indent + 1
    if (topLevel && HEADING_LINE.test(line)) break
    if (topLevel && item) {
      if (/\d/.test(item[2]) !== list.numbered) break
      const step = item[3].trim()
      if (step) {
        steps.push(step)
        stepLines.add(i)
        if (steps.length === MAX_PLAN_STEPS) break
      }
    } else if (topLevel && !ANY_ITEM_LINE.test(line)) {
      if (afterBlank || LABEL_LINE.test(line)) break
    }
    afterBlank = false
  }
  return { steps, stepLines }
}

function indentOf(line: string): number {
  const lead = /^[ \t]*/.exec(line)?.[0] ?? ''
  return lead.replace(/\t/g, '    ').length
}

/** The plan's steps (see parseSteps for the exact rule). Prose without a list has no steps. */
export function parsePlanSteps(planText: string): string[] {
  return parseSteps(planText).steps
}

/** Whether the plan says more than its step lines (an intro, nested detail, notes): the card then offers the full text. */
export function planHasMoreThanSteps(planText: string): boolean {
  const { stepLines } = parseSteps(planText)
  return planText.split(/\r?\n/).some((line, i) => line.trim() !== '' && !stepLines.has(i))
}

/**
 * An execution run of an approved plan (Run plan or Continue): its answer carries the approved plan part. Such a run
 * keeps its own bookkeeping (planPhase, the plan part), so a bare retry must not re-run it; the card's Continue is the
 * fix. Shared by generation, the rate-limit retry and the error notice.
 */
export function isApprovedPlanRun(msg: Pick<Message, 'contentParts'>): boolean {
  return msg.contentParts.some((part) => part.type === 'plan' && part.status === 'approved')
}

/**
 * Superseded by a newer version after Request changes: stored as 'rejected' plus `revised: true` (older builds read it
 * as rejected); a stored 'revised' from an early 6a build reads the same.
 */
export function isRevisedPlan(plan: Pick<MessagePlanPart, 'status' | 'revised'>): boolean {
  return plan.status === 'revised' || (plan.status === 'rejected' && plan.revised === true)
}

/**
 * pending → proposed; revised (isRevisedPlan) → revised; rejected → rejected. An approved plan is running while its
 * message generates, finished once it has `finishedAt`, and stopped otherwise. A legacy approved plan (no `startedAt`) reads as finished.
 */
export function planCardState(plan: MessagePlanPart, generating: boolean): PlanCardState {
  if (isRevisedPlan(plan)) return 'revised'
  switch (plan.status) {
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
 * Origin for a plan's run timer and finished duration: when the current run started, moved back by the time of earlier,
 * stopped runs (`runMs`), so a plan continued later never counts the time it sat stopped. Undefined for a legacy plan.
 */
export function planRunOrigin(plan: Pick<MessagePlanPart, 'startedAt' | 'runStartedAt' | 'runMs'>): number | undefined {
  const runStart = plan.runStartedAt ?? plan.startedAt
  return runStart === undefined ? undefined : runStart - (plan.runMs ?? 0)
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

/** Plan mode is on for a chat: its plan-mode setting, in an agent chat (plan mode means nothing without agent mode). */
export function isPlanModeOn(session: Pick<Session, 'agentMode' | 'settings'>): boolean {
  return Boolean(session.agentMode && session.settings?.planMode)
}

/**
 * Whether the chat has a plan-mode toggle in its composer (desktop settings, not a room of two or more agents), so a
 * blocked Continue may offer "Turn on plan mode" there too. Pass `platformCapabilities.supportsDesktopOnlySettings`.
 */
export function planModeToggleShown(session: Pick<Session, 'agentIds'>, supportsDesktopOnlySettings: boolean): boolean {
  return supportsDesktopOnlySettings && (session.agentIds?.length ?? 0) < 2
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
