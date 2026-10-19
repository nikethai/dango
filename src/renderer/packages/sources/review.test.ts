import { type BackgroundJob, REVIEW_INTERVAL_MS } from '@shared/types/background'
import type { ConnectedSource, SourceItem } from '@shared/types/sources'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NeedsUserError,
  registerFixHandler,
  registerJobHandler,
  registerJobReviewOpener,
  resumeJobs,
  setJobSourceResolver,
  startJob,
} from '@/packages/background'
import { proposeKnowledge } from '@/packages/knowledge'
import { generateText } from '@/packages/model-calls'
import platform, { platformCapabilities } from '@/platform'
import { _stopBackgroundJobsForTests, initBackgroundJobs } from '@/setup/background_jobs'
import {
  _resetSourceKindsForTests,
  _resetSourcesForTests,
  getSource,
  registerBuiltinSourceKinds,
  registerSourceAdapter,
  updateSource,
} from './index'
import { dueReviews, dueSyncs } from './jobs'
import { _resetReviewForTests, buildReviewPrompt, parseProposalDraft, reviewJobHandler, syncJobHandler } from './review'

const h = vi.hoisted(() => ({
  memory: new Map<string, unknown>(),
  settings: {} as Record<string, unknown>,
  jobs: [] as unknown[],
  order: [] as string[],
}))

vi.mock('@/storage', () => ({
  StorageKey: { Sources: 'sources' },
  default: {
    getItem: <T>(key: string, fallback: T): Promise<T> =>
      Promise.resolve(h.memory.has(key) ? (structuredClone(h.memory.get(key)) as T) : fallback),
    setItemNow: (key: string, value: unknown): Promise<void> => {
      h.memory.set(key, structuredClone(value))
      return Promise.resolve()
    },
    removeItem: (key: string): Promise<void> => {
      h.memory.delete(key)
      return Promise.resolve()
    },
  },
}))
vi.mock('@/platform', () => ({
  default: {
    getConfig: vi.fn(async () => ({ uuid: 'u' })),
    getWindowLabel: vi.fn(async () => 'main'),
    discardDraftFolderBindings: vi.fn(async () => 0),
    restoreProjectBinding: vi.fn(async () => ({ status: 'chat-only' })),
  },
  platformCapabilities: {
    supportsProjectWorkspace: true,
    supportsKnowledgeBase: true,
    supportsCodexThreads: true,
    supportsDesktopOnlySettings: true,
  },
}))
vi.mock('@/packages/background', async () => {
  const { NeedsUserError } = await import('@/packages/background/errors')
  let n = 0
  return {
    NeedsUserError,
    startJob: vi.fn((input: Partial<BackgroundJob>) => {
      h.order.push(`start:${input.kind}`)
      return { ...input, id: `job-${++n}` }
    }),
    resumeJobs: vi.fn(() => {
      h.order.push('resume')
      return Promise.resolve()
    }),
    registerJobHandler: vi.fn(),
    registerFixHandler: vi.fn(),
    registerJobReviewOpener: vi.fn(() => {
      h.order.push('opener')
      return () => undefined
    }),
    listJobs: vi.fn(() => h.jobs),
    stopJob: vi.fn(async () => undefined),
    setJobSourceResolver: vi.fn(() => {
      h.order.push('resolver')
    }),
    subscribeBackgroundJobs: vi.fn(() => () => undefined),
  }
})
vi.mock('@/packages/knowledge', () => ({
  markSourceRemoved: vi.fn(async () => 0),
  proposeKnowledge: vi.fn(async (input: { text: string }) => ({ id: `p-${input.text}` })),
}))
vi.mock('@/packages/review', () => ({
  loadReviewEntries: vi.fn(async () => undefined),
  reviewStore: { getState: () => ({ entries: [] }) },
  setReviewEntryState: vi.fn(async () => undefined),
}))
vi.mock('@/hooks/useScopes', () => ({ readScopes: vi.fn(async () => [{ id: 'acme' }]) }))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: { getState: () => ({ getSettings: () => h.settings }) },
}))
vi.mock('@/stores/lastUsedModelStore', () => ({
  lastUsedModelStore: { getState: () => ({ chat: undefined }) },
}))
vi.mock('@/router', () => ({ router: { navigate: vi.fn(async () => undefined) } }))
vi.mock('@shared/models', () => ({ getModel: vi.fn(() => ({ name: 'model' })) }))
vi.mock('@/adapters', () => ({ createModelDependencies: vi.fn(async () => ({})) }))
vi.mock('@/packages/model-calls', () => ({ generateText: vi.fn() }))

