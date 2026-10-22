import type { ConnectedSource } from '@shared/types/sources'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { markSourceRemoved } from '@/packages/knowledge'
import { _resetSourceKindsForTests, registerSourceKind, type SourceKindDefinition } from './kinds'
import { cancelRemovalPending, finishPendingRemovals, markRemovalPending, REMOVE_DELAY_MS } from './pending-removal'
import { _resetSourcesForTests, getSource, listSources, loadSources, revokeSource } from './store'

const memory = new Map<string, unknown>()
const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v))
const revoked: string[] = []
const io = vi.hoisted(() => ({ failRevoke: 0 }))

vi.mock('@/storage', () => ({
  StorageKey: { Sources: 'sources' },
  default: {
    getItem: <T>(key: string, fallback: T): Promise<T> =>
      Promise.resolve(memory.has(key) ? (clone(memory.get(key)) as T) : fallback),
    setItemNow: (key: string, value: unknown): Promise<void> => {
      memory.set(key, clone(value))
      return Promise.resolve()
    },
    removeItem: (key: string): Promise<void> => {
      memory.delete(key)
      return Promise.resolve()
    },
  },
}))
vi.mock('@/platform', () => ({ default: { getStorageType: () => 'memory' } }))
vi.mock('@/packages/knowledge', () => ({ markSourceRemoved: vi.fn(async () => 0) }))
vi.mock('@/packages/background', () => ({
  listJobs: vi.fn(() => []),
  stopJob: vi.fn(async () => undefined),
  setJobSourceResolver: vi.fn(),
}))
vi.mock('@/packages/review', () => ({
  loadReviewEntries: vi.fn(async () => undefined),
  reviewStore: { getState: () => ({ entries: [] }) },
  setReviewEntryState: vi.fn(async () => undefined),
}))
vi.mock('@/hooks/useScopes', () => ({ readScopes: vi.fn(async () => []) }))

const src = (over: Partial<ConnectedSource> = {}): ConnectedSource => ({
  id: 'a',
  kind: 'folder',
  scopeId: 'acme',
  label: 'site',
  backgroundReview: false,
  localOnly: false,
  config: {},
  connectedAt: 1,
  ...over,
})

const kind: SourceKindDefinition = {
  kind: 'folder',
  name: 'Folder',
  hint: '',
  supportsBackgroundReview: true,
  isAvailable: () => true,
  pick: async () => null,
  revoke: (source) => {
    if (io.failRevoke > 0) {
      io.failRevoke -= 1
      return Promise.reject(new Error('unbind failed'))
    }
    revoked.push(source.id)
    return Promise.resolve()
  },
}

async function store(...sources: ConnectedSource[]): Promise<void> {
  memory.set('sources', sources)
  _resetSourcesForTests()
  await loadSources()
}

const storedIds = () => ((memory.get('sources') as ConnectedSource[] | undefined) ?? []).map((s) => s.id)

beforeEach(() => {
  memory.clear()
  revoked.length = 0
  io.failRevoke = 0
  _resetSourcesForTests()
  _resetSourceKindsForTests()
  registerSourceKind(kind)
  vi.mocked(markSourceRemoved).mockClear()
})

describe('pending source removal (S11)', () => {
  it('the undo window is 5 s', () => {
    expect(REMOVE_DELAY_MS).toBe(5_000)
  })

  it('finishes only removals pending at least 5 s', async () => {
    const sources = [src({ removalPendingAt: 1_000 }), src({ id: 'b', removalPendingAt: 9_000 }), src({ id: 'c' })]
    await store(...sources)
    await finishPendingRemovals(sources, 10_000)
    expect(revoked).toEqual(['a'])
    expect(markSourceRemoved).toHaveBeenCalledWith('a')
    expect(storedIds()).toEqual(['b', 'c'])
  })

  it('mark then cancel leaves the stored source without the field', async () => {
    await store(src())
    await markRemovalPending('a', 1_234)
    expect((memory.get('sources') as ConnectedSource[])[0].removalPendingAt).toBe(1_234)
    await cancelRemovalPending('a')
    const stored = (memory.get('sources') as ConnectedSource[])[0]
    expect('removalPendingAt' in stored).toBe(false)
    expect(stored).toEqual(src())
    expect(listSources().map((s) => s.id)).toEqual(['a'])
  })

  it('a pending source is hidden from lists but its row stays stored', async () => {
    await store(src(), src({ id: 'b' }))
    await markRemovalPending('a', 1_000)
    expect(listSources().map((s) => s.id)).toEqual(['b'])
    expect(getSource('a')).toBeUndefined()
    expect(getSource('a', { includePending: true })?.removalPendingAt).toBe(1_000)
    expect(listSources({ includePending: true }).map((s) => s.id)).toEqual(['a', 'b'])
    expect(storedIds()).toEqual(['a', 'b'])
  })

  it('an Undo that lands before the check is never revoked, even from a stale list', async () => {
    await store(src())
    await markRemovalPending('a', 1_000)
    const stale = listSources({ includePending: true })
    const cancel = cancelRemovalPending('a')
    // The check runs while the Undo is still being written.
    await finishPendingRemovals(stale, 10_000)
    await cancel
    expect(revoked).toEqual([])
    expect(storedIds()).toEqual(['a'])
    // And once written, a later check leaves it alone too.
    await finishPendingRemovals(stale, 20_000)
    expect(revoked).toEqual([])
    expect(getSource('a')).toBeDefined()
  })

  it('removed again after an Undo, the newer time counts', async () => {
    await store(src())
    await markRemovalPending('a', 1_000)
    const old = listSources({ includePending: true })
    await cancelRemovalPending('a')
    await markRemovalPending('a', 8_000)
    await finishPendingRemovals(old, 10_000)
    expect(revoked).toEqual([])
    await finishPendingRemovals(old, 13_000)
    expect(revoked).toEqual(['a'])
  })

  it('a failed revoke is logged, keeps the source pending and is retried at the next check', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const sources = [src({ removalPendingAt: 1_000 }), src({ id: 'b', removalPendingAt: 1_000 })]
    await store(...sources)
    io.failRevoke = 1
    await finishPendingRemovals(sources, 10_000)
    // One failure does not hold up the others.
    expect(revoked).toEqual(['b'])
    expect(warn).toHaveBeenCalled()
    expect(storedIds()).toEqual(['a'])
    expect(getSource('a')).toBeUndefined()
    await finishPendingRemovals(listSources({ includePending: true }), 11_000)
    expect(revoked).toEqual(['b', 'a'])
    expect(storedIds()).toEqual([])
    warn.mockRestore()
  })

  it('a check and the undo timer at the same moment revoke once', async () => {
    const sources = [src({ removalPendingAt: 1_000 })]
    await store(...sources)
    await Promise.all([
      finishPendingRemovals(sources, 10_000),
      revokeSource('a'),
      finishPendingRemovals(sources, 10_000),
    ])
    expect(revoked).toEqual(['a'])
    expect(markSourceRemoved).toHaveBeenCalledTimes(1)
  })
})
