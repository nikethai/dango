/**
 * Team-room helpers (membership, speakers, discuss/work protocols).
 * Pure functions — safe for unit tests without renderer deps.
 */

import { MERMAID_DIAGRAM_GUIDANCE, MERMAID_DIAGRAM_REMINDER } from './mermaid-diagram-guidance'
import {
  MAX_AGENT_TURNS_PER_USER_MSG,
  MAX_ROOM_AGENTS,
  MAX_ROOM_KEEP_DISCUSS_ROUNDS,
  MAX_ROOM_ROUNDS,
  MAX_SWARM_TASKS,
  MAX_SWARM_TURNS,
} from './types'

export {
  MAX_AGENT_TURNS_PER_USER_MSG,
  MAX_ROOM_AGENTS,
  MAX_ROOM_KEEP_DISCUSS_ROUNDS,
  MAX_ROOM_ROUNDS,
  MAX_SWARM_TASKS,
  MAX_SWARM_TURNS,
}

export type RoomMode = 'discuss' | 'work' | 'swarm'
export type RoomRole = 'turn' | 'synthesis' | 'plan' | 'do' | 'review' | 'deliver'

/** Roles that may use full tools (Work/Swarm execute). */
export const ROOM_TOOLS_ENABLED_ROLES: readonly RoomRole[] = ['do', 'deliver']

export function roomRoleAllowsTools(roomRole?: RoomRole | string): boolean {
  return roomRole === 'do' || roomRole === 'deliver'
}

/** Swarm plan may use task-tracking tools only (not web/MCP free-for-all). */
export function roomRoleAllowsTaskToolsOnly(
  roomRole?: RoomRole | string,
  roomMode?: RoomMode | string
): boolean {
  return roomMode === 'swarm' && roomRole === 'plan'
}

/**
 * Normalize legacy copilotId into agentIds (dual-read migration).
 */
export function normalizeSessionAgentIds(session: { agentIds?: string[]; copilotId?: string }): string[] {
  if (session.agentIds && session.agentIds.length > 0) {
    return uniqueIds(session.agentIds)
  }
  if (session.copilotId) {
    return [session.copilotId]
  }
  return []
}

/**
 * Merge room members with newly mentioned agents, preserving order, capped.
 */
export function mergeRoomMembers(existing: string[], mentioned: string[], max = MAX_ROOM_AGENTS): string[] {
  return uniqueIds([...existing, ...mentioned]).slice(0, max)
}

/**
 * Resolve who should speak after a user message.
 * - If mentions this turn: those agents (order preserved)
 * - Else: room members
 */
export function resolveSpeakers(roomAgentIds: string[], mentionedAgentIds?: string[]): string[] {
  if (mentionedAgentIds && mentionedAgentIds.length > 0) {
    return uniqueIds(mentionedAgentIds)
  }
  return uniqueIds(roomAgentIds)
}

/** Swarm is the chat's one multi-agent switch; legacy `discuss` / `work` read as off. */
export function isSwarmOn(roomMode: string | undefined): boolean {
  return roomMode === 'swarm'
}

/**
 * Whether a send runs the multi-agent room: Swarm on and two or more speakers.
 * With Swarm off, a chat with several agents answers as its first speaker.
 */
export function shouldRunMultiAgentRoom(
  mentionedAgentIds: string[] | undefined,
  roomAgentIds: string[],
  roomMode: string | undefined
): boolean {
  return isSwarmOn(roomMode) && resolveSpeakers(roomAgentIds, mentionedAgentIds).length >= 2
}

/**
 * Dual-write fields for session persistence during rename migration.
 */
export function toSessionAgentFields(agentIds: string[]): {
  agentIds: string[] | undefined
  copilotId: string | undefined
} {
  const ids = uniqueIds(agentIds)
  if (ids.length === 0) {
    return { agentIds: undefined, copilotId: undefined }
  }
  return { agentIds: ids, copilotId: ids[0] }
}

/** Stance labels for discuss mode (by speaker index). */
export function resolveStanceLabel(speakerIndex: number, speakerCount: number): string {
  if (speakerCount <= 1) return 'Participant'
  if (speakerIndex === 0) return 'Proposer'
  if (speakerCount >= 3 && speakerIndex === speakerCount - 1) return 'Integrator'
  return 'Critic'
}

/** Lead for synthesis / work execute (explicit lead, else first speaker). */
export function resolveRoomLead(speakers: string[], roomLeadId?: string): string | undefined {
  if (speakers.length === 0) return undefined
  if (roomLeadId && speakers.includes(roomLeadId)) return roomLeadId
  return speakers[0]
}