const CLOUD_MODEL = {
  defaultChatModel: { provider: 'openai', model: 'gpt-4o' },
  providers: { openai: { apiKey: 'sk-test' } },
}

const sourceOf = (over: Partial<ConnectedSource> = {}): ConnectedSource => ({
  id: 's1',
  kind: 'codex-threads',
  scopeId: 'acme',
  label: 'Codex threads',
  backgroundReview: true,
  localOnly: false,
  config: {},
  connectedAt: 1,
  ...over,
})

const jobOf = (over: Partial<BackgroundJob> = {}): BackgroundJob => ({
  id: 'job-r',
  scopeId: 'acme',
  kind: 'review',
  label: 'Background review of Codex threads',
  status: 'running',
  attempts: 0,
  startedAt: 1,
  sourceId: 's1',
  ...over,
})

const ctxOf = (job = jobOf()) => ({ job, signal: new AbortController().signal, progress: vi.fn() })

function modelSays(...replies: unknown[]) {
  for (const reply of replies) {
    vi.mocked(generateText).mockResolvedValueOnce({
      contentParts: [{ type: 'text', text: typeof reply === 'string' ? reply : JSON.stringify(reply) }],
    } as never)
  }
}

type ReadResult = { items: SourceItem[]; cursor: string | null }
const read = vi.fn<(s: ConnectedSource, c: { cursor: string | null }) => Promise<ReadResult>>()

function storeSources(...sources: ConnectedSource[]) {
  h.memory.set('sources', sources)
  _resetSourcesForTests()
}

beforeEach(() => {
  h.memory.clear()
  h.settings = { ...CLOUD_MODEL }
  h.jobs = []
  h.order = []
  _resetSourcesForTests()
  _resetReviewForTests()
  _resetSourceKindsForTests()
  registerBuiltinSourceKinds()
  vi.clearAllMocks()
  vi.mocked(platform.getWindowLabel as () => Promise<string>)
    .mockReset()
    .mockResolvedValue('main')
  registerSourceAdapter('codex-threads', { read: read as never })
})

afterEach(() => {
  _stopBackgroundJobsForTests()
  vi.useRealTimers()
})

