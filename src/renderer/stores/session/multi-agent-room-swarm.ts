/**
 * Swarm orchestrator: lead plan → assign → sequential execute → deliver.
 */

import {
  assignTasks,
  resolveRoomLead,
  MAX_SWARM_TASKS,
  MAX_SWARM_TURNS,
} from '@shared/agent-room'
import { hasActiveSwarmBoard, isSwarmUserInterrupt, parseSwarmPlanFromText } from '@shared/swarm-plan'
import { createMessage, type Message } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import { type AgentMeta, resolveAgentMeta } from '@/packages/agents'
import * as chatStore from '../chatStore'
import { generateTaskId, MAX_SESSION_TASKS, taskStore } from '../taskStore'
import { insertMessage } from './messages'
import { clearTeamRoomState, setTeamRoomLive } from './team-room-state'

export type SwarmSpeakerTurn = (sessionId: string, params: {
  meta: AgentMeta
  roomRole: 'plan' | 'do' | 'deliver'
  participantNames: string[]
  truncateTokenLimit?: number
  skipQueuedMessages: boolean
  leadName?: string
  mode: 'swarm'
  taskId?: string
  taskTitle?: string
  taskIndex?: number
  taskTotal?: number
  participantDirectory?: string
}) => Promise<{ msg: Message; interrupted: boolean }>

function fallbackMeta(agentId: string): AgentMeta {
  return {
    id: agentId,
    name: agentId,
    emojiAvatar: '🤖',
  }
}

function messageHasUsableText(msg: Message | undefined): boolean {
  if (!msg) return false
  if (msg.error || msg.errorCode) return false
  return getMessageText(msg, true, true).trim().length > 0
}

function buildParticipantDirectory(speakers: string[]): string {
  return speakers
    .map((id) => {
      const name = resolveAgentMeta(id)?.name ?? id
      return `${name} (id: ${id})`
    })
    .join('; ')
}

/**
 * Swarm mode: lead plans tasks → auto-assign → sequential execute → lead deliver.
 */
