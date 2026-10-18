import type { KnowledgeProposal, KnowledgeState } from '@shared/types/knowledge'
import type { ReviewEntry } from '@shared/types/review'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addReviewEntry, reviewStore, setReviewEntryState, setReviewStorageForTests } from '@/packages/review'
import { pushUndo, type UndoInput } from '@/packages/undo'
import {
  editKnowledge,
  listKnowledge,
  markSourceRemoved,
  moveKnowledge,
  NEVER_SEND_EMAIL,
  reapproveKnowledge,
  removeKnowledge,
} from './lifecycle'
import { startReviewSync } from './review-sync'
import { _resetScopesForTests, _setScopeReaderForTests } from './scopes'
import { _resetKnowledgeForTests, commitKnowledge } from './store'
import { getRaw, type MakeItemInput, makeItem, putRaw, resetTestStorage, testStorage } from './test-storage'
import { contentHash } from './text'
import { recordKnowledgeUse } from './uses'

vi.mock('@/storage', async () => (await import('./test-storage')).default)
vi.mock('i18next', () => ({
  t: (key: string, vars?: Record<string, string>) => key.replace(/\{\{(\w+)\}\}/g, (_, k) => vars?.[k] ?? ''),
}))
vi.mock('@/packages/undo', () => ({ pushUndo: vi.fn(() => 'undo-1') }))

let reviewData: Record<string, unknown> = {}
const reviewEntries = (): ReviewEntry[] =>
  (reviewData['review-entries'] as { entries: ReviewEntry[] } | undefined)?.entries ?? []
const stored = () => getRaw<KnowledgeState>('knowledge') as KnowledgeState
const lastUndo = (): UndoInput => vi.mocked(pushUndo).mock.calls.at(-1)?.[0] as UndoInput
let stopSync: () => void = () => undefined

beforeEach(() => {
  resetTestStorage()
  _resetKnowledgeForTests()
  _resetScopesForTests()
  _setScopeReaderForTests(async () => [{ id: 'acme', name: 'Acme' } as never])
  reviewData = {}
  setReviewStorageForTests({
    getItem: async <T>(k: string, fb: T) => (k in reviewData ? (structuredClone(reviewData[k]) as T) : fb),
    setItemNow: (k: string, v: unknown) => {
      reviewData[k] = structuredClone(v)
      return Promise.resolve()
    },
  })
  reviewStore.setState({ entries: [], lastCheckedAt: undefined, loaded: false })
  vi.mocked(pushUndo).mockClear()
  stopSync = startReviewSync()
})

afterEach(() => {
  stopSync()
  setReviewStorageForTests(null)
})

async function seed(...overs: MakeItemInput[]) {
  const items = await Promise.all(overs.map((o) => makeItem({ scopeId: 'acme', ...o })))
  await commitKnowledge((d) => {
    d.items.push(...items)
  })
  return items
}

