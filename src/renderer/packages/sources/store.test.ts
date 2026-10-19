import type { BackgroundJob } from '@shared/types/background'
import type { ReviewEntry } from '@shared/types/review'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import type { ConnectedSource, SourceKind } from '@shared/types/sources'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listJobs, setJobSourceResolver, stopJob } from '@/packages/background'
import { markSourceRemoved } from '@/packages/knowledge'
import { setReviewStorageForTests } from '@/packages/review'
import platform from '@/platform'
import { integrationsStore } from '@/stores/integrationsStore'
import {
  _resetSourceKindsForTests,
  getSourceKind,
  listSourceKinds,
  registerSourceAdapter,
  registerSourceKind,
  type SourceKindDefinition,
} from './kinds'
import {
  _resetSourcesForTests,
  addSource,
  adoptExistingFolderBindings,
  getSource,
  listSources,
  loadSources,
  revokeSource,
  SourceRuleError,
  sourceRuleErrorText,
  sourcesStore,
  updateSource,
} from './store'

const memory = new Map<string, unknown>()
const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v))
const calls: string[] = []

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
vi.mock('@/platform', () => ({
  default: { restoreProjectBinding: vi.fn(), getStorageType: () => 'memory' },
}))
vi.mock('@/packages/knowledge', () => ({
  markSourceRemoved: vi.fn((id: string) => {
    calls.push(`markSourceRemoved:${id}`)
    return Promise.resolve(0)
  }),
}))
vi.mock('@/packages/background', () => ({
  listJobs: vi.fn(() => []),
  stopJob: vi.fn((id: string) => {
    calls.push(`stopJob:${id}`)
    return Promise.resolve()
  }),
  setJobSourceResolver: vi.fn(),
}))
vi.mock('@/hooks/useScopes', () => ({
  readScopes: vi.fn(async () => [{ id: 'acme', name: 'Acme rebrand', kind: 'project' }]),
}))
vi.mock('@/stores/integrationsStore', () => {
  const removeAccount = vi.fn(async () => undefined)
  return { integrationsStore: { getState: () => ({ removeAccount }) } }
})

const reviewMemory: { doc: unknown } = { doc: null }

const input = (over: Partial<Omit<ConnectedSource, 'id' | 'connectedAt'>> = {}) => ({
  kind: 'gmail' as SourceKind,
  scopeId: 'acme',
  label: 'me@work',
  backgroundReview: false,
  localOnly: false,
  config: {},
  ...over,
})

const job = (over: Partial<BackgroundJob>): BackgroundJob =>
  ({
    id: 'j1',
    scopeId: 'acme',
    kind: 'sync',
    label: 'Gmail sync',
    status: 'running',
    startedAt: 1,
    attempts: 0,
    ...over,
  }) as BackgroundJob

const kind = (k: SourceKind, over: Partial<SourceKindDefinition> = {}): SourceKindDefinition => ({
  kind: k,
  name: k,
  hint: '',
  supportsBackgroundReview: true,
  isAvailable: () => true,
  pick: async () => null,
  ...over,
})

beforeEach(() => {
  memory.clear()
  calls.length = 0
  reviewMemory.doc = null
  setReviewStorageForTests({
    getItem: async <T>(_key: string, fallback: T) =>
      reviewMemory.doc === null ? fallback : (clone(reviewMemory.doc) as T),
    setItemNow: (_key: string, value: unknown) => {
      reviewMemory.doc = clone(value)
      return Promise.resolve()
    },
  })
  _resetSourcesForTests()
  _resetSourceKindsForTests()
  vi.mocked(listJobs).mockReset().mockReturnValue([])
  vi.mocked(stopJob).mockClear()
  vi.mocked(markSourceRemoved).mockClear()
  vi.mocked(platform.restoreProjectBinding as ReturnType<typeof vi.fn>).mockReset()
})

afterEach(() => {
  setReviewStorageForTests(null)
})