/**
 * Discussion protocol for short multi-agent turns.
 * Round ≥2 requires rebuttal / extension (real debate).
 */
export function buildRoomProtocol(
  speakerName: string,
  participantNames: string[],
  options?: {
    roomRound?: number
    stanceLabel?: string
  }
): string {
  const others = participantNames.filter((n) => n !== speakerName)
  const othersList = others.length > 0 ? others.join(', ') : 'none'
  const round = options?.roomRound ?? 1
  const stance = options?.stanceLabel
  const lines = [
    '## Team discussion protocol',
    `You are "${speakerName}", one teammate in a multi-agent discussion.`,
    stance ? `Your stance this turn: ${stance}.` : '',
    `Other teammates: ${othersList}. The user is present and may interrupt anytime.`,
    `This is discussion round ${round}.`,
    'Rules:',
    '- Speak only as yourself. Do not role-play other agents or the user.',
    '- Reply in helpful markdown. Tools, web search, and function calls are NOT available this turn.',
    '- Always write a non-empty reply (at least 2–4 sentences or tight bullets). Never return blank.',
    '- Do NOT prefix your reply with your name or markdown like **Name:** — the UI already labels you.',
    '- Keep replies short and conversational (about 2–6 short paragraphs or tight bullets).',
    '- Build on prior points; disagree when useful. Prefer claims, trade-offs, and next steps.',
    '- Do NOT write a full final report — the user may request a Team answer later.',
    '- If you sketch a flow or architecture, use a ```mermaid fence (not ASCII / ```text).',
  ]
  if (round >= 2) {
    lines.push(
      '- Round 2+ requirement: explicitly agree, disagree, or extend a prior teammate claim. Do not restate your first turn only.',
      '- If you disagree, say what you would change and why. If you agree, add one concrete refinement.'
    )
  }
  if (stance === 'Critic') {
    lines.push('- As Critic: challenge weak assumptions; steelman the best opposing view before rebutting.')
  }
  if (stance === 'Proposer') {
    lines.push('- As Proposer: put forward a clear position and the top reasons.')
  }
  if (stance === 'Integrator') {
    lines.push('- As Integrator: bridge disagreements and name what still needs deciding.')
  }
  return lines.filter(Boolean).join('\n')
}

/**
 * User-role bridge so multi-agent history does not end on assistant
 * (Gemini/OpenAI require the last prompt message to be user for a reliable completion).
 */
export function buildRoomContinuePrompt(
  speakerName: string,
  roomRole: RoomRole = 'turn',
  options?: { roomMode?: RoomMode; taskTitle?: string }
): string {
  const isSwarm = options?.roomMode === 'swarm'
  switch (roomRole) {
    case 'synthesis':
      return `(Your turn as "${speakerName}". Write the complete Team answer for the user now. Markdown OK; ${MERMAID_DIAGRAM_REMINDER} Do not call tools. Never return blank.)`
    case 'plan':
      if (isSwarm) {
        return `(Your turn as "${speakerName}" (Swarm orchestrator). Create checklist tasks with create_task (optionally assignee/dependsOn). Do not implement the full deliverable. ${MERMAID_DIAGRAM_REMINDER} Never return blank.)`
      }
      return `(Your turn as "${speakerName}". Give a short plan or approach for the team task. Markdown OK; ${MERMAID_DIAGRAM_REMINDER} No tools. Never return blank.)`
    case 'do':
      if (isSwarm && options?.taskTitle) {
        return `(Your turn as "${speakerName}". Complete only your assigned Swarm task: "${options.taskTitle}". Use tools if available; update_task when done. ${MERMAID_DIAGRAM_REMINDER} Never return blank.)`
      }
      return `(Your turn as "${speakerName}". You are the lead executor. Complete the work using available tools if needed. ${MERMAID_DIAGRAM_REMINDER} Never return blank.)`
    case 'review':
      return `(Your turn as "${speakerName}". Review the lead's work briefly: what works, what to fix. Markdown OK; no tools. Never return blank.)`
    case 'deliver':
      if (isSwarm) {
        return `(Your turn as "${speakerName}". Merge completed Swarm tasks into the final deliverable for the user. ${MERMAID_DIAGRAM_REMINDER} Use tools only if a fix requires them. Never return blank.)`
      }
      return `(Your turn as "${speakerName}". Produce the final deliverable for the user, incorporating review feedback. ${MERMAID_DIAGRAM_REMINDER} Use tools only if a fix requires them. Never return blank.)`
    default:
      return `(Your turn as "${speakerName}". Continue the team discussion in character. Markdown OK; ${MERMAID_DIAGRAM_REMINDER} Do not call tools. Never return blank.)`
  }
}