export async function runAgentRoomSwarm(
  sessionId: string,
  params: {
    speakers: string[]
    truncateTokenLimit?: number
    roomLeadId?: string
    generateSpeakerTurn: SwarmSpeakerTurn
  }
): Promise<void> {
  const speakers = params.speakers
  if (speakers.length < 2) return

  const generateSpeakerTurn = params.generateSpeakerTurn
  const participantNames = speakers.map((id) => resolveAgentMeta(id)?.name ?? id)
  const participantDirectory = buildParticipantDirectory(speakers)
  const leadId = resolveRoomLead(speakers, params.roomLeadId) ?? speakers[0]
  const leadMeta = resolveAgentMeta(leadId) ?? fallbackMeta(leadId)
  const leadName = leadMeta.name

  await taskStore.getState().hydrateSessionTasks(sessionId)

  // Fresh board: full clear so create_task is not blocked by prior solo todos (MAX_SESSION_TASKS).
  // Old checklist history is not the Swarm run; chat messages keep prior context.
  taskStore.getState().clearSessionTasks(sessionId)
  const runStartedAt = Date.now()

  let agentTurns = 0
  let interrupted = false

  // Snapshot: the user message that started this swarm is already last in history.
  // Interrupt only when a *new* user message arrives (length grows + last is user).
  const baselineSession = await chatStore.getSession(sessionId)
  if (!baselineSession) return
  const baselineMsgCount = baselineSession.messages.length
  const baselineLastId = baselineSession.messages[baselineMsgCount - 1]?.id

  const userInterrupted = async (): Promise<boolean> => {
    const session = await chatStore.getSession(sessionId)
    if (!session) return true
    return isSwarmUserInterrupt({
      baselineMsgCount,
      baselineLastId,
      messages: session.messages,
    })
  }

  const planTurnParams = {
    meta: leadMeta,
    roomRole: 'plan' as const,
    participantNames,
    truncateTokenLimit: params.truncateTokenLimit,
    skipQueuedMessages: true,
    leadName,
    mode: 'swarm' as const,
    participantDirectory,
  }

  // --- Plan (lead, task tools only) ---
  {
    const { interrupted: planInterrupted, msg: planMsg } = await generateSpeakerTurn(sessionId, planTurnParams)
    agentTurns += 1
    if (planInterrupted) {
      setTeamRoomLive(null)
      clearTeamRoomState(sessionId)
      return
    }

    await materializeSwarmBoardFromPlan(sessionId, planMsg, speakers, runStartedAt)

    // Soft retry once if board still empty
    if (!hasRunBoard(sessionId, runStartedAt) && agentTurns < MAX_SWARM_TURNS) {
      if (await userInterrupted()) {
        setTeamRoomLive(null)
        clearTeamRoomState(sessionId)
        return
      }
      const retry = await generateSpeakerTurn(sessionId, planTurnParams)
      agentTurns += 1
      if (retry.interrupted) {
        setTeamRoomLive(null)
        clearTeamRoomState(sessionId)
        return
      }
      await materializeSwarmBoardFromPlan(sessionId, retry.msg, speakers, runStartedAt)
    }
  }

  applySwarmAssignments(sessionId, speakers, leadId, runStartedAt)

  const pendingOrActive = listRunTasks(sessionId, runStartedAt).filter(
    (t) => t.status === 'pending' || t.status === 'in-progress'
  )
  if (pendingOrActive.length === 0) {
    const total = taskStore.getState().getSessionTasks(sessionId).length
    const capHint =
      total >= MAX_SESSION_TASKS
        ? ` Task limit is full (${total}/${MAX_SESSION_TASKS}).`
        : ''
    await insertMessage(sessionId, {
      ...createMessage(
        'assistant',
        `_Swarm could not build a task board from the plan.${capHint} The lead must call create_task (or emit a JSON/bullet task list). Try a clearer multi-step goal, ensure Agent mode is on if tools fail, or switch to Work mode._`
      ),
      agentId: leadId,
      name: leadName,
      roomRole: 'plan',
    })
    setTeamRoomLive(null)
    clearTeamRoomState(sessionId)
    return
  }

  const runTaskIds = new Set(
    pendingOrActive
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, MAX_SWARM_TASKS)
      .map((t) => t.id)
  )
  const taskTotal = runTaskIds.size
  let taskIndex = 0

  while (agentTurns < MAX_SWARM_TURNS) {
    if (await userInterrupted()) {
      interrupted = true
      break
    }

    const ready = taskStore
      .getState()
      .listReadyTasks(sessionId)
      .filter((t) => runTaskIds.has(t.id))
    if (ready.length === 0) {
      // Stuck pending (failed/missing deps): mark remaining open run tasks failed so deliver can run
      const stuck = listRunTasks(sessionId, runStartedAt).filter(
        (t) => runTaskIds.has(t.id) && (t.status === 'pending' || t.status === 'in-progress')
      )
      for (const t of stuck) {
        taskStore.getState().updateTask(t.id, { status: 'failed' })
      }
      break
    }

    const task = ready[0]
    const assigneeId = task.assigneeAgentId && speakers.includes(task.assigneeAgentId) ? task.assigneeAgentId : leadId
    const meta = resolveAgentMeta(assigneeId) ?? fallbackMeta(assigneeId)
    taskIndex += 1

    taskStore.getState().updateTask(task.id, { status: 'in-progress' })

    const { interrupted: turnInterrupted, msg } = await generateSpeakerTurn(sessionId, {
      meta,
      roomRole: 'do',
      participantNames,
      truncateTokenLimit: params.truncateTokenLimit,
      skipQueuedMessages: true,
      leadName,
      mode: 'swarm',
      taskId: task.id,
      taskTitle: task.title,
      taskIndex,
      taskTotal,
      participantDirectory,
    })
    agentTurns += 1

    if (turnInterrupted) {
      interrupted = true
      const current = taskStore.getState().tasks.find((t) => t.id === task.id)
      if (current?.status === 'in-progress') {
        taskStore.getState().updateTask(task.id, { status: 'pending' })
      }
      break
    }

    const after = taskStore.getState().tasks.find((t) => t.id === task.id)
    if (after && (after.status === 'pending' || after.status === 'in-progress')) {
      if (messageHasUsableText(msg) && !msg.error) {
        taskStore.getState().updateTask(task.id, { status: 'done' })
      } else {
        taskStore.getState().updateTask(task.id, { status: 'failed' })
      }
    }
  }

  if (interrupted) {
    setTeamRoomLive(null)
    clearTeamRoomState(sessionId)
    return
  }

  if (agentTurns < MAX_SWARM_TURNS && !(await userInterrupted())) {
    await generateSpeakerTurn(sessionId, {
      meta: leadMeta,
      roomRole: 'deliver',
      participantNames,
      truncateTokenLimit: params.truncateTokenLimit,
      skipQueuedMessages: false,
      leadName,
      mode: 'swarm',
      participantDirectory,
    })
  }

  setTeamRoomLive(null)
  clearTeamRoomState(sessionId)
  try {
    const { notifySystemEvent } = await import('@/packages/notifications')
    const session = await chatStore.getSession(sessionId)
    await notifySystemEvent({
      kind: 'long_run_done',
      sessionId,
      sessionName: session?.name || undefined,
      startedAt: runStartedAt,
    })
  } catch {
    // non-fatal
  }
}