describe('edit, remove and move', () => {
  it('edit keeps the old wording in history', async () => {
    await seed({ id: 'k1', text: 'Launch is 6 Nov' })
    const item = await editKnowledge('k1', '  Launch is 4 Nov ')

    expect(item.text).toBe('Launch is 4 Nov')
    expect(item.history.at(-1)).toMatchObject({ action: 'edited', by: 'user', note: 'Launch is 6 Nov' })
    expect(stored().items[0].text).toBe('Launch is 4 Nov')
    expect(lastUndo()).toMatchObject({ group: 'knowledge', message: 'Saved the new wording' })
    expect(pushUndo).toHaveBeenCalledTimes(1)
  })

  it('edit adds an approved revision r2 with parentId r1, undo puts approvedRevisionId back to r1', async () => {
    await seed({ id: 'k1', text: 'Launch is 6 Nov', condition: 'for the EU launch' })
    const item = await editKnowledge('k1', 'Launch is 4 Nov')

    expect(item.approvedRevisionId).toBe('r2')
    expect(item.revisions).toHaveLength(2)
    expect(item.revisions[1]).toMatchObject({
      id: 'r2',
      parentId: 'r1',
      by: 'user',
      text: 'Launch is 4 Nov',
      condition: 'for the EU launch',
      approval: { by: 'user', contentHash: await contentHash('fact', 'Launch is 4 Nov', 'for the EU launch') },
    })

    await lastUndo().undo()
    expect(stored().items[0]).toMatchObject({ approvedRevisionId: 'r1', text: 'Launch is 6 Nov' })
    expect(stored().items[0].revisions).toHaveLength(1)
  })

  it('remove, then the pushed undo restores approved', async () => {
    await seed({ id: 'k1', text: 'Launch is 6 Nov' })
    await removeKnowledge('k1')

    expect(stored().items[0].status).toBe('removed')
    expect(stored().items[0].history.at(-1)).toMatchObject({ action: 'removed', by: 'user' })
    expect(stored().items[0].revisions).toHaveLength(1)
    expect(lastUndo().message).toBe('Removed "Launch is 6 Nov"')

    await lastUndo().undo()
    expect(stored().items[0].status).toBe('approved')
    expect(stored().items[0].history.map((e) => e.action)).toEqual(['approved'])
  })

  it('removed shows under Superseded', async () => {
    await seed({ id: 'k1', text: 'Launch is 6 Nov' }, { id: 'k2', text: 'Budget is 10k', updatedAt: 2_000 })
    await removeKnowledge('k1')

    expect(listKnowledge('acme').map((i) => i.id)).toEqual(['k2'])
    expect(listKnowledge('acme', { status: ['superseded', 'removed'] }).map((i) => i.id)).toEqual(['k1'])
  })

  it('move to Everywhere and back records two moved events', async () => {
    await seed({ id: 'k1', text: 'Launch is 6 Nov', overrides: ['e1'] })
    const there = await moveKnowledge('k1', EVERYWHERE_SCOPE_ID)
    expect(there.scopeId).toBe(EVERYWHERE_SCOPE_ID)
    expect(there.overrides).toBeUndefined()
    expect(lastUndo().message).toBe('Moved "Launch is 6 Nov" to Everywhere')

    const back = await moveKnowledge('k1', 'acme')
    expect(back.scopeId).toBe('acme')
    expect(lastUndo().message).toBe('Moved "Launch is 6 Nov" to Acme')
    expect(back.history.filter((e) => e.action === 'moved').map((e) => e.note)).toEqual([
      'from Acme',
      'from Everywhere',
    ])
    expect(pushUndo).toHaveBeenCalledTimes(2)
  })

  it('built-in item is listed first in Everywhere and cannot be edited, removed or moved', async () => {
    await seed({ id: 'e1', scopeId: EVERYWHERE_SCOPE_ID, kind: 'preference', text: 'Keep it short', updatedAt: 9e12 })

    expect(listKnowledge(EVERYWHERE_SCOPE_ID).map((i) => i.id)).toEqual(['builtin:never-send-email', 'e1'])
    expect(listKnowledge('acme').map((i) => i.id)).toEqual([])
    expect(listKnowledge(EVERYWHERE_SCOPE_ID, { status: ['removed'] })).toEqual([])
    expect(NEVER_SEND_EMAIL).toMatchObject({
      scopeId: EVERYWHERE_SCOPE_ID,
      kind: 'preference',
      text: 'Never send email',
      status: 'approved',
      sources: [{ kind: 'user', label: 'Built in', id: 's1' }],
      approvedRevisionId: 'r1',
      history: [],
    })
    expect(NEVER_SEND_EMAIL.revisions[0].approval?.contentHash).toBe(
      await contentHash('preference', 'Never send email')
    )

    await expect(editKnowledge(NEVER_SEND_EMAIL.id, 'Send email')).rejects.toThrow('built-in')
    await expect(removeKnowledge(NEVER_SEND_EMAIL.id)).rejects.toThrow('built-in')
    await expect(moveKnowledge(NEVER_SEND_EMAIL.id, 'acme')).rejects.toThrow('built-in')
    expect(pushUndo).not.toHaveBeenCalled()
  })

  it('refuses missing ids and blank text', async () => {
    await seed({ id: 'k1' })
    await expect(editKnowledge('nope', 'x')).rejects.toThrow('missing')
    await expect(removeKnowledge('nope')).rejects.toThrow('missing')
    await expect(moveKnowledge('nope', 'acme')).rejects.toThrow('missing')
    await expect(editKnowledge('k1', '   ')).rejects.toThrow('empty')
    expect(pushUndo).not.toHaveBeenCalled()
  })

  it('search ignores accents', async () => {
    await seed({ id: 'k1', text: 'Café opens at 8' }, { id: 'k2', text: 'Launch is 6 Nov' })
    expect(listKnowledge('acme', { query: 'cafe' }).map((i) => i.id)).toEqual(['k1'])
    expect(listKnowledge('acme', { query: 'CAFÉ' }).map((i) => i.id)).toEqual(['k1'])
  })

  it('lists newest first and filters by kind', async () => {
    await seed(
      { id: 'k1', text: 'A', updatedAt: 1_000 },
      { id: 'k2', text: 'B', updatedAt: 3_000, kind: 'decision' },
      { id: 'k3', text: 'C', updatedAt: 2_000 }
    )
    expect(listKnowledge('acme').map((i) => i.id)).toEqual(['k2', 'k3', 'k1'])
    expect(listKnowledge('acme', { kind: ['fact'] }).map((i) => i.id)).toEqual(['k3', 'k1'])
  })

  it('markSourceRemoved marks matching sources only', async () => {
    await seed(
      {
        id: 'k1',
        sources: [
          { id: 's1', kind: 'file', label: 'plan.md', sourceId: 'src-1' },
          { id: 's2', kind: 'file', label: 'notes.md', sourceId: 'src-2' },
        ],
      },
      { id: 'k2', text: 'Other', sources: [{ id: 's1', kind: 'chat', label: 'Chat' }] }
    )
    const proposal: KnowledgeProposal = {
      id: 'p-1',
      scopeId: 'acme',
      kind: 'fact',
      text: 'Budget is 10k',
      sources: [{ kind: 'file', label: 'budget.md', sourceId: 'src-1' }],
      origin: 'background-review',
      createdAt: 2_000,
    }
    await commitKnowledge((d) => {
      d.proposals.push(proposal)
    })

    expect(await markSourceRemoved('src-1')).toBe(2)
    const s = stored()
    expect(s.items[0].sources.map((x) => x.removed)).toEqual([true, undefined])
    expect(s.items[1].sources[0].removed).toBeUndefined()
    expect(s.proposals[0].sources[0].removed).toBe(true)
    expect(await markSourceRemoved('src-1')).toBe(0)
    expect(pushUndo).not.toHaveBeenCalled()
  })
})

