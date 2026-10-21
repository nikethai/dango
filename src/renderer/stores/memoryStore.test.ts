import { emptyMemoryBank } from '@shared/types/memory'
import { describe, expect, it, vi } from 'vitest'

const consolidateBankMock = vi.hoisted(() => vi.fn(async (bank: unknown, _opts?: unknown) => bank))
vi.mock('@/packages/memory/consolidate', () => ({
  consolidateBank: (bank: unknown, opts?: unknown) => consolidateBankMock(bank, opts),
}))
vi.mock('@/packages/memory/repository', () => ({
  getMemoryRepository: () => ({ saveGlobal: async () => {}, saveAgent: async () => {} }),
}))

import { memoryStore } from './memoryStore'

describe('memoryStore.rebuildProfile', () => {
  it("consolidates with the chat's model when given its settings (B3)", async () => {
    memoryStore.setState({ ready: true, globalBank: emptyMemoryBank('global') })
    const sessionSettings = { provider: 'ollama', modelId: 'llama3' }
    await memoryStore.getState().rebuildProfile('global', undefined, true, { sessionSettings })
    expect(consolidateBankMock).toHaveBeenLastCalledWith(expect.anything(), { sessionSettings })

    memoryStore.setState({ agentBanks: { a1: emptyMemoryBank('agent', 'a1') } })
    await memoryStore.getState().rebuildProfile('agent', 'a1', true, { sessionSettings })
    expect(consolidateBankMock).toHaveBeenLastCalledWith(expect.anything(), { sessionSettings })

    await memoryStore.getState().rebuildProfile('global', undefined, true)
    expect(consolidateBankMock).toHaveBeenLastCalledWith(expect.anything(), { sessionSettings: undefined })
  })
})
