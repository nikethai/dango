import type { KnowledgeItem } from '@shared/types/knowledge'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHECK_TIMEOUT_MS,
  checkAgainstLayers,
  defaultContradictionChecker,
  selectCandidates,
  setContradictionCheckerForTests,
} from './contradictions'
import { _resetScopesForTests, _setScopeReaderForTests, refreshScopes } from './scopes'
import { _resetKnowledgeForTests, commitKnowledge } from './store'
import { makeItem, resetTestStorage } from './test-storage'

vi.mock('@/storage', async () => (await import('./test-storage')).default)

const model = { name: 'test-model' }
const generateText = vi.fn()
const getModel = vi.fn((..._args: unknown[]) => model)
vi.mock('@/packages/model-calls', () => ({ generateText: (...args: unknown[]) => generateText(...args) }))
vi.mock('@shared/models', () => ({ getModel: (...args: unknown[]) => getModel(...args) }))
vi.mock('@/adapters', () => ({ createModelDependencies: vi.fn(async () => ({})) }))
vi.mock('@/platform', () => ({ default: { getConfig: vi.fn(async () => ({})), appLog: vi.fn(async () => undefined) } }))
const getSession = vi.fn(async (_id: string): Promise<unknown> => null)
vi.mock('@/stores/chatStore', () => ({ getSession: (id: string) => getSession(id) }))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: () => ({
      getSettings: () => ({ provider: 'openai', modelId: 'gpt', defaultChatModel: { provider: 'acme', model: 'm1' } }),
    }),
  },
}))

const reply = (text: string) => ({ contentParts: [{ type: 'text', text }] })

async function items(n: number, over: (i: number) => Partial<KnowledgeItem>): Promise<KnowledgeItem[]> {
  const out: KnowledgeItem[] = []
  for (let i = 0; i < n; i++) out.push(await makeItem({ id: `k${i}`, updatedAt: 1_000 + i, ...over(i) }))
  return out
}

beforeEach(() => {
  resetTestStorage()
  _resetKnowledgeForTests()
  _resetScopesForTests()
  _setScopeReaderForTests(async () => [])
  setContradictionCheckerForTests(null)
  generateText.mockReset()
  getModel.mockClear()
  getSession.mockClear()
})

describe('selectCandidates', () => {
  it('non-latin text still gets candidates', async () => {
    const list = await items(10, (i) => ({ text: `Budget line ${i} is fixed` }))
    const picked = selectCandidates('Hạn chót là 6/11', list)
    expect(picked.map((i) => i.id)).toEqual(['k9', 'k8', 'k7', 'k6', 'k5', 'k4', 'k3', 'k2'])
  })

  it('Thai and Chinese text fall back to the most recent items too', async () => {
    const list = await items(3, (i) => ({ text: `Budget line ${i}` }))
    expect(selectCandidates('วันเปิดตัว launch', list, 2).map((i) => i.id)).toEqual(['k2', 'k1'])
    expect(selectCandidates('发布日期 launch date', list, 2).map((i) => i.id)).toEqual(['k2', 'k1'])
  })

  it('saved items in a script the tokenizer drops also fall back to the most recent items', async () => {
    const list = await items(3, (i) => ({ text: i === 0 ? 'Ngày ra mắt là 6/11' : `Budget line ${i}` }))
    expect(selectCandidates('launch date moved', list, 3).map((i) => i.id)).toEqual(['k2', 'k1', 'k0'])
  })

  it('fewer than 2 tokens falls back to the most recent items', async () => {
    const list = await items(3, (i) => ({ text: `Budget line ${i}` }))
    expect(selectCandidates('launch', list, 2).map((i) => i.id)).toEqual(['k2', 'k1'])
  })

  it('launch date moved excludes items that share no token', async () => {
    const list = [
      await makeItem({ id: 'a', text: 'Launch is 6 Nov', updatedAt: 1 }),
      await makeItem({ id: 'b', text: 'Budget is 10k', updatedAt: 5 }),
      await makeItem({ id: 'c', text: 'The launch date moved to 13 Nov', updatedAt: 2 }),
    ]
    expect(selectCandidates('launch date moved', list).map((i) => i.id)).toEqual(['c', 'a'])
  })

  it('caps at the limit', async () => {
    const list = await items(12, (i) => ({ text: `Launch window ${i}` }))
    expect(selectCandidates('launch window moved', list)).toHaveLength(8)
  })
})