describe('parseProposalDraft', () => {
  const refs = new Set(['a', 'b'])

  it('parseProposalDraft drops refs outside the batch', () => {
    const raw = JSON.stringify({
      proposals: [
        { kind: 'fact', text: 'Acme ships on Fridays', ref: 'a' },
        { kind: 'fact', text: 'Made up', ref: 'zzz' },
      ],
    })
    expect(parseProposalDraft(raw, refs)).toEqual([{ kind: 'fact', text: 'Acme ships on Fridays', ref: 'a' }])
  })

  it('parseProposalDraft returns [] for prose or broken JSON', () => {
    expect(parseProposalDraft('Here are some thoughts about the items.', refs)).toEqual([])
    expect(parseProposalDraft('{"proposals": [{"kind": "fact", "text": "x", "ref": "a"', refs)).toEqual([])
    expect(parseProposalDraft('{"proposals": "none"}', refs)).toEqual([])
    expect(parseProposalDraft('', refs)).toEqual([])
  })

  it('parseProposalDraft strips code fences and think blocks', () => {
    const raw = `<think>{"proposals":[{"kind":"fact","text":"thinking","ref":"a"}]}</think>\n\`\`\`json\n${JSON.stringify(
      { proposals: [{ kind: 'decision', text: 'Use pnpm', ref: 'b' }] }
    )}\n\`\`\``
    expect(parseProposalDraft(raw, refs)).toEqual([{ kind: 'decision', text: 'Use pnpm', ref: 'b' }])
  })

  it('parseProposalDraft drops unknown kinds and empty text', () => {
    const raw = JSON.stringify({
      proposals: [
        { kind: 'rumour', text: 'Nope', ref: 'a' },
        { kind: 'fact', text: '   ', ref: 'a' },
        { kind: 'preference', text: 'x'.repeat(281), ref: 'a' },
        { kind: 'preference', text: 'Replies in English', ref: 'a' },
        'not an object',
      ],
    })
    expect(parseProposalDraft(raw, refs)).toEqual([{ kind: 'preference', text: 'Replies in English', ref: 'a' }])
  })

  it('parseProposalDraft keeps at most 8', () => {
    const proposals = Array.from({ length: 12 }, (_, i) => ({ kind: 'fact', text: `Fact ${i}`, ref: 'a' }))
    const kept = parseProposalDraft(JSON.stringify({ proposals }), refs)
    expect(kept).toHaveLength(8)
    expect(kept[0].text).toBe('Fact 0')
  })
})

describe('buildReviewPrompt', () => {
  it('lists every item with its ref and asks for JSON proposals', () => {
    const { system, user } = buildReviewPrompt('Codex threads', [
      { ref: 't-1', label: 'Deploy notes', text: 'We deploy on Fridays.' },
    ])
    expect(system).toContain('"proposals"')
    expect(system).toMatch(/same language/i)
    expect(user).toContain('t-1')
    expect(user).toContain('We deploy on Fridays.')
    expect(user).toContain('Codex threads')
  })
})

