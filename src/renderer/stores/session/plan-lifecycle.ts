/**
 * Plan versions, run timing and the one Change entry a finished plan files in Review (slice 6a).
 */
import type { Message, MessagePlanPart, Session } from '@shared/types'
import { t } from 'i18next'
import { scopeIdForSession } from '@/packages/chat-review'
import { getStagedChangeSetId } from '@/packages/model-calls/toolsets/file'
import { parsePlanSteps } from '@/packages/plan/planSteps'
import { addReviewEntry } from '@/packages/review'

const TITLE_MAX = 80
const EDIT_TOOLS = new Set(['create_file', 'edit_file', 'delete_file'])
/** `${messageId}:${finishedAt}` of plans already filed, so a retried finish cannot file twice. */
const recordedPlans = new Set<string>()

const planOf = (message: Message): MessagePlanPart | undefined =>
  message.contentParts.find((part): part is MessagePlanPart => part.type === 'plan')

/** Version for a new plan written into `beforeMessageId`: one past the latest earlier plan when that one was revised. */
export function nextPlanVersion(messages: Message[], beforeMessageId: string): number {
  const end = messages.findIndex((m) => m.id === beforeMessageId)
  const earlier = end === -1 ? messages : messages.slice(0, end)
  for (let i = earlier.length - 1; i >= 0; i--) {
    const plan = planOf(earlier[i])
    if (!plan) continue
    return plan.status === 'revised' ? (plan.version ?? 1) + 1 : 1
  }
  return 1
}

/** A short title: the first numbered or bulleted step, else the first non-empty line, at most 80 characters. */
export function planTitle(planText: string): string {
  const firstLine = planText
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
  const title = parsePlanSteps(planText)[0] ?? firstLine ?? ''
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1).trimEnd()}…` : title
}

/**
 * The approved plan as kept when its run ends: `finishedAt` only when the run ended on its own. Stop counts during the
 * main stream and during the closing-answer (continue) stream, which registers its own abort and is read separately.
 */
export function finishExecutedPlan(
  plan: MessagePlanPart,
  run: { stoppedDuringStream: boolean; stoppedDuringContinue: boolean; now: number }
): MessagePlanPart {
  return run.stoppedDuringStream || run.stoppedDuringContinue ? plan : { ...plan, finishedAt: run.now }
}

/** Continue applies to an approved plan whose run started and was stopped before it finished. */
export function canResumePlan(plan: MessagePlanPart | undefined): boolean {
  return plan?.status === 'approved' && plan.startedAt !== undefined && plan.finishedAt === undefined
}

/** The stopped run's visible work, kept in front of the resumed run's parts (the plan part is re-added by the run). */
export function resumedRunParts(contentParts: Message['contentParts']): Message['contentParts'] {
  return contentParts.filter((part) => part.type !== 'plan')
}

/** A stream update of the resumed run, painted after the stopped run's work. */
export function withResumedParts<T extends { contentParts?: Message['contentParts'] }>(
  resumed: Message['contentParts'],
  update: T
): T {
  return update.contentParts ? { ...update, contentParts: [...resumed, ...update.contentParts] } : update
}

/** Model instruction for a resumed run (not interface copy). */
export function planResumePrompt(): string {
  return [
    'The run of the approved plan was stopped before it finished. Your work so far is above.',
    'Continue the plan from where it stopped: first inspect the current tasks, then resume the next unfinished step.',
    'Do not redo finished steps. Update task statuses as you go.',
  ].join('\n')
}

function madeEdits(message: Message | undefined): boolean {
  return Boolean(
    message?.contentParts.some(
      (part) => part.type === 'tool-call' && part.state === 'result' && EDIT_TOOLS.has(part.toolName)
    )
  )
}

function findMessage(session: Session, messageId: string): Message | undefined {
  const lists = [session.messages, ...(session.threads ?? []).map((thread) => thread.messages)]
  for (const list of lists) {
    const found = list.find((m) => m.id === messageId)
    if (found) return found
  }
  return undefined
}

/**
 * Files one Change entry for a finished plan whose run staged edits: a change set is staged for the chat and the plan
 * message holds at least one finished create/edit/delete call. A stopped run (no `finishedAt`) files nothing.
 */
export async function recordFinishedPlan(session: Session, messageId: string, plan: MessagePlanPart): Promise<void> {
  if (plan.finishedAt === undefined) return
  const key = `${messageId}:${plan.finishedAt}`
  if (recordedPlans.has(key)) return
  const changeSetId = getStagedChangeSetId(session.id)
  if (!changeSetId || !madeEdits(findMessage(session, messageId))) return
  recordedPlans.add(key)
  // External text (plan, chat name) is substituted once and stored as plain text; nothing re-parses it.
  const literal = { interpolation: { escapeValue: false } }
  try {
    await addReviewEntry({
      kind: 'change',
      ref: { type: 'change', id: changeSetId },
      text: t('Plan finished: {{title}}', { ...literal, title: planTitle(plan.planText) }),
      sub: t('From the chat "{{chat}}"', { ...literal, chat: session.name }),
      scopeId: scopeIdForSession(session),
      chatId: session.id,
    })
  } catch (error) {
    recordedPlans.delete(key) // a failed write may be retried
    throw error
  }
}
