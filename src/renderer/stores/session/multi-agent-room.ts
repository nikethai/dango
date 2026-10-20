/**
 * Team-room orchestrator: Discuss + Work + Swarm (plan → assign → sequential execute → deliver).
 * Interruptible via message cancel / new user send.
 */

import {
  buildSpeakerTurnQueue,
  canKeepDiscussing,
  mergeRoomMembers,
  normalizeSessionAgentIds,
  resolveRoomLead,
  resolveSpeakers,
  resolveStanceLabel,
  resolveSynthesisLead,
  roundForQueueIndex,
  shouldRunMultiAgentRoom,
  shouldRunSynthesis,
  toSessionAgentFields,
  type RoomMode,
  type RoomRole,
  MAX_ROOM_KEEP_DISCUSS_ROUNDS,
  MAX_ROOM_ROUNDS,
} from '@shared/agent-room'
import { createMessage, type Message } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import { type AgentMeta, resolveAgentMeta } from '@/packages/agents'
import * as chatStore from '../chatStore'
import * as scrollActions from '../scrollActions'
import { generate } from './generation'
import { messageQueueStore } from './messageQueue'
import { insertMessage, modifyMessage, submitNewUserMessage } from './messages'
import { runAgentRoomSwarm as runSwarmLoop } from './multi-agent-room-swarm'
import {
  clearTeamRoomState,
  setTeamRoomActions,
  setTeamRoomLive,
} from './team-room-state'

export type RoomAgentMeta = AgentMeta

export { resolveAgentMeta }

/**
 * Jump chat viewport to the latest message.
 * Virtuoso `followOutput` only works while already at bottom; multi-agent discussion
 * often leaves the user mid-list, so Team answer / deliver needs an explicit scroll.
 */
function scrollChatToLatest(behavior: 'auto' | 'smooth' = 'smooth') {
  const run = () => scrollActions.scrollToBottom(behavior)
  requestAnimationFrame(run)
  setTimeout(run, 80)
  setTimeout(run, 320)
}

/**
 * Local OS notification when a multi-agent pipeline finishes in the background (no message content). The run started
 * with the latest user message; the service skips runs shorter than LONG_RUN_MS.
 */
async function notifyRoomPipelineComplete(sessionId: string) {
  try {
    const { notifySystemEvent } = await import('@/packages/notifications')
    const session = await chatStore.getSession(sessionId)
    const startedAt = session?.messages.findLast((m) => m.role === 'user')?.timestamp
    if (typeof startedAt !== 'number') return
    await notifySystemEvent({
      kind: 'long_run_done',
      sessionId,
      sessionName: session?.name || undefined,
      startedAt,
    })
  } catch {
    // non-fatal
  }
}

/**
 * Update session room membership from mentions; dual-write copilotId.
 * Returns the new agentIds list.
 */
export async function applyRoomMembership(sessionId: string, mentionedAgentIds?: string[]): Promise<string[]> {
  const session = await chatStore.getSession(sessionId)
  if (!session) return []

  const existing = normalizeSessionAgentIds(session)
  const merged = mergeRoomMembers(existing, mentionedAgentIds ?? [])
  const fields = toSessionAgentFields(merged)
  await chatStore.updateSession(sessionId, {
    agentIds: fields.agentIds,
    copilotId: fields.copilotId,
  })
  return merged
}

/** Swarm on writes `'swarm'`; Swarm off writes `undefined`. */
export async function setSessionRoomMode(sessionId: string, roomMode: RoomMode | undefined): Promise<void> {
  await chatStore.updateSession(sessionId, { roomMode })
}

function messageHasUsableText(msg: Message | undefined): boolean {
  if (!msg) return false
  if (msg.error || msg.errorCode) return false
  return getMessageText(msg, true, true).trim().length > 0
}

function fallbackMeta(agentId: string): AgentMeta {
  return {
    id: agentId,
    name: agentId,
    emojiAvatar: '🤖',
  }
}