describe('re-approve and re-check', () => {
  it('reapproveKnowledge clears staleAfter and adds an approved revision', async () => {
    await seed({
      id: 'k1',
      text: 'Launch is 6 Nov',
      staleAfter: '2020-01-01T00:00:00Z',
      healthNotice: { reason: 'stale', key: '2020-01-01T00:00:00Z' },
    })
    await addReviewEntry({
      kind: 're-check',
      scopeId: 'acme',
      text: 'Due for review: Launch is 6 Nov',
      ref: { type: 'knowledge', id: 'k1' },
    })

    const item = await reapproveKnowledge('k1')
    expect(item.staleAfter).toBeUndefined()
    expect(item.healthNotice).toBeUndefined()
    expect(item.approvedRevisionId).toBe('r2')
    expect(item.revisions[1]).toMatchObject({
      text: 'Launch is 6 Nov',
      parentId: 'r1',
      approval: { by: 'user', contentHash: await contentHash('fact', 'Launch is 6 Nov') },
    })
    expect(stored().items[0].approvedRevisionId).toBe('r2')
    expect(reviewEntries().find((e) => e.ref.type === 'knowledge')?.state).toBe('done')
    expect(pushUndo).toHaveBeenCalledTimes(1)
  })

  it('edit of an item a draft used adds one re-check with sub \'It used "Launch is 4 Nov", which you edited.\'', async () => {
    await seed({ id: 'k1', text: 'Launch is 4 Nov' })
    await recordKnowledgeUse(['k1'], { type: 'draft', id: 'd1', label: 'Reply to Acme' })
    await recordKnowledgeUse(['k1'], { type: 'chat', id: 'c1', label: 'Launch chat' })

    await editKnowledge('k1', 'Launch is 6 Nov')
    const rechecks = reviewEntries().filter((e) => e.kind === 're-check')
    expect(rechecks).toHaveLength(1)
    expect(rechecks[0]).toMatchObject({
      state: 'open',
      scopeId: 'acme',
      text: 'Reply to Acme',
      sub: 'It used "Launch is 4 Nov", which you edited.',
      ref: { type: 'draft', id: 'd1' },
    })

    await lastUndo().undo()
    expect(reviewEntries().find((e) => e.kind === 're-check')?.state).toBe('dismissed')
  })

  it('remove re-checks a change that used it', async () => {
    await seed({ id: 'k1', text: 'Launch is 4 Nov' })
    await recordKnowledgeUse(['k1'], { type: 'change', id: 'ch1', label: 'Update the plan' })
    await removeKnowledge('k1')
    expect(reviewEntries().filter((e) => e.kind === 're-check')).toMatchObject([
      { text: 'Update the plan', sub: 'It used "Launch is 4 Nov", which you removed.' },
    ])
  })
})

