import type { KnowledgeProposal, KnowledgeState } from '@shared/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pushUndo } from '@/packages/undo'
import {
  _resetKnowledgeForTests,
  commitKnowledge,
  ensureKnowledgeLoaded,
  knowledgeStore,
  onKnowledgeCommit,
} from './store'
import { getRaw, makeItem, putRaw, resetTestStorage, testStorage } from './test-storage'
import { assignSourceIds, contentHash, knowledgeTextKey, newRevision, parseStaleAfter, quote } from './text'
import { pushKnowledgeUndo } from './undo'

vi.mock('@/storage', async () => (await import('./test-storage')).default)
vi.mock('@/packages/undo', () => ({ pushUndo: vi.fn(() => 'undo-1') }))

const KEY = 'knowledge'
const stored = () => getRaw<KnowledgeState>(KEY)

const proposal = (over: Partial<KnowledgeProposal> = {}): KnowledgeProposal => ({
  id: 'p-1',
  scopeId: 'p1',
  kind: 'fact',
  text: 'Budget is 10k',
  sources: [],
  origin: 'background-review',
  createdAt: 2_000,
  ...over,
})

beforeEach(() => {
  resetTestStorage()
  _resetKnowledgeForTests()
  vi.mocked(pushUndo).mockClear()
})

