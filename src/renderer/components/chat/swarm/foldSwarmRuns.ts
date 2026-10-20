/**
 * A Swarm run shows in the thread as one item: the captain's answer with "Worked with …" under it, or the live card
 * while it runs. The agents' own turns (plan, do) leave the list here; their work is summed up per run.
 */

import type { Message } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import i18next from 'i18next'

export type SwarmAgentRow = {
  agentId: string
  name: string
  provider?: string
  model?: string
  captain: boolean
  contribution: string[]
}

export type SwarmRun = {
  runId: string
  agents: SwarmAgentRow[]
  rounds: number
  tokens?: number
  stoppedEarly: boolean
  answerId?: string
}

/** The orchestrator's "could not plan" note (multi-agent-room-swarm.ts) stays in the thread: it is what the user reads. */
const RUN_NOTE_PREFIX = '_Swarm could not plan tasks'

function isRunNote(msg: Message): boolean {
  return getMessageText(msg, false, false).trimStart().startsWith(RUN_NOTE_PREFIX)
}

function messageTokens(msg: Message): number | undefined {
  const usage = msg.usage
  if (!usage) return undefined
  if (typeof usage.totalTokens === 'number') return usage.totalTokens
  if (typeof usage.inputTokens !== 'number' && typeof usage.outputTokens !== 'number') return undefined
  return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
}

function contributionOf(msg: Message): string | undefined {
  if (msg.roomRole === 'plan') return i18next.t('Planned the work')
  if (msg.roomRole === 'do') return msg.swarm?.taskTitle?.trim() || i18next.t('Did a task')
  if (msg.roomRole === 'deliver') return i18next.t('Wrote the answer')
  return undefined
}

type RunDraft = { run: SwarmRun; lastTurnId?: string; captainId?: string; tokens: number; hasTokens: boolean }

function hasError(msg: Message): boolean {
  return Boolean(msg.error || msg.errorCode)
}

export function foldSwarmRuns(messages: Message[]): {
  visible: Message[]
  runs: Record<string, SwarmRun>
  anchorOf: Record<string, string>
} {
  const drafts = new Map<string, RunDraft>()
  // A run that could not plan ends in a note and no answer: its failed turns stay in the thread, because their error
  // (with its fix) is why there is no answer. Elsewhere a failed turn folds away (a stopped plan turn's empty answer).
  const unplannedRuns = new Set<string>()
  for (const msg of messages) {
    if (msg.swarm?.runId && isRunNote(msg)) unplannedRuns.add(msg.swarm.runId)
  }
  const keepsOwnRow = (msg: Message) =>
    isRunNote(msg) || (unplannedRuns.has(msg.swarm?.runId ?? '') && msg.roomRole !== 'deliver' && hasError(msg))

  for (const msg of messages) {
    const runId = msg.swarm?.runId
    if (!runId || isRunNote(msg)) continue
    let draft = drafts.get(runId)
    if (!draft) {
      draft = { run: { runId, agents: [], rounds: 0, stoppedEarly: false }, tokens: 0, hasTokens: false }
      drafts.set(runId, draft)
    }
    const { run } = draft
    if (!keepsOwnRow(msg)) draft.lastTurnId = msg.id
    if (msg.roomRole === 'deliver') run.answerId = msg.id
    if (msg.roomRole === 'do') run.rounds += 1
    if (msg.swarm?.stoppedEarly) run.stoppedEarly = true
    if (msg.roomRole === 'plan' && !draft.captainId && msg.agentId) draft.captainId = msg.agentId
    const tokens = messageTokens(msg)
    if (tokens !== undefined) {
      draft.tokens += tokens
      draft.hasTokens = true
    }

    const agentId = msg.agentId
    if (!agentId) continue
    let row = run.agents.find((a) => a.agentId === agentId)
    if (!row) {
      row = { agentId, name: msg.name?.trim() || agentId, captain: false, contribution: [] }
      run.agents.push(row)
    }
    if (!row.provider && msg.aiProvider) row.provider = String(msg.aiProvider)
    if (!row.model && msg.model) row.model = msg.model
    const contribution = contributionOf(msg)
    if (contribution && !row.contribution.includes(contribution)) row.contribution.push(contribution)
  }

  const runs: Record<string, SwarmRun> = {}
  const anchorOf: Record<string, string> = {}
  for (const draft of drafts.values()) {
    const { run } = draft
    // The plan turn's speaker leads; a run whose plan turn is gone (fork) is led by whoever answered.
    const captainId = draft.captainId ?? messages.find((m) => m.id === run.answerId)?.agentId
    for (const row of run.agents) row.captain = row.agentId === captainId
    if (draft.hasTokens) run.tokens = draft.tokens
    runs[run.runId] = run
    const anchorId = run.answerId ?? draft.lastTurnId
    if (anchorId) anchorOf[anchorId] = run.runId
  }

  if (drafts.size === 0) return { visible: messages, runs, anchorOf }

  const visible = messages.filter(
    (msg) => !msg.swarm?.runId || msg.roomRole === 'deliver' || anchorOf[msg.id] !== undefined || keepsOwnRow(msg)
  )
  return { visible, runs, anchorOf }
}

export function swarmLiveLabel(live: {
  agentCount?: number
  phase: string
  taskIndex?: number
  taskTotal?: number
  stopping: boolean
}): string {
  // A Swarm always runs with two or more agents; the count only goes missing on a status from an older build.
  const count = Math.max(live.agentCount ?? 0, 2)
  if (live.stopping) {
    return i18next.t('Working with {{count}} agents · stopping, the captain is writing with what exists', { count })
  }
  if (live.phase === 'deliver') return i18next.t('Working with {{count}} agents · writing the answer', { count })
  if (live.phase === 'do' && live.taskIndex && live.taskTotal) {
    return i18next.t('Working with {{count}} agents · round {{x}} of {{y}}', {
      count,
      x: live.taskIndex,
      y: live.taskTotal,
    })
  }
  return i18next.t('Working with {{count}} agents · planning', { count })
}

/** 980 stays 980; 12,400 reads 12.4k; millions read 1.2M. */
export function formatSwarmTokens(tokens: number): string {
  const n = Math.max(0, Math.round(tokens))
  if (n < 1000) return String(n)
  const k = Number((n / 1000).toFixed(1))
  if (k < 1000) return `${k}k`
  return `${Number((n / 1_000_000).toFixed(1))}M`
}

export function swarmSummaryLabel(run: SwarmRun): string {
  const count = run.agents.length
  if (!run.answerId) return i18next.t('Worked with {{count}} agents · stopped before an answer', { count })
  // Counted parts of one meta line, each with its own plural.
  const parts = [
    i18next.t('Worked with {{count}} agents', { count }),
    i18next.t('{{count}} rounds', { count: run.rounds }),
  ]
  if (run.tokens !== undefined) parts.push(i18next.t('{{tokens}} tokens', { tokens: formatSwarmTokens(run.tokens) }))
  return parts.join(' · ')
}