describe('sources store', () => {
  it('adds, lists by scope and by kind, and survives a reload', async () => {
    const a = await addSource(input())
    const b = await addSource(input({ kind: 'folder', label: 'site', scopeId: 'acme' }))
    const c = await addSource(input({ scopeId: 'other', label: 'other@work' }))
    expect(a.id).toBeTruthy()
    expect(a.connectedAt).toBeGreaterThan(0)
    expect(listSources().map((s) => s.id)).toEqual([a.id, b.id, c.id])
    expect(listSources({ scopeId: 'acme' }).map((s) => s.id)).toEqual([a.id, b.id])
    expect(listSources({ kind: 'gmail' }).map((s) => s.id)).toEqual([a.id, c.id])
    expect(listSources({ scopeId: 'acme', kind: 'folder' }).map((s) => s.id)).toEqual([b.id])

    await updateSource(a.id, { lastSyncAt: 42, label: 'renamed' })

    _resetSourcesForTests()
    expect(listSources()).toEqual([])
    expect(sourcesStore.getState().loaded).toBe(false)
    await loadSources()
    expect(sourcesStore.getState().loaded).toBe(true)
    expect(listSources()).toHaveLength(3)
    expect(getSource(a.id)).toMatchObject({ label: 'renamed', lastSyncAt: 42, kind: 'gmail', scopeId: 'acme' })
  })

  it('drops corrupt stored rows one by one and tolerates a failing read', async () => {
    memory.set('sources', [
      { id: 'ok', kind: 'gmail', scopeId: 'acme', label: 'x', connectedAt: 1 },
      { id: 'bad', kind: 'nope' },
    ])
    await loadSources()
    expect(listSources().map((s) => s.id)).toEqual(['ok'])

    _resetSourcesForTests()
    memory.set('sources', 'garbage')
    await loadSources()
    expect(listSources()).toEqual([])
    expect(sourcesStore.getState().loaded).toBe(true)
  })

  it('rejects a folder on Everywhere', async () => {
    const err = await addSource(input({ kind: 'folder', scopeId: EVERYWHERE_SCOPE_ID })).catch((e) => e)
    expect(err).toBeInstanceOf(SourceRuleError)
    expect(err.code).toBe('folder-everywhere')
    expect(sourceRuleErrorText(err)).toBe('Folders belong to a project or client.')
    expect(listSources()).toEqual([])
  })

  it('rejects a second folder on one scope', async () => {
    await addSource(input({ kind: 'folder', label: 'one' }))
    const err = await addSource(input({ kind: 'folder', label: 'two' })).catch((e) => e)
    expect(err).toBeInstanceOf(SourceRuleError)
    expect(err.code).toBe('folder-taken')
    expect(sourceRuleErrorText(err)).toBe('This scope already has a folder.')
    // A folder on another scope is fine.
    await expect(addSource(input({ kind: 'folder', scopeId: 'other' }))).resolves.toBeTruthy()
  })

  it('rejects Documents already attached to another scope', async () => {
    await addSource(input({ kind: 'documents', label: 'Specs', config: { kbId: 7 } }))
    const err = await addSource(input({ kind: 'documents', scopeId: 'other', config: { kbId: 7 } })).catch((e) => e)
    expect(err).toBeInstanceOf(SourceRuleError)
    expect(err.code).toBe('documents-taken')
    expect(err.scopeId).toBe('acme')
    expect(sourceRuleErrorText(err)).toBe('These documents already belong to Acme rebrand.')
    // A different collection is fine.
    await expect(addSource(input({ kind: 'documents', scopeId: 'other', config: { kbId: 8 } }))).resolves.toBeTruthy()
  })

  it("revoke stops the source's jobs, marks knowledge and deletes the record", async () => {
    const s = await addSource(input())
    // The brief names the source 's1'; ids are generated, so map the call to it.
    const revoke = vi.fn(() => {
      calls.push('revoke')
      return Promise.resolve()
    })
    registerSourceKind(kind('gmail', { revoke }))
    memory.set(`source-cursor:${s.id}`, 'cursor')
    vi.mocked(listJobs).mockImplementation((filter) =>
      filter?.sourceId === s.id
        ? [job({ id: 'j-run', sourceId: s.id }), job({ id: 'j-done', sourceId: s.id, status: 'done' })]
        : []
    )

    await revokeSource(s.id)

    expect(calls).toEqual(['stopJob:j-run', 'revoke', `markSourceRemoved:${s.id}`])
    expect(revoke).toHaveBeenCalledWith(expect.objectContaining({ id: s.id }))
    expect(getSource(s.id)).toBeUndefined()
    expect(memory.has(`source-cursor:${s.id}`)).toBe(false)
    _resetSourcesForTests()
    await loadSources()
    expect(getSource(s.id)).toBeUndefined()
  })

  it('revoke dismisses open Review entries of its jobs and leaves others alone', async () => {
    const s = await addSource(input())
    const entry = (id: string, refId: string, state: ReviewEntry['state']): ReviewEntry =>
      ({
        id,
        kind: 'needs-you',
        scopeId: 'acme',
        state,
        risk: 'safe',
        text: 't',
        createdAt: 1,
        ref: { type: 'job', id: refId },
        ...(state === 'open' ? {} : { resolvedAt: Date.now() }),
      }) as ReviewEntry
    reviewMemory.doc = {
      entries: [entry('e1', 'j-needs', 'open'), entry('e2', 'j-done', 'done'), entry('e3', 'j-other', 'open')],
    }
    vi.mocked(listJobs).mockImplementation((filter) =>
      filter?.sourceId === s.id
        ? [
            job({ id: 'j-needs', sourceId: s.id, status: 'needs-you' }),
            job({ id: 'j-done', sourceId: s.id, status: 'done' }),
          ]
        : []
    )

    await revokeSource(s.id)

    const entries = (reviewMemory.doc as { entries: ReviewEntry[] }).entries
    const state = (id: string) => entries.find((e) => e.id === id)?.state
    expect(state('e1')).toBe('dismissed')
    expect(state('e2')).toBe('done')
    expect(state('e3')).toBe('open')
  })

  it('revoke never deletes the integration account', async () => {
    const s = await addSource(input({ config: { accountId: 'acc1' } }))
    registerSourceKind(kind('gmail', { revoke: async () => undefined }))
    await revokeSource(s.id)
    expect(integrationsStore.getState().removeAccount).not.toHaveBeenCalled()
  })

  it('revoke of an unknown id does nothing', async () => {
    await revokeSource('missing')
    expect(calls).toEqual([])
  })

  it('registers a job source resolver: removed sources cannot open, labels come from the store', async () => {
    const resolver = vi.mocked(setJobSourceResolver).mock.calls.at(-1)?.[0]
    expect(resolver).toBeTruthy()
    const s = await addSource(input({ label: 'me@work' }))
    expect(resolver?.exists(s.id)).toBe(true)
    expect(resolver?.label(s.id)).toBe('me@work')
    await revokeSource(s.id)
    expect(resolver?.exists(s.id)).toBe(false)
    expect(resolver?.label(s.id)).toBeUndefined()
  })
})