/**
 * Protocol for on-demand Team answer after multi-agent discussion.
 */
export function buildSynthesisProtocol(leadName: string, participantNames: string[]): string {
  const others = participantNames.filter((n) => n !== leadName)
  const othersList = others.length > 0 ? others.join(', ') : 'none'
  return [
    '## Team answer protocol (on-demand synthesis)',
    `You are "${leadName}", the lead synthesizer for this team discussion.`,
    `Other participants were: ${othersList}. The user requested a complete Team answer.`,
    'Rules:',
    '- Tools, web search, and function calls are NOT available — answer from the discussion and your knowledge.',
    '- Produce a complete, well-structured answer the user can use and copy. Never return blank.',
    '- Do NOT prefix with your name or **Name:** — the UI already labels you.',
    '- Base the answer on the discussion above. Reconcile agreements; note important disagreements briefly.',
    '- Do not invent consensus that did not appear in the discussion.',
    '- Speak as yourself (the lead), not as a neutral moderator bot.',
    '- Longer, structured output is allowed and expected for this turn only.',
    MERMAID_DIAGRAM_GUIDANCE,
  ].join('\n')
}

export function buildWorkPlanProtocol(speakerName: string, participantNames: string[], leadName: string): string {
  const others = participantNames.filter((n) => n !== speakerName)
  const othersList = others.length > 0 ? others.join(', ') : 'none'
  return [
    '## Team work — plan turn',
    `You are "${speakerName}". Teammates: ${othersList}. Lead executor will be "${leadName}".`,
    'Rules:',
    '- Tools are NOT available this turn.',
    '- Propose a short plan, split of concerns, or constraints for the task (2–6 bullets or short paragraphs).',
    '- Speak only as yourself. Do not write the full deliverable yet.',
    '- Never return blank.',
  ].join('\n')
}

export function buildWorkDoProtocol(leadName: string, participantNames: string[]): string {
  const others = participantNames.filter((n) => n !== leadName)
  const othersList = others.length > 0 ? others.join(', ') : 'none'
  return [
    '## Team work — execute turn (lead)',
    `You are "${leadName}", the lead executor for this team task.`,
    `Collaborators who planned: ${othersList}.`,
    'Rules:',
    '- You may use tools, web search, and function calls when needed to complete the work.',
    '- Follow the plan discussion above. Produce real progress / artifacts the user can use.',
    '- Do not prefix with your name. Never return blank.',
    '- Peers will review after you; leave the work in a reviewable state.',
    MERMAID_DIAGRAM_GUIDANCE,
  ].join('\n')
}

export function buildWorkReviewProtocol(speakerName: string, leadName: string): string {
  return [
    '## Team work — review turn',
    `You are "${speakerName}" reviewing lead "${leadName}"'s work.`,
    'Rules:',
    '- Tools are NOT available. Critique briefly: strengths, issues, concrete fixes.',
    '- Do not rewrite the entire deliverable. Never return blank.',
  ].join('\n')
}

export function buildWorkDeliverProtocol(leadName: string): string {
  return [
    '## Team work — deliver turn (lead)',
    `You are "${leadName}". Incorporate peer review and produce the final deliverable for the user.`,
    'Rules:',
    '- Use tools only if a fix requires them.',
    '- Deliver complete, usable output. Do not prefix with your name. Never return blank.',
    MERMAID_DIAGRAM_GUIDANCE,
  ].join('\n')
}

/**
 * Swarm lead plan: decompose goal into checklist tasks via tools; do not implement.
 */