function listRunTasks(sessionId: string, runStartedAt: number) {
  return taskStore
    .getState()
    .getSessionTasks(sessionId)
    .filter((t) => t.createdAt >= runStartedAt - 1000)
}

function hasRunBoard(sessionId: string, runStartedAt: number): boolean {
  return hasActiveSwarmBoard(listRunTasks(sessionId, runStartedAt))
}

function applySwarmAssignments(sessionId: string, speakers: string[], leadId: string, runStartedAt: number) {
  const tasks = listRunTasks(sessionId, runStartedAt).filter(
    (t) => t.status === 'pending' || t.status === 'in-progress'
  )
  const agents = speakers.map((id) => {
    const meta = resolveAgentMeta(id)
    return { id, name: meta?.name ?? id }
  })
  const map = assignTasks(
    tasks.map((t) => ({ id: t.id, title: t.title, assigneeAgentId: t.assigneeAgentId })),
    agents,
    leadId
  )
  for (const [taskId, agentId] of Object.entries(map)) {
    const task = tasks.find((t) => t.id === taskId)
    if (task && task.assigneeAgentId !== agentId) {
      taskStore.getState().setTaskAssignee(taskId, agentId)
    }
  }
}

async function materializeSwarmBoardFromPlan(
  sessionId: string,
  planMsg: Message,
  speakers: string[],
  runStartedAt: number
): Promise<void> {
  await taskStore.getState().hydrateSessionTasks(sessionId)
  if (hasRunBoard(sessionId, runStartedAt)) {
    return
  }

  const text = getMessageText(planMsg, true, true)
  const drafts = parseSwarmPlanFromText(text, MAX_SWARM_TASKS)
  if (drafts.length === 0) return

  const nameToId = new Map<string, string>()
  for (const id of speakers) {
    const name = (resolveAgentMeta(id)?.name ?? id).toLowerCase()
    nameToId.set(name, id)
    nameToId.set(id.toLowerCase(), id)
    // match first token of multi-word names
    for (const token of name.split(/[\s/_-]+/).filter((t) => t.length >= 3)) {
      if (!nameToId.has(token)) nameToId.set(token, id)
    }
  }

  const titleToId = new Map<string, string>()
  for (const draft of drafts) {
    const id = generateTaskId()
    let assigneeAgentId: string | undefined
    if (draft.assigneeHint) {
      const hint = draft.assigneeHint.toLowerCase()
      assigneeAgentId = nameToId.get(hint)
      if (!assigneeAgentId) {
        for (const [name, agentId] of nameToId) {
          if (hint.includes(name) || name.includes(hint)) {
            assigneeAgentId = agentId
            break
          }
        }
      }
    }
    const result = taskStore.getState().createTask(sessionId, id, draft.title, {
      assigneeAgentId,
      createdBy: 'orchestrator',
    })
    if (result.ok) {
      titleToId.set(draft.title.toLowerCase(), id)
    }
  }

  for (const draft of drafts) {
    if (!draft.dependsOnTitles?.length) continue
    const taskId = titleToId.get(draft.title.toLowerCase())
    if (!taskId) continue
    const deps = draft.dependsOnTitles
      .map((title) => titleToId.get(title.toLowerCase()))
      .filter((id): id is string => Boolean(id))
    if (deps.length > 0) {
      taskStore.getState().setTaskDeps(taskId, deps)
    }
  }
}