describe('reviewJobHandler', () => {
  it('review proposes with the source id and origin background-review', async () => {
    storeSources(sourceOf())
    read.mockResolvedValue({
      items: [
        { ref: 't1', label: 'Thread one', text: 'We decided to use pnpm.' },
        { ref: 't2', label: 'Thread two', text: 'Acme invoices are due on the 5th.' },
      ],
      cursor: 'c2',
    })
    modelSays({
      proposals: [
        { kind: 'decision', text: 'Use pnpm', ref: 't1' },
        { kind: 'fact', text: 'Acme invoices are due on the 5th', ref: 't2' },
      ],
    })
    const outcome = await reviewJobHandler(ctxOf())
    expect(proposeKnowledge).toHaveBeenCalledTimes(2)
    for (const [input] of vi.mocked(proposeKnowledge).mock.calls) {
      expect(input.origin).toBe('background-review')
      expect(input.scopeId).toBe('acme')
      expect(input.sources[0].sourceId).toBe('s1')
      expect(input.sources[0].kind).toBe('chat')
    }
    expect(vi.mocked(proposeKnowledge).mock.calls[0][0].sources[0]).toMatchObject({ label: 'Thread one', ref: 't1' })
    expect(read.mock.calls[0][1].cursor).toBeNull()
    expect(h.memory.get('source-cursor:s1')).toBe('c2')
    expect(getSource('s1')?.lastReviewAt).toBeTypeOf('number')
    expect(outcome).toEqual({ summary: 'Read 2 items from Codex threads: 2 proposals', addDoneEntry: true })
  })

  it('reads with the stored cursor and adds no Done entry without proposals', async () => {
    storeSources(sourceOf())
    h.memory.set('source-cursor:s1', 'c1')
    read.mockResolvedValue({ items: [{ ref: 't1', label: 'Thread one', text: 'Hello.' }], cursor: 'c2' })
    modelSays({ proposals: [] })
    const outcome = await reviewJobHandler(ctxOf())
    expect(read.mock.calls[0][1].cursor).toBe('c1')
    expect(outcome).toEqual({ summary: 'Read 1 item from Codex threads: no proposals', addDoneEntry: false })
    expect(h.memory.get('source-cursor:s1')).toBe('c2')
  })

  it('a failed review does not advance the cursor', async () => {
    storeSources(sourceOf())
    h.memory.set('source-cursor:s1', 'c1')
    read.mockResolvedValue({ items: [{ ref: 't1', label: 'Thread one', text: 'Use pnpm.' }], cursor: 'c2' })
    modelSays({ proposals: [{ kind: 'decision', text: 'Use pnpm', ref: 't1' }] })
    vi.mocked(proposeKnowledge).mockRejectedValueOnce(new Error('disk full'))
    await expect(reviewJobHandler(ctxOf())).rejects.toThrow('disk full')
    expect(h.memory.get('source-cursor:s1')).toBe('c1')
    expect(getSource('s1')?.lastReviewAt).toBeUndefined()
  })

  it('a failed model call does not advance the cursor', async () => {
    storeSources(sourceOf())
    read.mockResolvedValue({ items: [{ ref: 't1', label: 'Thread one', text: 'Use pnpm.' }], cursor: '{"since":5}' })
    vi.mocked(generateText).mockRejectedValueOnce(new Error('offline'))
    await expect(reviewJobHandler(ctxOf())).rejects.toThrow('offline')
    expect(h.memory.has('source-cursor:s1')).toBe(false)
  })

  it('a retried run does not review again an item it already proposed from', async () => {
    storeSources(sourceOf())
    const items = [
      { ref: 't1', label: 'Thread one', text: 'Use pnpm.' },
      { ref: 't2', label: 'Thread two', text: 'x'.repeat(11_995) },
    ]
    read.mockResolvedValue({ items, cursor: 'c2' })
    // Run 1: the first batch (t1) proposes, the second (t2) fails. Run 2 re-reads both and only asks about t2.
    modelSays({ proposals: [{ kind: 'decision', text: 'Use pnpm', ref: 't1' }] })
    vi.mocked(generateText).mockRejectedValueOnce(new Error('offline'))
    await expect(reviewJobHandler(ctxOf())).rejects.toThrow('offline')
    modelSays({ proposals: [{ kind: 'fact', text: 'Lots of x', ref: 't2' }] })
    const outcome = await reviewJobHandler(ctxOf())
    expect(generateText).toHaveBeenCalledTimes(3)
    expect(vi.mocked(proposeKnowledge).mock.calls.map(([i]) => i.sources[0].ref)).toEqual(['t1', 't2'])
    // The summary counts the proposal the failed attempt filed too (final review #11).
    expect(outcome.summary).toBe('Read 2 items from Codex threads: 2 proposals')
  })

  it('reviews an item read twice in one run once', async () => {
    storeSources(sourceOf())
    read.mockResolvedValue({
      items: [
        { ref: 't1', label: 'Thread one', text: 'Old text.' },
        { ref: 't1', label: 'Thread one', text: 'New text.' },
      ],
      cursor: 'c2',
    })
    modelSays({ proposals: [{ kind: 'fact', text: 'New', ref: 't1' }] })
    const outcome = await reviewJobHandler(ctxOf())
    const user = vi
      .mocked(generateText)
      .mock.calls[0][1].map((m) => JSON.stringify(m))
      .join('\n')
    expect(user).toContain('New text.')
    expect(user).not.toContain('Old text.')
    expect(outcome.summary).toBe('Read 1 item from Codex threads: 1 proposal')
  })

  it('batches items to at most 12,000 characters per model call', async () => {
    storeSources(sourceOf())
    const items = Array.from({ length: 5 }, (_, i) => ({ ref: `t${i}`, label: `T${i}`, text: 'y'.repeat(5_000) }))
    read.mockResolvedValue({ items, cursor: 'c2' })
    modelSays({ proposals: [] }, { proposals: [] }, { proposals: [] })
    await reviewJobHandler(ctxOf())
    expect(generateText).toHaveBeenCalledTimes(3)
  })

  it('a retry counts proposals an earlier failed attempt filed, so its Done entry is kept', async () => {
    storeSources(sourceOf())
    const items = [
      { ref: 't1', label: 'Thread one', text: 'Use pnpm.' },
      { ref: 't2', label: 'Thread two', text: 'x'.repeat(11_995) },
    ]
    read.mockResolvedValue({ items, cursor: 'c2' })
    modelSays({ proposals: [{ kind: 'decision', text: 'Use pnpm', ref: 't1' }] })
    vi.mocked(generateText).mockRejectedValueOnce(new Error('offline'))
    await expect(reviewJobHandler(ctxOf())).rejects.toThrow('offline')
    // The retry proposes nothing new, but the run as a whole filed one proposal.
    modelSays({ proposals: [] })
    const outcome = await reviewJobHandler(ctxOf())
    expect(outcome).toEqual({ summary: 'Read 2 items from Codex threads: 1 proposal', addDoneEntry: true })
    // Once the cursor is saved, the next run starts counting from zero.
    read.mockResolvedValue({ items: [{ ref: 't3', label: 'Thread three', text: 'Hello.' }], cursor: 'c3' })
    modelSays({ proposals: [] })
    expect(await reviewJobHandler(ctxOf())).toMatchObject({ addDoneEntry: false })
  })

  it('an item whose label and ref alone exceed the batch size is sent with no text', async () => {
    storeSources(sourceOf())
    read.mockResolvedValue({
      items: [{ ref: 't1', label: 'L'.repeat(12_001), text: `secret-${'z'.repeat(100)}` }],
      cursor: 'c2',
    })
    modelSays({ proposals: [] })
    await reviewJobHandler(ctxOf())
    const sent = JSON.stringify(vi.mocked(generateText).mock.calls[0][1])
    expect(sent).not.toContain('secret-')
  })

  it('a review or sync of a removed source ends quietly: no error, no Done entry', async () => {
    storeSources(sourceOf({ id: 'other' }))
    const review = await reviewJobHandler(ctxOf())
    expect(review).toEqual({ summary: 'This source was removed.', addDoneEntry: false })
    const sync = await syncJobHandler(ctxOf(jobOf({ kind: 'sync' })))
    expect(sync).toEqual({ summary: 'This source was removed.', addDoneEntry: false })
    expect(read).not.toHaveBeenCalled()
  })

  it('no model raises choose-model', async () => {
    storeSources(sourceOf())
    h.settings = {}
    const error = await reviewJobHandler(ctxOf()).catch((e) => e)
    expect(error).toBeInstanceOf(NeedsUserError)
    expect(error).toMatchObject({ reason: 'no model is set up', fix: { action: 'choose-model' } })
    expect(read).not.toHaveBeenCalled()
  })

  it('a local-only source on a cloud model raises choose-model without reading', async () => {
    storeSources(sourceOf({ localOnly: true }))
    const error = await reviewJobHandler(ctxOf()).catch((e) => e)
    expect(error).toBeInstanceOf(NeedsUserError)
    expect(error).toMatchObject({
      reason: 'this source stays on this device; choose a local model',
      fix: { action: 'choose-model', label: 'Choose a model' },
    })
    expect(read).not.toHaveBeenCalled()
    expect(generateText).not.toHaveBeenCalled()
  })
})

