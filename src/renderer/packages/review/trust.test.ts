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

const settings = vi.hoisted(() => ({ trustLevel: undefined as unknown, init: vi.fn(async () => {}) }))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: { getState: () => ({ trustLevel: settings.trustLevel }) },
  initSettingsStore: settings.init,
}))

import * as barrel from './index'
import { addReviewEntry, setReviewEntryState, setReviewStorageForTests, updateReviewEntry } from './store'
import {
  applyReviewEntry,
  arrive,
  canUndoArrival,
  getReviewApplier,
  getTrustLevel,
  type ReviewApplier,
  registerReviewApplier,
  setReviewApplierForTests,
  subscribeReviewAppliers,
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
  settings.init.mockClear()
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
    expect(out).toEqual(row)
    expect(undoMock.pushUndo).toHaveBeenCalledTimes(1)
    expect(undoMock.pushUndo.mock.calls[0][0]).toMatchObject({ silent: true, group: 'other', message: '' })
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

  it('applyReviewEntry refuses proposal, conflict and knowledge refs on its own', async () => {
    for (const t of ['proposal', 'conflict', 'knowledge'] as const) {
      setReviewApplierForTests(t, applier)
      const e: ReviewEntry = { ...draft(), id: 'y', state: 'open', createdAt: 1, ref: { type: t, id: 'a' } }
      expect(await applyReviewEntry(e, { silent: false })).toBe(false)
      setReviewApplierForTests(t, undefined)
    }
    expect(applier.apply).not.toHaveBeenCalled()
  })

  it('arrive refuses proposal, conflict and knowledge refs', async () => {
    for (const t of ['proposal', 'conflict', 'knowledge'] as const) {
      setReviewApplierForTests(t, applier)
      const e: ReviewEntry = { ...draft(), id: 'x', state: 'open', createdAt: 1, ref: { type: t, id: 'a' } }
      expect(await arrive(e, 'auto', 5)).toBe(e)
      setReviewApplierForTests(t, undefined)
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

  it('a row dismissed during apply stays dismissed, is undone, and gets no undo record', async () => {
    let release: () => void = () => {}
    applier.apply = vi.fn(
      () =>
        new Promise<void>((r) => {
          release = r
        })
    )
    const pending = addReviewEntry(draft())
    await vi.waitFor(() => expect(applier.apply).toHaveBeenCalled())
    await setReviewEntryState({ id: stored()[0].id }, 'dismissed')
    release()
    const out = await pending
    expect(stored()[0]).toMatchObject({ state: 'dismissed', kind: 'proposal' })
    expect(out.state).toBe('open')
    expect(applier.undo).toHaveBeenCalledTimes(1)
    expect(undoMock.pushUndo).not.toHaveBeenCalled()
  })

  it('a concurrent second apply for the same row does not call apply twice', async () => {
    let release: () => void = () => {}
    applier.apply = vi.fn(
      () =>
        new Promise<void>((r) => {
          release = r
        })
    )
    const e: ReviewEntry = { ...draft(), id: 'same', state: 'open', createdAt: 1 }
    settings.trustLevel = 'ask'
    await addReviewEntry({ ...e })
    const first = applyReviewEntry(e, { silent: true })
    await vi.waitFor(() => expect(applier.apply).toHaveBeenCalled())
    expect(await applyReviewEntry(e, { silent: false })).toBe(false)
    release()
    expect(await first).toBe(true)
    expect(applier.apply).toHaveBeenCalledTimes(1)
  })

  it('canUndoArrival forgets the record once it can no longer be undone', async () => {
    const out = await addReviewEntry(draft())
    undoMock.canUndo.mockReturnValueOnce(false)
    expect(canUndoArrival(out.id)).toBe(false)
    expect(await undoArrival(out.id)).toBe(false)
  })

  it('getTrustLevel is auto with the setting absent', async () => {
    settings.trustLevel = undefined
    expect(await getTrustLevel()).toBe('auto')
  })
  it('getTrustLevel waits for settings to hydrate (M1)', async () => {
    settings.trustLevel = undefined
    settings.init.mockImplementationOnce(async () => {
      await Promise.resolve()
      settings.trustLevel = 'ask'
    })
    expect(await getTrustLevel()).toBe('ask')
    expect(settings.init).toHaveBeenCalledTimes(1)
  })

  it('when recording the undo fails, the row stays Done and arrive returns it as stored (T1)', async () => {
    undoMock.pushUndo.mockImplementationOnce(() => {
      throw new Error('quota')
    })
    const out = await addReviewEntry(draft())
    expect(stored()[0]).toMatchObject({ kind: 'done', state: 'done' })
    expect(out).toEqual(stored()[0])
    expect(canUndoArrival(out.id)).toBe(false)
    expect(applier.undo).not.toHaveBeenCalled()
  })

  const pendingApply = () => {
    let release: () => void = () => {}
    applier.apply = vi.fn(
      () =>
        new Promise<void>((r) => {
          release = r
        })
    )
    return () => release()
  }

  it('a row another window already applied is left Done, never undone (M2)', async () => {
    const release = pendingApply()
    settings.trustLevel = 'ask'
    const e = await addReviewEntry(draft())
    const pending = applyReviewEntry(e, { silent: false })
    await vi.waitFor(() => expect(applier.apply).toHaveBeenCalled())
    await updateReviewEntry(e.id, { kind: 'done', state: 'done', resolvedAt: 1 })
    release()
    expect(await pending).toBe(false)
    expect(applier.undo).not.toHaveBeenCalled()
    expect(stored()[0]).toMatchObject({ kind: 'done', state: 'done' })
    expect(undoMock.pushUndo).not.toHaveBeenCalled()
  })

  it('a row merged while apply ran is undone and waits with its new text (M2, stale entry)', async () => {
    const release = pendingApply()
    settings.trustLevel = 'ask'
    const input = draft()
    const e = await addReviewEntry(input)
    const pending = applyReviewEntry(e, { silent: false })
    await vi.waitFor(() => expect(applier.apply).toHaveBeenCalled())
    await addReviewEntry({ ...input, text: 'Reply to Ann, again' })
    release()
    expect(await pending).toBe(false)
    expect(applier.undo).toHaveBeenCalledTimes(1)
    expect(stored()[0]).toMatchObject({ id: e.id, kind: 'proposal', state: 'open', text: 'Reply to Ann, again' })
  })

  it('subscribeReviewAppliers fires on register and unregister', () => {
    const cb = vi.fn()
    const stop = subscribeReviewAppliers(cb)
    const off = registerReviewApplier('job', applier)
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    expect(cb).toHaveBeenCalledTimes(2)
    stop()
    registerReviewApplier('job', applier)()
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('the package barrel does not export the applier test seam (M7)', () => {
    expect('setReviewApplierForTests' in barrel).toBe(false)
    expect(typeof barrel.registerReviewApplier).toBe('function')
  })
})