export function buildSwarmPlanProtocol(
  speakerName: string,
  participantNames: string[],
  leadName: string,
  options?: {
    maxTasks?: number
    /** Room members as "Name (id: …)" for assigneeAgentId */
    participantDirectory?: string
  }
): string {
  const others = participantNames.filter((n) => n !== speakerName)
  const othersList = others.length > 0 ? others.join(', ') : 'none'
  const maxTasks = options?.maxTasks ?? MAX_SWARM_TASKS
  const directory =
    options?.participantDirectory?.trim() ||
    participantNames.map((n) => `"${n}"`).join(', ')
  return [
    '## Swarm — orchestrator plan turn',
    `You are "${speakerName}", the lead orchestrator for this Swarm room.`,
    `Teammates who will execute tasks: ${othersList}. Lead display name: "${leadName}".`,
    `Room directory (use these exact assigneeAgentId values when creating tasks): ${directory}`,
    'Your job this turn is ONLY to break the user goal into a structured task board.',
    'Rules:',
    `- You MUST call create_task once per step (prefer 3–${Math.min(8, maxTasks)} tasks, hard max ${maxTasks}).`,
    '- Set assigneeAgentId on each create_task to a room agent id from the directory (spread work across teammates; do not assign everything to yourself).',
    '- Optional dependsOn: array of task ids that must finish first.',
    '- Do NOT implement the full deliverable. Do NOT write long essays. Do NOT skip create_task.',
    '- The session task board was cleared for this Swarm run — create a fresh checklist; do not reuse old titles.',
    '- Task tools (create_task / update_task / list_tasks) are available; other tools are off.',
    '- After tool calls, briefly list who owns what (2–6 lines). Never return blank.',
    '- If tools fail, still write a fenced JSON plan: ```json {"tasks":[{"title":"...","assignee":"Name"},...]} ```',
  ].join('\n')
}

/**
 * Swarm executor: own a single task; update checklist when finished.
 */
export function buildSwarmExecuteProtocol(
  speakerName: string,
  participantNames: string[],
  options: {
    taskId: string
    taskTitle: string
    leadName?: string
  }
): string {
  const others = participantNames.filter((n) => n !== speakerName)
  const othersList = others.length > 0 ? others.join(', ') : 'none'
  return [
    '## Swarm — execute turn (assigned task)',
    `You are "${speakerName}", assigned a single task by the orchestrator.`,
    `Other teammates: ${othersList}. Lead: "${options.leadName ?? participantNames[0] ?? speakerName}".`,
    `Task id: ${options.taskId}`,
    `Task: ${options.taskTitle}`,
    'Rules:',
    '- Work ONLY on this task. Do not take other agents\' tasks.',
    '- You may use tools, web search, and function calls when needed (if available).',
    '- Call update_task with this task id: set in-progress when you start, done (or failed) when finished.',
    '- Produce real progress for the user in your reply. Never return blank.',
    '- Keep scope tight; leave later tasks for their owners.',
    MERMAID_DIAGRAM_GUIDANCE,
  ].join('\n')
}

export function buildSwarmDeliverProtocol(leadName: string, participantNames: string[]): string {
  const others = participantNames.filter((n) => n !== leadName)
  const othersList = others.length > 0 ? others.join(', ') : 'none'
  return [
    '## Swarm — deliver turn (lead)',
    `You are "${leadName}", the orchestrator. Teammates completed assigned tasks: ${othersList}.`,
    'Rules:',
    '- Merge the work above into one clear final deliverable for the user.',
    '- Use tools only if a fix requires them.',
    '- Note any failed or skipped tasks briefly. Do not re-run the whole board.',
    '- Do not prefix with your name. Never return blank.',
    MERMAID_DIAGRAM_GUIDANCE,
  ].join('\n')
}

/** Agent input for pure assignTasks. */
export type AssignAgent = {
  id: string
  name: string
  /** Optional capability tags for matching (future Settings UI). */
  tags?: string[]
}

/** Minimal task shape for assignment (no store dependency). */
export type AssignableTask = {
  id: string
  title: string
  assigneeAgentId?: string
}

/**
 * Rule-based task assignment (deterministic, unit-tested).
 * Priority: existing assignee → keyword/tag match on title → least-loaded → lead/first.
 */
export function assignTasks(
  tasks: AssignableTask[],
  agents: AssignAgent[],
  leadId?: string
): Record<string, string> {
  const result: Record<string, string> = {}
  if (tasks.length === 0 || agents.length === 0) return result

  const agentIds = new Set(agents.map((a) => a.id))
  const load = new Map<string, number>()
  for (const a of agents) load.set(a.id, 0)

  const fallback = (leadId && agentIds.has(leadId) ? leadId : agents[0].id) as string

  // Count pre-assigned load
  for (const task of tasks) {
    if (task.assigneeAgentId && agentIds.has(task.assigneeAgentId)) {
      load.set(task.assigneeAgentId, (load.get(task.assigneeAgentId) ?? 0) + 1)
    }
  }

  for (const task of tasks) {
    if (task.assigneeAgentId && agentIds.has(task.assigneeAgentId)) {
      result[task.id] = task.assigneeAgentId
      continue
    }

    const titleLower = task.title.toLowerCase()
    let best: string | undefined
    let bestScore = 0
    for (const agent of agents) {
      let score = 0
      const nameLower = agent.name.toLowerCase()
      if (nameLower.length >= 2 && titleLower.includes(nameLower)) score += 3
      // Match tokens from multi-word names
      for (const token of nameLower.split(/[\s/_-]+/).filter((t) => t.length >= 3)) {
        if (titleLower.includes(token)) score += 2
      }
      for (const tag of agent.tags ?? []) {
        const tagLower = tag.toLowerCase()
        if (tagLower.length >= 2 && titleLower.includes(tagLower)) score += 2
      }
      if (score > bestScore) {
        bestScore = score
        best = agent.id
      }
    }

    if (best && bestScore > 0) {
      result[task.id] = best
      load.set(best, (load.get(best) ?? 0) + 1)
      continue
    }

    // Least-loaded round-robin among agents
    let pick = fallback
    let minLoad = Number.POSITIVE_INFINITY
    for (const agent of agents) {
      const n = load.get(agent.id) ?? 0
      if (n < minLoad) {
        minLoad = n
        pick = agent.id
      }
    }
    result[task.id] = pick
    load.set(pick, (load.get(pick) ?? 0) + 1)
  }

  return result
}