describe('fix round 1', () => {
  it('a preference cannot leave Everywhere', async () => {
    await seed({ id: 'e1', scopeId: EVERYWHERE_SCOPE_ID, kind: 'preference', text: 'Keep it short' })
    const before = stored()
    const writes = testStorage.setItemNow.mock.calls.length
    await expect(moveKnowledge('e1', 'acme')).rejects.toThrow('preference')
    expect(stored()).toEqual(before)
    expect(testStorage.setItemNow.mock.calls.length).toBe(writes)
    expect(pushUndo).not.toHaveBeenCalled()
  })

  it('move to an unknown scope is refused as missing', async () => {
    await seed({ id: 'k1' })
    await expect(moveKnowledge('k1', 'no-such-scope')).rejects.toThrow('missing')
    expect(stored().items[0].scopeId).toBe('acme')
    expect(pushUndo).not.toHaveBeenCalled()
  })

  it('same-scope move and same-text edit change nothing', async () => {
    await seed({ id: 'k1', text: 'Launch is 6 Nov' })
    const before = stored()
    const writes = testStorage.setItemNow.mock.calls.length
    expect((await moveKnowledge('k1', 'acme')).id).toBe('k1')
    expect((await editKnowledge('k1', ' Launch is 6 Nov ')).approvedRevisionId).toBe('r1')
    expect(stored()).toEqual(before)
    expect(testStorage.setItemNow.mock.calls.length).toBe(writes)
    expect(pushUndo).not.toHaveBeenCalled()
  })

  it('reapprove closes the open health entry and its undo reopens it', async () => {
    await seed({ id: 'k1', text: 'Launch is 6 Nov', staleAfter: '2020-01-01T00:00:00Z' })
    await addReviewEntry({ kind: 're-check', scopeId: 'acme', text: 'Due', ref: { type: 'knowledge', id: 'k1' } })
    await reapproveKnowledge('k1')
    expect(reviewEntries().map((e) => e.state)).toEqual(['done'])

    await lastUndo().undo()
    expect(reviewEntries().map((e) => e.state)).toEqual(['open'])
    expect(stored().items[0]).toMatchObject({ approvedRevisionId: 'r1', staleAfter: '2020-01-01T00:00:00Z' })
  })

  it('reapprove leaves a dismissed health entry alone, also on undo', async () => {
    await seed({ id: 'k1', text: 'Launch is 6 Nov' })
    const entry = await addReviewEntry({
      kind: 're-check',
      scopeId: 'acme',
      text: 'Due',
      ref: { type: 'knowledge', id: 'k1' },
    })
    await setReviewEntryState({ id: entry.id }, 'dismissed')
    await reapproveKnowledge('k1')
    expect(reviewEntries().map((e) => e.state)).toEqual(['dismissed'])
    await lastUndo().undo()
    expect(reviewEntries().map((e) => e.state)).toEqual(['dismissed'])
  })

  it('an edit retries when another window changes the item between read and commit', async () => {
    await seed({ id: 'k1', text: 'Launch is 6 Nov', sources: [{ id: 's1', kind: 'file', label: 'a', sourceId: 'x' }] })
    const digest = crypto.subtle.digest.bind(crypto.subtle)
    const spy = vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce((alg, data) => {
      // Another window marks the source removed while this edit is hashing.
      const other = stored()
      other.items[0].sources[0].removed = true
      putRaw('knowledge', other)
      return digest(alg, data)
    })
    const item = await editKnowledge('k1', 'Launch is 4 Nov')
    spy.mockRestore()

    expect(item.text).toBe('Launch is 4 Nov')
    expect(stored().items[0]).toMatchObject({ text: 'Launch is 4 Nov', approvedRevisionId: 'r2' })
    expect(stored().items[0].sources[0].removed).toBe(true)
    expect(pushUndo).toHaveBeenCalledTimes(1)
  })

  it('an edit gives up with changed after three concurrent changes', async () => {
    await seed({ id: 'k1', text: 'Launch is 6 Nov' })
    const digest = crypto.subtle.digest.bind(crypto.subtle)
    let bump = 0
    const spy = vi.spyOn(crypto.subtle, 'digest').mockImplementation((alg, data) => {
      const other = stored()
      other.items[0].updatedAt = 50_000 + ++bump
      putRaw('knowledge', other)
      return digest(alg, data)
    })
    await expect(editKnowledge('k1', 'Launch is 4 Nov')).rejects.toThrow('changed')
    spy.mockRestore()
    expect(bump).toBe(3)
    expect(stored().items[0]).toMatchObject({ text: 'Launch is 6 Nov', approvedRevisionId: 'r1' })
    expect(pushUndo).not.toHaveBeenCalled()
  })
})