async function generateSpeakerTurn(
  sessionId: string,
  params: {
    meta: AgentMeta
    roomRole: RoomRole
    participantNames: string[]
    truncateTokenLimit?: number
    skipQueuedMessages: boolean
    roomRound?: number
    stanceLabel?: string
    leadName?: string
    mode: RoomMode
    taskId?: string
    taskTitle?: string
    taskIndex?: number
    taskTotal?: number
    participantDirectory?: string
  }
): Promise<{ msg: Message; interrupted: boolean }> {
  const assistantMsg: Message = {
    ...createMessage('assistant', ''),
    generating: true,
    agentId: params.meta.id,
    name: params.meta.name,
    roomRole: params.roomRole,
    roomRound: params.roomRound,
  }
  await insertMessage(sessionId, assistantMsg)

  setTeamRoomLive({
    sessionId,
    phase: params.roomRole,
    mode: params.mode,
    speakerName: params.meta.name,
    round: params.roomRound,
    totalRounds: params.mode === 'discuss' ? MAX_ROOM_ROUNDS : undefined,
    taskIndex: params.taskIndex,
    taskTotal: params.taskTotal,
    taskTitle: params.taskTitle,
  })

  // Always pin viewport to the newest room turn (discuss turns used to leave user mid-list).
  scrollChatToLatest('smooth')

  const runOnce = async () => {
    await generate(sessionId, assistantMsg, {
      operationType: 'send_message',
      truncateTokenLimit: params.truncateTokenLimit,
      speakerAgentId: params.meta.id,
      roomMulti: true,
      roomRole: params.roomRole,
      roomMode: params.mode,
      participantNames: params.participantNames,
      roomRound: params.roomRound,
      stanceLabel: params.stanceLabel,
      leadName: params.leadName,
      taskId: params.taskId,
      taskTitle: params.taskTitle,
      participantDirectory: params.participantDirectory,
      skipQueuedMessages: true,
    })
  }

  await runOnce()

  let after = await chatStore.getSession(sessionId)
  let justGenerated = after?.messages.find((m) => m.id === assistantMsg.id)

  if (justGenerated && !justGenerated.cancel && !messageHasUsableText(justGenerated) && !justGenerated.error) {
    await modifyMessage(sessionId, {
      ...justGenerated,
      generating: true,
      contentParts: [],
      error: undefined,
      errorCode: undefined,
    })
    await runOnce()
    after = await chatStore.getSession(sessionId)
    justGenerated = after?.messages.find((m) => m.id === assistantMsg.id)
  }

  if (justGenerated && !messageHasUsableText(justGenerated) && !justGenerated.error && !justGenerated.cancel) {
    const placeholder =
      params.roomRole === 'synthesis'
        ? '_Team answer returned no content. Try again or re-@ the agents._'
        : params.roomRole === 'do' || params.roomRole === 'deliver'
          ? `_${params.meta.name} returned no content for this work turn._`
          : `_${params.meta.name} did not return content for this turn._`
    await modifyMessage(sessionId, {
      ...justGenerated,
      generating: false,
      contentParts: [{ type: 'text', text: placeholder }],
    })
  }

  after = await chatStore.getSession(sessionId)
  justGenerated = after?.messages.find((m) => m.id === assistantMsg.id) ?? assistantMsg
  const latest = after?.messages[after.messages.length - 1]
  const interrupted = Boolean(justGenerated.cancel || latest?.role === 'user')

  // Re-pin after stream/placeholder so long turns stay in view
  if (!interrupted) {
    scrollChatToLatest('smooth')
  }

  if (!params.skipQueuedMessages && !interrupted) {
    while (messageQueueStore.getState().getQueuedCount(sessionId) > 0) {
      const nextQueuedMessage = messageQueueStore.getState().dequeueMessage(sessionId)
      if (!nextQueuedMessage) break
      await submitNewUserMessage(sessionId, {
        newUserMsg: nextQueuedMessage.message,
        needGenerating: nextQueuedMessage.needGenerating,
        userAlreadyInserted: nextQueuedMessage.userAlreadyInserted,
      })
      if (nextQueuedMessage.needGenerating) break
    }
  }

  return { msg: justGenerated, interrupted }
}

