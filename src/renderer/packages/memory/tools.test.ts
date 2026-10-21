import { defaultMemorySettings, emptyMemoryBank } from '@shared/types/memory'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getModelMock = vi.hoisted(() => vi.fn((..._args: unknown[]) => ({ modelId: 'm' })))
const generateTextMock = vi.hoisted(() =>
  vi.fn(async () => ({ contentParts: [{ type: 'text', text: 'You like tea.' }] }))
)

vi.mock('@shared/models', () => ({ getModel: (...args: unknown[]) => getModelMock(...args) }))
vi.mock('@/adapters', () => ({ createModelDependencies: async () => ({}) }))
vi.mock('@/packages/model-calls', () => ({ generateText: () => generateTextMock() }))
vi.mock('@/platform', () => ({ default: { getConfig: async () => ({ uuid: 'u' }) } }))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: { getState: () => ({ getSettings: () => ({ provider: 'openai', modelId: 'gpt-4o' }) }) },
}))

import { getMemoryToolSet, type MemoryToolContext } from './tools'

function context(): MemoryToolContext {
  const bank = emptyMemoryBank('global')
  bank.entries.push({
    id: 'e1',
    content: 'Likes tea',
    tags: [],
    scope: 'global',
    source: 'user',
    enabled: true,
    pinned: false,
    createdAt: 1,
    updatedAt: 1,
  } as (typeof bank.entries)[number])
  return {
    settings: defaultMemorySettings(),
    getGlobalBank: () => bank,
    setGlobalBank: () => {},
    getAgentBank: () => null,
    setAgentBank: () => {},
  }
}

describe('getMemoryToolSet in a chat that holds local-only text (B3)', () => {
  beforeEach(() => {
    getModelMock.mockClear()
  })

  it('offers only recall, list and forget, and says why', () => {
    const set = getMemoryToolSet({ ...context(), localOnlyChat: true })
    expect(Object.keys(set.tools)).toEqual(['memory_recall', 'memory_list', 'memory_forget'])
    expect(set.description).toContain(
      'Saving and reflecting are off in this chat because it holds email or tasks kept on this device.'
    )
    expect(set.description).not.toContain('memory_retain')
    expect(set.description).not.toContain('memory_update')
    expect(set.description).not.toContain('memory_reflect')
  })

  it('keeps every tool in other chats', () => {
    const set = getMemoryToolSet(context())
    expect(Object.keys(set.tools)).toEqual([
      'memory_retain',
      'memory_recall',
      'memory_list',
      'memory_forget',
      'memory_update',
      'memory_reflect',
    ])
    expect(set.description).not.toContain('Saving and reflecting are off')
  })

  it("memory_reflect calls the chat's model, not the default one", async () => {
    const set = getMemoryToolSet({ ...context(), sessionSettings: { provider: 'ollama', modelId: 'llama3' } })
    // biome-ignore lint/suspicious/noExplicitAny: tool execute signature
    const out = await (set.tools as any).memory_reflect.execute({ question: 'What do I drink?', scope: 'all' })
    expect(out.answer).toBe('You like tea.')
    expect(getModelMock).toHaveBeenCalledTimes(1)
    expect(getModelMock.mock.calls[0][0]).toMatchObject({ provider: 'ollama', modelId: 'llama3' })
    expect(getModelMock.mock.calls[0][1]).toMatchObject({ provider: 'openai', modelId: 'gpt-4o' })
  })
})
