/**
 * Resolve agent persona display meta (name + avatar) for room UI and generation labels.
 * Covers built-in, local custom, and remote catalog agents (same sources as @ picker).
 */

import type { CopilotDetail } from '@shared/types'
import { getDefaultStore } from 'jotai'
import { getBuiltInCopilotById, myCopilotsAtom } from '@/hooks/useCopilots'
import queryClient from '@/stores/queryClient'

export type AgentMeta = {
  id: string
  name: string
  emojiAvatar?: string
  picUrl?: string
  /** True when id was not found in built-in / local / remote catalogs. */
  isFallback?: boolean
}

/**
 * Saved agents, resolved. Once mounted, the storage atom holds its load promise, which hooks unwrap but
 * `getDefaultStore().get` returns as is; this keeps the resolved list for synchronous lookups.
 */
let savedAgents: CopilotDetail[] = []
let watchingSavedAgents = false

function rememberSavedAgents(value: unknown) {
  void Promise.resolve(value)
    .then((list) => {
      if (Array.isArray(list)) savedAgents = list
    })
    .catch(() => {})
}

function watchSavedAgents() {
  if (watchingSavedAgents) return
  watchingSavedAgents = true
  const store = getDefaultStore()
  store.sub(myCopilotsAtom, () => rememberSavedAgents(store.get(myCopilotsAtom)))
}

/** Waits for the saved agents to load; call before a lookup that must see them (generation, labels). */
export async function loadSavedAgents(): Promise<CopilotDetail[]> {
  try {
    watchSavedAgents()
    const list = await getDefaultStore().get(myCopilotsAtom)
    if (Array.isArray(list)) savedAgents = list
  } catch {
    // jotai store unavailable (tests / early boot)
  }
  return savedAgents
}

/**
 * Full agent detail for prompts/settings. Returns null only when completely unknown.
 */
export function getAgentDetailById(id: string | undefined | null): CopilotDetail | null {
  if (!id) return null

  const builtin = getBuiltInCopilotById(id)
  if (builtin) return builtin

  try {
    watchSavedAgents()
    const stored = getDefaultStore().get(myCopilotsAtom)
    const list = Array.isArray(stored) ? stored : savedAgents
    const found = list.find((c) => c.id === id)
    if (found) return found
  } catch {
    // jotai store unavailable (tests / early boot)
  }

  // Remote catalog (shared agents) — same list as @ picker / AgentRoomStrip
  try {
    const remoteEntries = queryClient.getQueriesData<CopilotDetail[]>({ queryKey: ['remote-copilots'] })
    for (const [, data] of remoteEntries) {
      if (!Array.isArray(data)) continue
      const found = data.find((c) => c.id === id)
      if (found) return found
    }
  } catch {
    // query client unavailable
  }

  return null
}

/**
 * Look up built-in, local, then remote agents.
 * Falls back to a stable display meta so multi-agent turns never skip an id silently.
 */
export function resolveAgentMeta(id: string | undefined | null): AgentMeta | null {
  if (!id) return null

  const detail = getAgentDetailById(id)
  if (detail) {
    return {
      id: detail.id,
      name: detail.name,
      emojiAvatar: detail.emojiAvatar,
      picUrl: detail.picUrl,
      isFallback: false,
    }
  }

  // Unknown id (stale chip / race): still return meta so room orchestration does not skip the speaker.
  return {
    id,
    name: humanizeAgentId(id),
    emojiAvatar: '🤖',
    isFallback: true,
  }
}

function humanizeAgentId(id: string): string {
  const tail = id.includes(':') ? id.split(':').pop() || id : id
  // Skip raw UUIDs / opaque hashes — they look like "Aic0 En" and confuse users
  if (/^[0-9a-f]{8,}$/i.test(tail.replace(/[-_]/g, ''))) {
    return 'Agent'
  }
  const spaced = tail.replace(/[-_]+/g, ' ').trim()
  if (!spaced || spaced.length > 40) return 'Agent'
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Stable muted accent for multi-agent speaker chrome (CSS color string). */
export function agentAccentColor(agentId: string): string {
  let hash = 0
  for (let i = 0; i < agentId.length; i++) {
    hash = (hash * 31 + agentId.charCodeAt(i)) | 0
  }
  const hues = [210, 160, 280, 25, 340, 190]
  const hue = hues[Math.abs(hash) % hues.length]
  return `hsl(${hue} 45% 48%)`
}