async function runDiscussTurns(
  sessionId: string,
  params: {
    speakers: string[]
    rounds: number
    truncateTokenLimit?: number
    startingRound?: number
  }
): Promise<{ completedTurns: number; interrupted: boolean; roundsDone: number }> {
  const { speakers, rounds } = params
  const participantNames = speakers.map((id) => resolveAgentMeta(id)?.name ?? id)
  const queue = buildSpeakerTurnQueue(speakers, rounds)
  const startingRound = params.startingRound ?? 1

  let completedTurns = 0
  let interrupted = false
  let maxRoundSeen = startingRound - 1

  for (let i = 0; i < queue.length; i++) {
    const agentId = queue[i]
    const meta = resolveAgentMeta(agentId) ?? fallbackMeta(agentId)
    const roomRound = startingRound - 1 + roundForQueueIndex(i, speakers.length)
    const speakerIndex = speakers.indexOf(agentId)
    const stanceLabel = resolveStanceLabel(speakerIndex >= 0 ? speakerIndex : 0, speakers.length)

    const session = await chatStore.getSession(sessionId)
    if (!session) return { completedTurns, interrupted: true, roundsDone: maxRoundSeen }

    const lastMsg = session.messages[session.messages.length - 1]
    if (lastMsg?.role === 'user' && i > 0) {
      interrupted = true
      break
    }
    if (lastMsg?.role === 'assistant' && lastMsg.generating && lastMsg.agentId && lastMsg.agentId !== agentId) {
      interrupted = true
      break
    }

    const { interrupted: turnInterrupted } = await generateSpeakerTurn(sessionId, {
      meta,
      roomRole: 'turn',
      participantNames,
      truncateTokenLimit: params.truncateTokenLimit,
      skipQueuedMessages: true,
      roomRound,
      stanceLabel,
      mode: 'discuss',
    })

    completedTurns += 1
    maxRoundSeen = Math.max(maxRoundSeen, roomRound)
    if (turnInterrupted) {
      interrupted = true
      break
    }
  }

  return { completedTurns, interrupted, roundsDone: maxRoundSeen }
}

/**
 * Run multi-agent Discuss after a user message (no auto Team answer).
 */
export async function runAgentRoomDiscussion(
  sessionId: string,
  params: {
    mentionedAgentIds?: string[]
    truncateTokenLimit?: number
    /** Override session.roomMode */
    roomMode?: RoomMode
  }
): Promise<void> {
  clearTeamRoomState(sessionId)

  const roomIds = await applyRoomMembership(sessionId, params.mentionedAgentIds)
  const speakers = resolveSpeakers(roomIds, params.mentionedAgentIds)

  if (speakers.length === 0) {
    return
  }

  if (speakers.length === 1) {
    return
  }

  const session = await chatStore.getSession(sessionId)
  const mode: RoomMode = params.roomMode ?? session?.roomMode ?? 'discuss'

  if (mode === 'work') {
    await runAgentRoomWork(sessionId, {
      speakers,
      truncateTokenLimit: params.truncateTokenLimit,
      roomLeadId: session?.roomLeadId,
    })
    return
  }

  if (mode === 'swarm') {
    await runAgentRoomSwarm(sessionId, {
      speakers,
      truncateTokenLimit: params.truncateTokenLimit,
      roomLeadId: session?.roomLeadId,
    })
    return
  }

  const { completedTurns, interrupted, roundsDone } = await runDiscussTurns(sessionId, {
    speakers,
    rounds: MAX_ROOM_ROUNDS,
    truncateTokenLimit: params.truncateTokenLimit,
    startingRound: 1,
  })

  setTeamRoomLive(null)

  if (interrupted || completedTurns === 0) {
    clearTeamRoomState(sessionId)
    // Still process queue if user interrupted
    while (messageQueueStore.getState().getQueuedCount(sessionId) > 0) {
      const nextQueuedMessage = messageQueueStore.getState().dequeueMessage(sessionId)
      if (!nextQueuedMessage) break
      await submitNewUserMessage(sessionId, {
        newUserMsg: nextQueuedMessage.message,
        needGenerating: nextQueuedMessage.needGenerating,
        userAlreadyInserted: nextQueuedMessage.userAlreadyInserted,
      })
      if (nextQueuedMessage.needGenerating) break
    }
    return
  }

  void notifyRoomPipelineComplete(sessionId)

  setTeamRoomActions({
    sessionId,
    speakers,
    discussRoundsCompleted: roundsDone,
    canKeepDiscussing: canKeepDiscussing(roundsDone, MAX_ROOM_KEEP_DISCUSS_ROUNDS),
    mode: 'discuss',
  })

  // Process queued messages after discuss completes (no auto synthesis)
  while (messageQueueStore.getState().getQueuedCount(sessionId) > 0) {
    const nextQueuedMessage = messageQueueStore.getState().dequeueMessage(sessionId)
    if (!nextQueuedMessage) break
    clearTeamRoomState(sessionId)
    await submitNewUserMessage(sessionId, {
      newUserMsg: nextQueuedMessage.message,
      needGenerating: nextQueuedMessage.needGenerating,
      userAlreadyInserted: nextQueuedMessage.userAlreadyInserted,
    })
    if (nextQueuedMessage.needGenerating) break
  }
}