describe('knowledge store', () => {
  it('loads empty when nothing stored', async () => {
    await ensureKnowledgeLoaded()
    const { state } = knowledgeStore.getState()
    expect(state).toEqual({
      version: 1,
      items: [],
      proposals: [],
      conflicts: [],
      uses: [],
      dontSuggest: [],
      dismissals: [],
    })
  })

  it('drops one bad record, keeps the rest', async () => {
    putRaw(KEY, { items: [await makeItem(), { id: 1 }], proposals: 'nope' })
    await ensureKnowledgeLoaded()
    const { state } = knowledgeStore.getState()
    expect(state.items.map((i) => i.id)).toEqual(['k1'])
    expect(state.proposals).toEqual([])
  })

  it('ensureKnowledgeLoaded reads once unless fresh', async () => {
    await ensureKnowledgeLoaded()
    putRaw(KEY, { items: [await makeItem()] })
    await ensureKnowledgeLoaded()
    expect(knowledgeStore.getState().state.items).toHaveLength(0)
    await ensureKnowledgeLoaded({ fresh: true })
    expect(knowledgeStore.getState().state.items).toHaveLength(1)
  })

  it('reads a finished migration into the store', async () => {
    putRaw('knowledge-migration', { state: 'done', at: 1 })
    await ensureKnowledgeLoaded()
    expect(knowledgeStore.getState().migration).toBe('done')
  })

  it('commit writes the whole document immediately', async () => {
    const item = await makeItem()
    await commitKnowledge((d) => {
      d.items.push(item)
    })
    expect(testStorage.setItemNow).toHaveBeenCalledWith(KEY, expect.objectContaining({ version: 1 }))
    expect(stored()?.items).toEqual([item])
    expect(knowledgeStore.getState().state.items).toEqual([item])
  })

  it('commit reads fresh', async () => {
    const a = await makeItem({ id: 'a' })
    const b = await makeItem({ id: 'b' })
    await commitKnowledge((d) => {
      d.items.push(a)
    })
    // Another window writes b straight into storage.
    putRaw(KEY, { ...stored(), items: [...(stored()?.items ?? []), b] })
    const c = await makeItem({ id: 'c' })
    await commitKnowledge((d) => {
      d.items.push(c)
    })
    expect(stored()?.items.map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('reports touched ids and calls listeners with the new state', async () => {
    const listener = vi.fn()
    const off = onKnowledgeCommit(listener)
    const item = await makeItem()
    const r = await commitKnowledge((d) => {
      d.items.push(item)
      d.proposals.push(proposal())
    })
    expect(r.touched).toEqual({ items: ['k1'], proposals: ['p-1'], conflicts: [] })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][1].items).toEqual([item])
    off()
    await commitKnowledge((d) => {
      d.proposals = []
    })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("revert restores only that commit's records", async () => {
    putRaw(KEY, { version: 1, items: [await makeItem()] })
    const a = await commitKnowledge((d) => {
      d.items[0].status = 'removed'
    })
    // A background proposal lands before the user presses Undo.
    await commitKnowledge((d) => {
      d.proposals.push(proposal())
    })
    const listener = vi.fn()
    onKnowledgeCommit(listener)
    await a.revert()
    expect(stored()?.items[0].status).toBe('approved')
    expect(stored()?.proposals.map((p) => p.id)).toEqual(['p-1'])
    expect(knowledgeStore.getState().state.items[0].status).toBe('approved')
    // The revert runs as an ordinary commit, so listeners see it.
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].touched.items).toEqual(['k1'])
  })

  it('revert deletes records the commit created and restores ones it removed', async () => {
    putRaw(KEY, { version: 1, proposals: [proposal()] })
    const approved = await makeItem({ id: 'new', proposalId: 'p-1' })
    const a = await commitKnowledge((d) => {
      d.proposals = []
      d.items.push(approved)
    })
    expect(stored()?.proposals).toEqual([])
    await a.revert()
    expect(stored()?.items).toEqual([])
    expect(stored()?.proposals).toEqual([proposal()])
  })

  it('revert covers uses, dismissals and dontSuggest', async () => {
    const use = { itemId: 'k1', scopeId: 'p1', ref: { type: 'chat' as const, id: 's1', label: 'Chat' }, at: 5 }
    const otherUse = { ...use, ref: { ...use.ref, id: 's2' } }
    putRaw(KEY, { version: 1, uses: [use] })
    const a = await commitKnowledge((d) => {
      d.uses = []
      d.dismissals.push({ textKey: 'x', scopeId: 'p1', at: 7 })
      d.dontSuggest.push({ id: 'd1', scopeId: 'p1', text: 'X', textKey: 'x', addedAt: 7 })
    })
    await commitKnowledge((d) => {
      d.uses.push(otherUse)
      d.dismissals.push({ textKey: 'x', scopeId: 'p1', at: 9 })
    })
    await a.revert()
    const s = stored()
    expect(s?.uses).toEqual([otherUse, use])
    expect(s?.dismissals).toEqual([{ textKey: 'x', scopeId: 'p1', at: 9 }])
    expect(s?.dontSuggest).toEqual([])
  })

  it('an expression-bodied recipe commits correctly', async () => {
    const item = await makeItem()
    await commitKnowledge((d) => d.items.push(item))
    expect(stored()?.items).toEqual([item])
    expect(knowledgeStore.getState().state.items).toEqual([item])
  })

  it('an async recipe is rejected and writes nothing', async () => {
    await expect(commitKnowledge(async (d) => void d.proposals.push(proposal()))).rejects.toThrow('synchronous')
    expect(testStorage.setItemNow).not.toHaveBeenCalled()
  })

  it('a failed mutate writes nothing and does not block the next commit', async () => {
    await expect(
      commitKnowledge(() => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    expect(testStorage.setItemNow).not.toHaveBeenCalled()
    await commitKnowledge((d) => {
      d.proposals.push(proposal())
    })
    expect(stored()?.proposals).toHaveLength(1)
  })

  it('concurrent commits apply one after another', async () => {
    await Promise.all(
      ['a', 'b', 'c'].map((id) =>
        commitKnowledge((d) => {
          d.proposals.push(proposal({ id }))
        })
      )
    )
    expect(stored()?.proposals.map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('pushKnowledgeUndo', () => {
  it('pushKnowledgeUndo uses the knowledge group', async () => {
    const order: string[] = []
    const revert = vi.fn(() => {
      order.push('revert')
      return Promise.resolve()
    })
    const onUndo = vi.fn(() => {
      order.push('onUndo')
      return Promise.resolve()
    })
    const extra = { label: "Don't suggest this again", onClick: vi.fn() }
    expect(pushKnowledgeUndo('Removed "x"', revert, { extra, onUndo })).toBe('undo-1')
    expect(pushUndo).toHaveBeenCalledWith(
      expect.objectContaining({ group: 'knowledge', message: 'Removed "x"', extra })
    )
    await vi.mocked(pushUndo).mock.calls[0][0].undo()
    expect(order).toEqual(['revert', 'onUndo'])
  })
})

describe('text helpers', () => {
  it('knowledgeTextKey normalises', () => {
    expect(knowledgeTextKey('  Launch is 6  Nov. ')).toBe('launch is 6 nov')
  })

  it('quote cuts to 60 characters', () => {
    expect(quote('short')).toBe('short')
    const q = quote('x'.repeat(80))
    expect(q).toHaveLength(60)
    expect(q.endsWith('…')).toBe(true)
  })

  it('contentHash is sha256 of kind, text and condition', async () => {
    expect(await contentHash('fact', 'Launch is 6 Nov')).toBe(
      'cd4b81810969209bd30e8b44ec0353f8e48d7666e2ad476f937f422dc69b0535'
    )
  })

  it('parseStaleAfter needs an offset', () => {
    expect(parseStaleAfter('2026-11-01T09:00:00+07:00')).toBe(Date.UTC(2026, 10, 1, 2))
    expect(parseStaleAfter('2026-11-01T02:00:00Z')).toBe(Date.UTC(2026, 10, 1, 2))
    expect(parseStaleAfter('2026-11-01T09:00:00')).toBeUndefined()
    expect(parseStaleAfter('soon')).toBeUndefined()
    expect(parseStaleAfter(undefined)).toBeUndefined()
  })

  it('source ids are never reused', () => {
    const existing = [
      { id: 's1', kind: 'user' as const, label: 'You' },
      { id: 's3', kind: 'file' as const, label: 'a.md' },
    ]
    const out = assignSourceIds(existing, [
      { kind: 'chat', label: 'Chat' },
      { id: 'mine', kind: 'url', label: 'Site' },
      { kind: 'email', label: 'Mail' },
    ])
    expect(out.map((s) => s.id)).toEqual(['s4', 'mine', 's5'])
  })

  it('newRevision links to the approved revision and binds approval to the hash', async () => {
    const item = await makeItem()
    const r = await newRevision(item, { text: 'Launch is 7 Nov' }, 'user')
    expect(r.id).toBe('r2')
    expect(r.parentId).toBe('r1')
    expect(r.approval?.contentHash).toBe(await contentHash('fact', 'Launch is 7 Nov'))
    const plain = await newRevision(item, { text: 'Launch is 8 Nov', by: 'chat' })
    expect(plain.approval).toBeUndefined()
    expect(plain.by).toBe('chat')
  })
})
