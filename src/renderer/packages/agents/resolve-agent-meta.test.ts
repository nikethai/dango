import type { CopilotDetail } from '@shared/types'
import { getDefaultStore } from 'jotai'
import { describe, expect, it, vi } from 'vitest'

const canary: CopilotDetail = {
  id: 'local-1:canary',
  name: 'Canary',
  prompt: 'Begin each reply with GREEN-CANARY.',
  usedCount: 0,
}

// The real atomWithStorage over an async storage, as in the app: once mounted, the atom holds the load promise.
vi.mock('@/hooks/useCopilots', async () => {
  const { atomWithStorage } = await import('jotai/utils')
  const asyncStorage = {
    getItem: async () => [canary],
    setItem: async () => undefined,
    removeItem: async () => undefined,
  }
  return {
    myCopilotsAtom: atomWithStorage<CopilotDetail[]>('myCopilots', [], asyncStorage),
    getBuiltInCopilotById: () => undefined,
  }
})
vi.mock('@/stores/queryClient', () => ({ default: { getQueriesData: () => [] } }))

import { myCopilotsAtom } from '@/hooks/useCopilots'
import { getAgentDetailById, loadSavedAgents, resolveAgentMeta } from './resolve-agent-meta'

describe('saved agents in synchronous lookups', () => {
  it('finds a saved agent and its prompt while the storage atom holds its load promise', async () => {
    // The composer mounts the atom with useAtom; its value is now the storage promise.
    const unsub = getDefaultStore().sub(myCopilotsAtom, () => {})
    expect(getDefaultStore().get(myCopilotsAtom)).toBeInstanceOf(Promise)

    await loadSavedAgents()
    expect(getAgentDetailById('local-1:canary')?.prompt).toBe('Begin each reply with GREEN-CANARY.')
    expect(resolveAgentMeta('local-1:canary')).toEqual(expect.objectContaining({ name: 'Canary', isFallback: false }))
    unsub()
  })
})