describe('syncJobHandler', () => {
  it('runs the kind sync and records lastSyncAt', async () => {
    storeSources(sourceOf())
    const sync = vi.fn(async () => ({ summary: 'Found 3 threads' }))
    registerSourceAdapter('codex-threads', { sync })
    const outcome = await syncJobHandler(ctxOf(jobOf({ kind: 'sync' })))
    expect(sync).toHaveBeenCalledOnce()
    expect(outcome).toEqual({ summary: 'Found 3 threads', addDoneEntry: true })
    expect(getSource('s1')?.lastSyncAt).toBeTypeOf('number')
  })
})

describe('due jobs', () => {
  const now = 1_000_000_000
  const HOUR = 60 * 60 * 1000
  const folder = (over: Partial<ConnectedSource> = {}) =>
    sourceOf({ kind: 'folder', backgroundReview: true, lastSyncAt: now - 1000, ...over })

  it.each([
    ['switch off', folder({ backgroundReview: false }), [], []],
    ['never synced', folder({ lastSyncAt: undefined }), [], []],
    ['synced, never reviewed', folder(), [], ['s1']],
    ['reviewed 5 h ago', folder({ lastReviewAt: now - 5 * HOUR }), [], []],
    ['reviewed 7 h ago', folder({ lastReviewAt: now - 7 * HOUR }), [], ['s1']],
    ['running review job', folder(), [jobOf({ status: 'running' })], []],
    ['a kind without read', sourceOf({ kind: 'documents', lastSyncAt: now }), [], []],
    ['latest review waits for its fix', folder(), [jobOf({ status: 'needs-you' })], []],
  ] as const)('dueReviews: %s', (_name, source, jobs, expected) => {
    expect(dueReviews([source], [...jobs], now)).toEqual(expected)
  })

  it('dueReviews counts the interval from a stopped review', () => {
    const stopped = jobOf({ status: 'failed', stoppedAt: now - HOUR, finishedAt: now - HOUR })
    expect(dueReviews([folder()], [stopped], now)).toEqual([])
    expect(dueReviews([folder()], [stopped], now + REVIEW_INTERVAL_MS)).toEqual(['s1'])
  })

  it('dueSyncs needs pollMs and a sync at least pollMs ago', () => {
    const synced2MinAgo = sourceOf({ kind: 'gmail', lastSyncAt: now - 120_000 })
    expect(dueSyncs([synced2MinAgo], [], now)).toEqual([])
    registerSourceAdapter('gmail', { pollMs: 60_000, sync: async () => ({ summary: '' }) })
    expect(dueSyncs([synced2MinAgo], [], now)).toEqual(['s1'])
    expect(dueSyncs([sourceOf({ kind: 'gmail', lastSyncAt: now - 30_000 })], [], now)).toEqual([])
    expect(dueSyncs([synced2MinAgo], [jobOf({ kind: 'sync', status: 'running' })], now)).toEqual([])
  })
  it('dueSyncs starts the first sync of a never-synced source whatever its pollMs', () => {
    const never = folder({ lastSyncAt: undefined })
    expect(dueSyncs([never], [], now)).toEqual(['s1'])
    const sync = (over: Partial<BackgroundJob>) => jobOf({ kind: 'sync', ...over })
    expect(dueSyncs([never], [sync({ status: 'running' })], now)).toEqual([])
    expect(dueSyncs([never], [sync({ status: 'needs-you' })], now)).toEqual([])
    // A first sync the user stopped waits a review interval before it is started again.
    const stopped = sync({ status: 'failed', stoppedAt: now - HOUR, finishedAt: now - HOUR })
    expect(dueSyncs([never], [stopped], now)).toEqual([])
    expect(dueSyncs([never], [stopped], now + REVIEW_INTERVAL_MS)).toEqual(['s1'])
    // A kind that cannot sync never gets one.
    expect(dueSyncs([sourceOf({ kind: 'gmail' })], [], now)).toEqual([])
  })
})

