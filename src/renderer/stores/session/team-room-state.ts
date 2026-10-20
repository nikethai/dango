/**
 * Ephemeral Team Room UI state (live status + post-discuss actions).
 * Not persisted — cleared on new user send / navigation.
 */

import type { RoomMode, RoomRole } from '@shared/agent-room'
import { atom } from 'jotai'
import { useMemo, useSyncExternalStore } from 'react'

export type TeamRoomLiveStatus = {
  sessionId: string
  phase: RoomRole | 'idle'
  mode: RoomMode
  speakerName?: string
  round?: number
  totalRounds?: number
  /** Swarm: 1-based current task index among planned tasks */
  taskIndex?: number
  /** Swarm: total tasks on the board for this run */
  taskTotal?: number
  /** Swarm: short title of current task */
  taskTitle?: string
  /** Swarm: agents taking part in this run */
  agentCount?: number
  /** Swarm: id shared by every turn of this run (`swarm-${startedAt}`) */
  runId?: string
} | null

export type TeamRoomActionsState = {
  sessionId: string
  speakers: string[]
  discussRoundsCompleted: number
  canKeepDiscussing: boolean
  mode: RoomMode
} | null

export const teamRoomLiveAtom = atom<TeamRoomLiveStatus>(null)
export const teamRoomActionsAtom = atom<TeamRoomActionsState>(null)

/** Imperative helpers for non-React orchestrator code */
let live: TeamRoomLiveStatus = null
let actions: TeamRoomActionsState = null
const listeners = new Set<() => void>()

function notify() {
  for (const l of listeners) l()
}

export function getTeamRoomLive(): TeamRoomLiveStatus {
  return live
}

export function getTeamRoomActions(): TeamRoomActionsState {
  return actions
}

export function setTeamRoomLive(next: TeamRoomLiveStatus) {
  live = next
  notify()
}

export function setTeamRoomActions(next: TeamRoomActionsState) {
  actions = next
  notify()
}

export function clearTeamRoomState(sessionId?: string) {
  if (sessionId) {
    if (live?.sessionId === sessionId) live = null
    if (actions?.sessionId === sessionId) actions = null
  } else {
    live = null
    actions = null
  }
  notify()
}

export function subscribeTeamRoomState(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Sessions whose running Swarm the user asked to stop (the captain still writes an answer). */
const swarmStopRequests = new Set<string>()

export function isSwarmStopRequested(sessionId: string): boolean {
  return swarmStopRequests.has(sessionId)
}

/**
 * Stop the running Swarm: the turn in progress stops, no further task starts, and the captain writes the answer from
 * the work so far. The flag is cleared when the run ends.
 */
export async function requestSwarmStop(sessionId: string): Promise<void> {
  swarmStopRequests.add(sessionId)
  notify()
  const { stopChatIfRunning } = await import('./stop-generation')
  await stopChatIfRunning(sessionId)
}

/** Whether Stop in this chat should go to the running Swarm (any phase but the captain's answer). */
export function isSwarmStoppable(sessionId: string): boolean {
  return live?.mode === 'swarm' && live.sessionId === sessionId && live.phase !== 'deliver'
}

/** Called by the Swarm orchestrator when a run ends. */
export function clearSwarmStopRequest(sessionId: string) {
  if (swarmStopRequests.delete(sessionId)) notify()
}

export type SwarmLiveStatus = NonNullable<TeamRoomLiveStatus> & { stopping: boolean }

/** Live status of this chat's running Swarm, or null when no Swarm runs here. */
export function useSwarmLive(sessionId: string): SwarmLiveStatus | null {
  const current = useSyncExternalStore(subscribeTeamRoomState, getTeamRoomLive, getTeamRoomLive)
  const stopping = useSyncExternalStore(
    subscribeTeamRoomState,
    () => isSwarmStopRequested(sessionId),
    () => isSwarmStopRequested(sessionId)
  )
  return useMemo(
    () => (current && current.mode === 'swarm' && current.sessionId === sessionId ? { ...current, stopping } : null),
    [current, stopping, sessionId]
  )
}

/** Sync jotai from imperative store (for React components that prefer atoms). */
export function syncTeamRoomAtomsToStore(
  setLive: (v: TeamRoomLiveStatus) => void,
  setActions: (v: TeamRoomActionsState) => void
) {
  setLive(live)
  setActions(actions)
}