describe('source kinds', () => {
  it('registerSourceAdapter adds sync to a registered kind', () => {
    registerSourceKind(kind('gmail'))
    expect(getSourceKind('gmail')?.sync).toBeUndefined()
    const sync = vi.fn(async () => ({ summary: 'ok' }))
    registerSourceAdapter('gmail', { sync, pollMs: 1000 })
    expect(getSourceKind('gmail')?.sync).toBe(sync)
    expect(getSourceKind('gmail')).toMatchObject({ kind: 'gmail', name: 'gmail', pollMs: 1000 })
  })

  it('an adapter registered before its kind is merged in when the kind registers', () => {
    const sync = vi.fn(async () => ({ summary: 'ok' }))
    registerSourceAdapter('asana', { sync })
    expect(getSourceKind('asana')).toBeUndefined()
    registerSourceKind(kind('asana'))
    expect(getSourceKind('asana')?.sync).toBe(sync)
  })

  it('listSourceKinds keeps the fixed order whatever the registration order', () => {
    for (const k of ['documents', 'codex-threads', 'asana', 'folder', 'gmail'] as SourceKind[]) {
      registerSourceKind(kind(k))
    }
    expect(listSourceKinds().map((d) => d.kind)).toEqual(['folder', 'gmail', 'asana', 'codex-threads', 'documents'])
  })
})

describe('adoptExistingFolderBindings', () => {
  const restore = () => vi.mocked(platform.restoreProjectBinding as ReturnType<typeof vi.fn>)
  const descriptor = (projectId: string, status: string, displayPath = `/Users/me/${projectId}`) => ({
    projectId,
    capabilityId: 'c',
    rootGeneration: 'g',
    displayPath,
    status,
  })

  it('adopts an existing folder binding without a job', async () => {
    restore().mockImplementation(async (id: string) => descriptor(id, 'ready', '/Users/me/code/acme-site/'))
    const added = await adoptExistingFolderBindings(['acme'])
    expect(added).toBe(1)
    const [folder] = listSources({ scopeId: 'acme', kind: 'folder' })
    expect(folder).toMatchObject({ label: 'acme-site', backgroundReview: false, kind: 'folder' })
    expect(folder.config).toMatchObject({ displayPath: '/Users/me/code/acme-site/' })
  })

  it('skips chat-only and thrown bindings', async () => {
    restore().mockImplementation((id: string) => {
      if (id === 'boom') return Promise.reject(new Error('no binding'))
      if (id === 'chat') return Promise.resolve(descriptor(id, 'chat-only'))
      if (id === 'web') return Promise.resolve(descriptor(id, 'unsupported'))
      return Promise.resolve(descriptor(id, 'missing'))
    })
    const added = await adoptExistingFolderBindings(['boom', 'chat', 'web', 'moved'])
    expect(added).toBe(1)
    expect(listSources().map((s) => s.scopeId)).toEqual(['moved'])
  })

  it('leaves scopes that already have a folder source alone', async () => {
    await addSource(input({ kind: 'folder', label: 'site' }))
    restore().mockImplementation(async (id: string) => descriptor(id, 'ready'))
    expect(await adoptExistingFolderBindings(['acme'])).toBe(0)
    expect(restore()).not.toHaveBeenCalled()
  })

  it('does nothing when the platform has no folder bindings', async () => {
    const original = platform.restoreProjectBinding
    ;(platform as { restoreProjectBinding?: unknown }).restoreProjectBinding = undefined
    try {
      expect(await adoptExistingFolderBindings(['acme'])).toBe(0)
    } finally {
      ;(platform as { restoreProjectBinding?: unknown }).restoreProjectBinding = original
    }
  })
})