describe('initBackgroundJobs', () => {
  it('initBackgroundJobs does nothing in the quick window', async () => {
    vi.mocked(platform.getWindowLabel as () => Promise<string>).mockResolvedValueOnce('quick')
    await initBackgroundJobs()
    expect(registerJobHandler).not.toHaveBeenCalled()
    expect(resumeJobs).not.toHaveBeenCalled()
    expect(platform.discardDraftFolderBindings).not.toHaveBeenCalled()
  })

  it('does nothing when the window label cannot be read on desktop', async () => {
    vi.mocked(platform.getWindowLabel as () => Promise<string>).mockRejectedValueOnce(new Error('no ipc'))
    await initBackgroundJobs()
    expect(registerJobHandler).not.toHaveBeenCalled()
  })

  it('it discards draft bindings at start', async () => {
    await initBackgroundJobs()
    expect(platform.discardDraftFolderBindings).toHaveBeenCalledOnce()
    expect(registerJobHandler).toHaveBeenCalledWith('sync', syncJobHandler)
    expect(registerJobHandler).toHaveBeenCalledWith('review', reviewJobHandler)
    expect(registerFixHandler).toHaveBeenCalled()
    expect(setJobSourceResolver).toHaveBeenCalled()
    expect(h.order.indexOf('resolver')).toBeLessThan(h.order.indexOf('opener'))
    expect(registerJobReviewOpener).toHaveBeenCalledOnce()
  })

  it('runs on web, where there is no window label', async () => {
    const caps = platformCapabilities as { supportsDesktopOnlySettings: boolean }
    caps.supportsDesktopOnlySettings = false
    try {
      vi.mocked(platform.getWindowLabel as () => Promise<string>).mockResolvedValue('test')
      await initBackgroundJobs()
      expect(resumeJobs).toHaveBeenCalledOnce()
    } finally {
      caps.supportsDesktopOnlySettings = true
    }
  })

  it('resumes jobs before starting due ones at launch', async () => {
    storeSources(sourceOf({ kind: 'folder', lastSyncAt: 5 }))
    let finishResume!: () => void
    vi.mocked(resumeJobs).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishResume = () => {
            h.order.push('resume')
            resolve()
          }
        })
    )
    const init = initBackgroundJobs()
    await vi.waitFor(() => expect(resumeJobs).toHaveBeenCalled())
    expect(startJob).not.toHaveBeenCalled()
    finishResume()
    await init
    await vi.waitFor(() => expect(startJob).toHaveBeenCalled())
    expect(h.order.indexOf('resume')).toBeLessThan(h.order.indexOf('start:review'))
    expect(vi.mocked(startJob).mock.calls[0][0]).toMatchObject({
      kind: 'review',
      sourceId: 's1',
      label: 'Background review of Codex threads',
    })
  })

  it('starts nothing until a failed resume succeeds', async () => {
    vi.useFakeTimers()
    storeSources(sourceOf({ kind: 'folder', lastSyncAt: 5 }))
    // Launch tries twice (before adopting bindings, then at the first check); the 15-minute check tries again.
    vi.mocked(resumeJobs).mockRejectedValueOnce(new Error('storage')).mockRejectedValueOnce(new Error('storage'))
    await initBackgroundJobs()
    await vi.advanceTimersByTimeAsync(0)
    expect(startJob).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
    expect(resumeJobs).toHaveBeenCalledTimes(3)
    expect(startJob).toHaveBeenCalledWith(expect.objectContaining({ kind: 'review', sourceId: 's1' }))
  })

  it('an adopted folder with background review on syncs first, then is reviewed', async () => {
    const { subscribeBackgroundJobs } = await import('@/packages/background')
    // Adopted at launch: no job and no lastSyncAt. No built-in kind sets pollMs.
    storeSources(sourceOf({ kind: 'folder' }))
    await initBackgroundJobs()
    await vi.waitFor(() => expect(subscribeBackgroundJobs).toHaveBeenCalled())
    expect(startJob).toHaveBeenCalledTimes(1)
    expect(startJob).toHaveBeenCalledWith(expect.objectContaining({ kind: 'sync', sourceId: 's1' }))
    const listener = vi.mocked(subscribeBackgroundJobs).mock.calls[0][0]
    const running = jobOf({ id: 'j-sync', kind: 'sync', status: 'running' })
    listener([running])
    await updateSource('s1', { lastSyncAt: Date.now() })
    listener([{ ...running, status: 'done' }])
    await vi.waitFor(() =>
      expect(startJob).toHaveBeenCalledWith(expect.objectContaining({ kind: 'review', sourceId: 's1' }))
    )
  })
})