describe('default checker', () => {
  it('default checker filters unknown ids', async () => {
    generateText.mockResolvedValue(reply('{"contradicts":["a","zzz"]}'))
    const candidates = [
      await makeItem({ id: 'a', text: 'Launch is 6 Nov' }),
      await makeItem({ id: 'b', text: 'Budget is 10k' }),
    ]
    expect(await defaultContradictionChecker({ text: 'Launch is 13 Nov', candidates })).toEqual(['a'])
    // The default chat model, with the comparison system prompt.
    expect(getModel.mock.calls[0][0]).toMatchObject({ provider: 'acme', modelId: 'm1' })
    const messages = generateText.mock.calls[0][1] as Array<{ role: string; contentParts: { text: string }[] }>
    expect(messages[0].role).toBe('system')
    expect(messages[0].contentParts[0].text).toBe(
      'You compare a new statement with saved statements. Return only JSON {"contradicts": [ids]} listing the saved statements that cannot be true at the same time as the new one. A statement that adds detail or is about something else does not contradict.'
    )
  })

  it("uses the session's model when there is a session", async () => {
    getSession.mockResolvedValueOnce({ id: 's1', settings: { provider: 'claude', modelId: 'sonnet' } })
    generateText.mockResolvedValue(reply('{"contradicts":[]}'))
    const candidates = [await makeItem({ id: 'a', text: 'Launch is 6 Nov' })]
    expect(await defaultContradictionChecker({ text: 'Launch is 13 Nov', candidates, sessionId: 's1' })).toEqual([])
    expect(getSession).toHaveBeenCalledWith('s1')
    expect(getModel.mock.calls[0][0]).toMatchObject({ provider: 'claude', modelId: 'sonnet' })
    expect(getModel.mock.calls[0][1]).toMatchObject({ provider: 'openai', modelId: 'gpt' })
  })

  it('a model call slower than 15 s fails', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      generateText.mockReturnValue(new Promise(() => undefined))
      const candidates = [await makeItem({ id: 'a', text: 'Launch is 6 Nov' })]
      const run = defaultContradictionChecker({ text: 'Launch is 13 Nov', candidates })
      const settled = expect(run).rejects.toThrow('timed out')
      await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS)
      await settled
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads JSON inside a code fence and after a think block', async () => {
    generateText.mockResolvedValue(reply('<think>hmm</think>```json\n{"contradicts":["b"]}\n```'))
    const candidates = [await makeItem({ id: 'b', text: 'Budget is 10k' })]
    expect(await defaultContradictionChecker({ text: 'Budget is 12k', candidates })).toEqual(['b'])
  })
})

describe('checkAgainstLayers', () => {
  async function seed() {
    const scoped = await makeItem({ id: 'a1', scopeId: 'acme', text: 'Launch is 6 Nov' })
    const everywhere = await makeItem({
      id: 'e1',
      scopeId: EVERYWHERE_SCOPE_ID,
      text: 'Launch reviews happen on Fridays',
    })
    const pref = await makeItem({
      id: 'e2',
      scopeId: EVERYWHERE_SCOPE_ID,
      kind: 'preference',
      text: 'Launch notes are short',
    })
    const other = await makeItem({ id: 'o1', scopeId: 'other', text: 'Launch is 1 Dec' })
    const removed = await makeItem({ id: 'a2', scopeId: 'acme', text: 'Launch is 2 Nov', status: 'removed' })
    await commitKnowledge((d) => {
      d.items.push(scoped, everywhere, pref, other, removed)
    })
  }

  it('one call covers the scope and Everywhere facts; ids split into conflicts and overrides', async () => {
    await seed()
    const checker = vi.fn(async () => ['a1', 'e1'])
    setContradictionCheckerForTests(checker)
    expect(await checkAgainstLayers({ text: 'Launch is 13 Nov', targetScopeId: 'acme' })).toEqual({
      conflictsWith: ['a1'],
      overrides: ['e1'],
      ok: true,
    })
    expect(checker).toHaveBeenCalledTimes(1)
    const ids = (checker.mock.calls[0] as unknown as [{ candidates: KnowledgeItem[] }])[0].candidates.map((i) => i.id)
    expect(ids.sort()).toEqual(['a1', 'e1'])
  })

  it('a client scope with Everywhere facts turned off never sends them to the checker', async () => {
    _setScopeReaderForTests(
      async () =>
        [{ id: 'acme', name: 'Acme', kind: 'client', readsEverywhere: { facts: false, documents: false } }] as never
    )
    await refreshScopes()
    await seed()
    const checker = vi.fn(async () => ['a1', 'e1'])
    setContradictionCheckerForTests(checker)

    expect(await checkAgainstLayers({ text: 'Launch is 13 Nov', targetScopeId: 'acme' })).toEqual({
      conflictsWith: ['a1'],
      overrides: [],
      ok: true,
    })
    const ids = (checker.mock.calls[0] as unknown as [{ candidates: KnowledgeItem[] }])[0].candidates.map((i) => i.id)
    expect(ids).toEqual(['a1'])
  })

  it('no candidates means no model call', async () => {
    const checker = vi.fn(async () => ['x'])
    setContradictionCheckerForTests(checker)
    expect(await checkAgainstLayers({ text: 'Launch is 13 Nov', targetScopeId: 'acme' })).toEqual({
      conflictsWith: [],
      overrides: [],
      ok: true,
    })
    expect(checker).not.toHaveBeenCalled()
  })

  it('checker failure is no conflict', async () => {
    await seed()
    generateText.mockRejectedValue(new Error('offline'))
    expect(await checkAgainstLayers({ text: 'Launch is 13 Nov', targetScopeId: 'acme' })).toEqual({
      conflictsWith: [],
      overrides: [],
      ok: false,
    })
  })

  it('a timed-out check is no conflict', async () => {
    await seed()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      generateText.mockReturnValue(new Promise(() => undefined))
      const run = checkAgainstLayers({ text: 'Launch is 13 Nov', targetScopeId: 'acme', sessionId: 's9' })
      await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS)
      expect(await run).toEqual({ conflictsWith: [], overrides: [], ok: false })
    } finally {
      vi.useRealTimers()
    }
  })

  it('passes the session on to the checker', async () => {
    await seed()
    const checker = vi.fn(async () => [])
    setContradictionCheckerForTests(checker)
    await checkAgainstLayers({ text: 'Launch is 13 Nov', targetScopeId: 'acme', sessionId: 's1' })
    expect(checker).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1' }))
  })

  it('no model configured is no conflict either', async () => {
    await seed()
    getModel.mockImplementationOnce(() => {
      throw new Error('Model provider must not be empty.')
    })
    expect(await checkAgainstLayers({ text: 'Launch is 13 Nov', targetScopeId: 'acme' })).toEqual({
      conflictsWith: [],
      overrides: [],
      ok: false,
    })
    expect(generateText).not.toHaveBeenCalled()
  })
})