/** Protocol block for a given room role (used by generation). */
export function buildProtocolForRoomRole(
  roomRole: RoomRole,
  speakerName: string,
  participantNames: string[],
  options?: {
    roomRound?: number
    stanceLabel?: string
    leadName?: string
    roomMode?: RoomMode
    taskId?: string
    taskTitle?: string
    participantDirectory?: string
  }
): string {
  const leadName = options?.leadName ?? participantNames[0] ?? speakerName
  const isSwarm = options?.roomMode === 'swarm'
  switch (roomRole) {
    case 'synthesis':
      return buildSynthesisProtocol(speakerName, participantNames)
    case 'plan':
      return isSwarm
        ? buildSwarmPlanProtocol(speakerName, participantNames, leadName, {
            participantDirectory: options?.participantDirectory,
          })
        : buildWorkPlanProtocol(speakerName, participantNames, leadName)
    case 'do':
      if (isSwarm && options?.taskId && options?.taskTitle) {
        return buildSwarmExecuteProtocol(speakerName, participantNames, {
          taskId: options.taskId,
          taskTitle: options.taskTitle,
          leadName,
        })
      }
      return buildWorkDoProtocol(speakerName, participantNames)
    case 'review':
      return buildWorkReviewProtocol(speakerName, leadName)
    case 'deliver':
      return isSwarm
        ? buildSwarmDeliverProtocol(speakerName, participantNames)
        : buildWorkDeliverProtocol(speakerName)
    default:
      return buildRoomProtocol(speakerName, participantNames, {
        roomRound: options?.roomRound,
        stanceLabel: options?.stanceLabel,
      })
  }
}

/** First speaker in order is the default synthesis lead (first @ mention / room order). */
export function resolveSynthesisLead(speakers: string[], roomLeadId?: string): string | undefined {
  return speakers.length >= 2 ? resolveRoomLead(speakers, roomLeadId) : undefined
}

/**
 * Whether synthesis / Team answer may run.
 * Discuss path requires explicit user request (no auto Final).
 */
export function shouldRunSynthesis(params: {
  speakerCount: number
  completedDiscussionTurns: number
  interrupted: boolean
  /** On-demand Team answer; default false (no auto synthesis). */
  requested?: boolean
}): boolean {
  return (
    params.requested === true &&
    params.speakerCount >= 2 &&
    params.completedDiscussionTurns > 0 &&
    !params.interrupted
  )
}

/** Whether another discuss round can run after the default rounds. */
export function canKeepDiscussing(roundsCompleted: number, max = MAX_ROOM_KEEP_DISCUSS_ROUNDS): boolean {
  return roundsCompleted < max
}

/**
 * Build ordered speaker turns for a room round (round-robin).
 */
export function buildSpeakerTurnQueue(
  speakers: string[],
  rounds = MAX_ROOM_ROUNDS,
  maxTurns = MAX_AGENT_TURNS_PER_USER_MSG
): string[] {
  if (speakers.length === 0) return []
  if (speakers.length === 1) return [speakers[0]]
  const queue: string[] = []
  for (let r = 0; r < rounds; r++) {
    for (const id of speakers) {
      if (queue.length >= maxTurns) return queue
      queue.push(id)
    }
  }
  return queue
}

/**
 * Map queue index → 1-based discussion round given speaker count.
 */
export function roundForQueueIndex(queueIndex: number, speakerCount: number): number {
  if (speakerCount <= 0) return 1
  return Math.floor(queueIndex / speakerCount) + 1
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}
