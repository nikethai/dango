import type { ReviewEntry, ReviewEntryInput } from '@shared/types/review'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type UndoArg = { silent?: boolean; undo: () => Promise<void> }
const undoMock = vi.hoisted(() => ({
  pushUndo: vi.fn((_input: UndoArg) => 'rec-1'),
  canUndo: vi.fn(() => true),
  undoEntry: vi.fn(async (_id: string) => true),
  DEFAULT_UNDO_MS: 5000,
}))
vi.mock('@/packages/undo', () => undoMock)

const settings = vi.hoisted(() => ({ trustLevel: undefined as unknown }))
vi.mock('@/stores/settingsStore', () => ({ settingsStore: { getState: () => ({ trustLevel: settings.trustLevel }) } }))

import { addReviewEntry, setReviewStorageForTests } from './store'
import {
  arrive,
  canUndoArrival,
  getReviewApplier,
  getTrustLevel,
  type ReviewApplier,
  registerReviewApplier,
  undoArrival,
} from './trust'

const KEY = 'review-entries'
let data: Record<string, unknown>
const stored = (): ReviewEntry[] => (data[KEY] as { entries?: ReviewEntry[] } | undefined)?.entries ?? []
const draft = (over: Partial<ReviewEntryInput> = {}): ReviewEntryInput => ({
  kind: 'proposal',
  scopeId: 's',
  text: 'Reply to Ann',
  risk: 'safe',
  ref: { type: 'draft', id: `d${Math.random()}` },
  ...over,
})
let applier: ReviewApplier
let unregister: () => void

beforeEach(() => {
  data = {}
  settings.trustLevel = 'auto'
  setReviewStorageForTests({
    getItem: <T>(k: string, f: T) => Promise.resolve((data[k] as T) ?? f),
    setItemNow: (k: string, v: unknown) => {
      data[k] = JSON.parse(JSON.stringify(v))
      return Promise.resolve()
    },
  })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(100_000)
  undoMock.pushUndo.mockClear()
  undoMock.undoEntry.mockClear()
  applier = { apply: vi.fn(async () => {}), undo: vi.fn(async () => {}) }
  unregister = registerReviewApplier('draft', applier)
})
afterEach(() => {
  unregister()
  setReviewStorageForTests(null)
  vi.useRealTimers()
})

describe('Trust arrival', () => {
  it('auto + safe + draft applies and stores the row done with the same id', async () => {
    const out = await addReviewEntry(draft())
    expect(applier.apply).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(applier.apply).mock.calls[0][0]
    expect(arg.id).toBeTruthy()
    expect(arg.state).toBe('open')
    expect(arg.createdAt).toBe(100_000)
    const row = stored()[0]
    expect(row.id).toBe(arg.id)
    expect(row).toMatchObject({ kind: 'done', state: 'done', undoUntil: 105_000 })
    expect(out).toMatchObject({ id: arg.id, kind: 'done', undoUntil: 105_000 })
    expect(undoMock.pushUndo).toHaveBeenCalledTimes(1)
    expect(undoMock.pushUndo.mock.calls[0][0].silent).toBe(true)
  })

  it('ask stays an open proposal', async () => {
    settings.trustLevel = 'ask'
    await addReviewEntry(draft())
    expect(applier.apply).not.toHaveBeenCalled()
    expect(stored()[0]).toMatchObject({ kind: 'proposal', state: 'open' })
  })

  it('registerReviewApplier throws for proposal, conflict and knowledge', () => {
    for (const t of ['proposal', 'conflict', 'knowledge'] as const) {
      expect(() => registerReviewApplier(t as never, applier)).toThrow()
      expect(getReviewApplier(t)).toBeUndefined()
    }
  })

  it('arrive refuses proposal, conflict and knowledge refs', async () => {
    for (const t of ['proposal', 'conflict', 'knowledge'] as const) {
      const e: ReviewEntry = { ...draft(), id: 'x', state: 'open', createdAt: 1, ref: { type: t, id: 'a' } }
      expect(await arrive(e, 'auto', 5)).toBe(e)
    }
    expect(applier.apply).not.toHaveBeenCalled()
  })

  it('missing or risky risk stays open', async () => {
    await addReviewEntry(draft({ risk: undefined }))
    await addReviewEntry(draft({ risk: 'risky' }))
    expect(applier.apply).not.toHaveBeenCalled()
    expect(stored().every((r) => r.kind === 'proposal' && r.state === 'open')).toBe(true)
  })

  it('no applier registered stays open', async () => {
    await addReviewEntry(draft({ ref: { type: 'job', id: 'j' } }))
    expect(applier.apply).not.toHaveBeenCalled()
    expect(stored()[0]).toMatchObject({ kind: 'proposal', state: 'open' })
  })

  it('a rejecting apply leaves a persisted open proposal', async () => {
    applier.apply = vi.fn(() => Promise.reject(new Error('boom')))
    const out = await addReviewEntry(draft())
    expect(out).toMatchObject({ kind: 'proposal', state: 'open' })
    expect(stored()).toHaveLength(1)
    expect(stored()[0]).toMatchObject({ kind: 'proposal', state: 'open' })
    expect(undoMock.pushUndo).not.toHaveBeenCalled()
  })

  it('needs-you and change inputs pass through at both levels', async () => {
    for (const level of ['auto', 'ask']) {
      settings.trustLevel = level
      await addReviewEntry(draft({ kind: 'needs-you', ref: { type: 'draft', id: `n${level}` } }))
      await addReviewEntry(draft({ kind: 'change', ref: { type: 'change', id: `c${level}` } }))
    }
    expect(applier.apply).not.toHaveBeenCalled()
    expect(stored().map((r) => r.kind)).toEqual(['needs-you', 'change', 'needs-you', 'change'])
  })

  it('a merge into an open row never arrives (flow 13)', async () => {
    settings.trustLevel = 'ask'
    const ref = { type: 'draft' as const, id: 'same' }
    await addReviewEntry(draft({ ref }))
    settings.trustLevel = 'auto'
    await addReviewEntry(draft({ ref }))
    expect(applier.apply).not.toHaveBeenCalled()
    expect(stored()).toHaveLength(1)
    expect(stored()[0]).toMatchObject({ kind: 'proposal', state: 'open' })
  })

  it('undoArrival calls applier.undo and the row waits again', async () => {
    const out = await addReviewEntry(draft())
    expect(canUndoArrival(out.id)).toBe(true)
    undoMock.undoEntry.mockImplementationOnce(async () => {
      await undoMock.pushUndo.mock.calls[0][0].undo()
      return true
    })
    expect(await undoArrival(out.id)).toBe(true)
    expect(applier.undo).toHaveBeenCalledTimes(1)
    expect(stored()[0]).toMatchObject({ kind: 'proposal', state: 'open' })
    expect(stored()[0].undoUntil).toBeUndefined()
  })

  it('getTrustLevel is auto with the setting absent', async () => {
    settings.trustLevel = undefined
    expect(await getTrustLevel()).toBe('auto')
  })
})