/**
 * Work mode: plan (all) → do (lead, tools) → review (peers) → deliver (lead).
 */
export async function runAgentRoomWork(
  sessionId: string,
  params: {
    speakers: string[]
    truncateTokenLimit?: number
    roomLeadId?: string
  }
): Promise<void> {
  const speakers = params.speakers
  if (speakers.length < 2) return

  const participantNames = speakers.map((id) => resolveAgentMeta(id)?.name ?? id)
  const leadId = resolveRoomLead(speakers, params.roomLeadId) ?? speakers[0]
  const leadMeta = resolveAgentMeta(leadId) ?? fallbackMeta(leadId)
  const leadName = leadMeta.name
  const peers = speakers.filter((id) => id !== leadId)

  let interrupted = false

  // Plan: every speaker once (tools off)
  for (let i = 0; i < speakers.length; i++) {
    const agentId = speakers[i]
    const meta = resolveAgentMeta(agentId) ?? fallbackMeta(agentId)
    const session = await chatStore.getSession(sessionId)
    if (!session) return
    const lastMsg = session.messages[session.messages.length - 1]
    if (lastMsg?.role === 'user' && i > 0) {
      interrupted = true
      break
    }

    const { interrupted: turnInterrupted } = await generateSpeakerTurn(sessionId, {
      meta,
      roomRole: 'plan',
      participantNames,
      truncateTokenLimit: params.truncateTokenLimit,
      skipQueuedMessages: true,
      leadName,
      mode: 'work',
    })
    if (turnInterrupted) {
      interrupted = true
      break
    }
  }

  if (interrupted) {
    setTeamRoomLive(null)
    clearTeamRoomState(sessionId)
    return
  }

  // Do: lead with tools
  {
    const session = await chatStore.getSession(sessionId)
    if (!session) return
    if (session.messages[session.messages.length - 1]?.role === 'user') {
      setTeamRoomLive(null)
      return
    }
    const { interrupted: doInterrupted } = await generateSpeakerTurn(sessionId, {
      meta: leadMeta,
      roomRole: 'do',
      participantNames,
      truncateTokenLimit: params.truncateTokenLimit,
      skipQueuedMessages: true,
      leadName,
      mode: 'work',
    })
    if (doInterrupted) {
      setTeamRoomLive(null)
      clearTeamRoomState(sessionId)
      return
    }
  }

  // Review: peers only
  for (const agentId of peers) {
    const meta = resolveAgentMeta(agentId) ?? fallbackMeta(agentId)
    const session = await chatStore.getSession(sessionId)
    if (!session) return
    if (session.messages[session.messages.length - 1]?.role === 'user') {
      interrupted = true
      break
    }
    const { interrupted: revInterrupted } = await generateSpeakerTurn(sessionId, {
      meta,
      roomRole: 'review',
      participantNames,
      truncateTokenLimit: params.truncateTokenLimit,
      skipQueuedMessages: true,
      leadName,
      mode: 'work',
    })
    if (revInterrupted) {
      interrupted = true
      break
    }
  }

  if (interrupted) {
    setTeamRoomLive(null)
    clearTeamRoomState(sessionId)
    return
  }

  // Deliver: lead final
  {
    const session = await chatStore.getSession(sessionId)
    if (!session) return
    if (session.messages[session.messages.length - 1]?.role === 'user') {
      setTeamRoomLive(null)
      return
    }
    await generateSpeakerTurn(sessionId, {
      meta: leadMeta,
      roomRole: 'deliver',
      participantNames,
      truncateTokenLimit: params.truncateTokenLimit,
      skipQueuedMessages: false,
      leadName,
      mode: 'work',
    })
  }

  setTeamRoomLive(null)
  clearTeamRoomState(sessionId)
  void notifyRoomPipelineComplete(sessionId)
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
  }
): Promise<void> {
  await runSwarmLoop(sessionId, {
    ...params,
    generateSpeakerTurn: generateSpeakerTurn as Parameters<typeof runSwarmLoop>[1]['generateSpeakerTurn'],
  })
}

/**
 * On-demand Team answer (synthesis) after a completed discussion.
 */
export async function requestTeamAnswer(
  sessionId: string,
  params?: { truncateTokenLimit?: number }
): Promise<void> {
  const pending = (await import('./team-room-state')).getTeamRoomActions()
  const session = await chatStore.getSession(sessionId)
  if (!session) return

  const speakers =
    pending?.sessionId === sessionId
      ? pending.speakers
      : resolveSpeakers(normalizeSessionAgentIds(session), undefined)

  if (speakers.length < 2) return

  // Infer at least one discussion turn happened
  const discussTurns = session.messages.filter((m) => m.role === 'assistant' && m.roomRole === 'turn').length
  if (
    !shouldRunSynthesis({
      speakerCount: speakers.length,
      completedDiscussionTurns: discussTurns,
      interrupted: false,
      requested: true,
    })
  ) {
    return
  }

  clearTeamRoomState(sessionId)

  const leadId = resolveSynthesisLead(speakers, session.roomLeadId)
  const leadMeta = leadId ? resolveAgentMeta(leadId) : null
  if (!leadMeta) return

  const participantNames = speakers.map((id) => resolveAgentMeta(id)?.name ?? id)
  const tail = session.messages[session.messages.length - 1]
  if (tail?.role === 'user') return

  await generateSpeakerTurn(sessionId, {
    meta: leadMeta,
    roomRole: 'synthesis',
    participantNames,
    truncateTokenLimit: params?.truncateTokenLimit,
    skipQueuedMessages: false,
    leadName: leadMeta.name,
    mode: 'discuss',
  })

  setTeamRoomLive(null)
}

/**
 * Extra discuss round after a completed discussion (capped).
 */
export async function keepDiscussing(
  sessionId: string,
  params?: { truncateTokenLimit?: number }
): Promise<void> {
  const { getTeamRoomActions } = await import('./team-room-state')
  const pending = getTeamRoomActions()
  if (!pending || pending.sessionId !== sessionId) return
  if (!pending.canKeepDiscussing) return

  const speakers = pending.speakers
  const nextRound = pending.discussRoundsCompleted + 1
  if (nextRound > MAX_ROOM_KEEP_DISCUSS_ROUNDS) return

  clearTeamRoomState(sessionId)

  const { completedTurns, interrupted, roundsDone } = await runDiscussTurns(sessionId, {
    speakers,
    rounds: 1,
    truncateTokenLimit: params?.truncateTokenLimit,
    startingRound: nextRound,
  })

  setTeamRoomLive(null)

  if (interrupted || completedTurns === 0) {
    clearTeamRoomState(sessionId)
    return
  }

  setTeamRoomActions({
    sessionId,
    speakers,
    discussRoundsCompleted: roundsDone,
    canKeepDiscussing: canKeepDiscussing(roundsDone, MAX_ROOM_KEEP_DISCUSS_ROUNDS),
    mode: 'discuss',
  })
}

/** Whether the submit path runs the room (Swarm on, two or more speakers). Pure; lives in `@shared/agent-room`. */
export { shouldRunMultiAgentRoom }
