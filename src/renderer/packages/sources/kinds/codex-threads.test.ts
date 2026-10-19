import type { CodexThreadSummary, SourceDraft, SourceKind } from '@shared/types/sources'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { startJob } from '@/packages/background'
import platform from '@/platform'
import {
  _resetCodexDetectionForTests,
  _resetSourceKindsForTests,
  _resetSourcesForTests,
  codexThreadsHint,
  connectSource,
  getCodexDetection,
  getSource,
  getSourceKind,
  listSources,
  pickSource,
  registerBuiltinSourceKinds,
} from '../index'

const h = vi.hoisted(() => ({ memory: new Map<string, unknown>(), threads: [] as CodexThreadSummary[] }))

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
// The broker's list: updated after `sinceMs`, newest first, at most 200.
vi.mock('@/platform', () => ({
  default: {
    detectCodexThreads: vi.fn(async () => ({
      found: h.threads.length > 0,
      threadCount: h.threads.length,
      displayPath: '~/.codex/sessions',
    })),
    listCodexThreads: vi.fn(async (sinceMs?: number) =>
      h.threads
        .filter((t) => sinceMs === undefined || t.updatedAt > sinceMs)
        .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
        .slice(0, 200)
    ),
    readCodexThread: vi.fn((id: string) => {
      const t = h.threads.find((x) => x.id === id)
      if (!t) return Promise.reject(new Error('Codex thread not found'))
      return Promise.resolve({ ...t, text: `text of ${id}`, truncated: false })
    }),
  },
  platformCapabilities: { supportsProjectWorkspace: true, supportsKnowledgeBase: true, supportsCodexThreads: true },
}))
vi.mock('@/packages/background', async () => {
  const { NeedsUserError } = await import('@/packages/background/errors')
  return {
    NeedsUserError,
    startJob: vi.fn(() => ({ id: 'job-1' })),
    registerFixHandler: vi.fn(),
    listJobs: vi.fn(() => []),
    stopJob: vi.fn(async () => undefined),
    setJobSourceResolver: vi.fn(),
  }
})
vi.mock('@/packages/knowledge', () => ({ markSourceRemoved: vi.fn(async () => 0) }))
vi.mock('@/packages/review', () => ({
  loadReviewEntries: vi.fn(async () => undefined),
  reviewStore: { getState: () => ({ entries: [] }) },
  setReviewEntryState: vi.fn(async () => undefined),
}))
vi.mock('@/hooks/useScopes', () => ({ readScopes: vi.fn(async () => []) }))
vi.mock('@/stores/integrationsStore', () => ({
  ensureIntegrationsStoreInit: vi.fn(async () => undefined),
  integrationsStore: { getState: () => ({ getAccount: () => undefined, removeAccount: vi.fn() }) },
}))
vi.mock('@/packages/integrations', () => ({ startConnectorOAuth: vi.fn(), completeConnectorOAuth: vi.fn() }))
vi.mock('@/utils/oauth-local-callback', () => ({
  waitForLocalOAuthCallback: vi.fn(),
  canUseLocalOAuthCallback: () => true,
}))

const p = vi.mocked(platform, true)

function need<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing')
  return value
}
const kindOf = (kind: SourceKind) => need(getSourceKind(kind))
const thread = (n: number, title = `Thread ${n}`): CodexThreadSummary => ({ id: `t${n}`, title, updatedAt: n * 1000 })
const signal = () => new AbortController().signal

async function connected() {
  const draft = (await pickSource('codex-threads')) as SourceDraft
  const { sourceId } = await connectSource(draft, { scopeId: 'acme', backgroundReview: true })
  const source = getSource(sourceId)
  if (!source) throw new Error('not stored')
  return source
}

beforeEach(() => {
  h.memory.clear()
  h.threads = []
  _resetSourcesForTests()
  _resetSourceKindsForTests()
  _resetCodexDetectionForTests()
  registerBuiltinSourceKinds()
  vi.clearAllMocks()
})

describe('codex threads', () => {
  it('detection alone never creates a source or reads a thread', async () => {
    h.threads = [thread(1), thread(2), thread(3)]
    const detection = await getCodexDetection()
    expect(detection).toEqual({ found: true, threadCount: 3, displayPath: '~/.codex/sessions' })
    expect(codexThreadsHint(detection)).toBe(
      'Found 3 threads in ~/.codex/sessions. Dango reads them only after you connect.'
    )
    const draft = await pickSource('codex-threads')
    expect(draft).toMatchObject({ kind: 'codex-threads', label: 'Codex threads' })
    expect(p.listCodexThreads).not.toHaveBeenCalled()
    expect(p.readCodexThread).not.toHaveBeenCalled()
    expect(listSources()).toEqual([])
  })

  it('says when there are no threads', async () => {
    expect(codexThreadsHint(await getCodexDetection())).toBe('No Codex threads on this computer.')
    h.threads = [thread(1)]
    _resetCodexDetectionForTests()
    expect(codexThreadsHint(await getCodexDetection())).toBe(
      'Found 1 thread in ~/.codex/sessions. Dango reads it only after you connect.'
    )
  })

  it('connect then sync lists threads', async () => {
    h.threads = [thread(1), thread(2), thread(3)]
    const source = await connected()
    expect(startJob).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'sync', label: 'Codex threads sync', sourceId: source.id })
    )
    const result = await need(kindOf('codex-threads').sync)(source, { signal: signal(), progress: vi.fn() })
    expect(result.summary).toBe('Found 3 Codex threads')
    expect(p.readCodexThread).not.toHaveBeenCalled()
  })

  it('read returns only threads newer than the cursor', async () => {
    h.threads = [thread(1), thread(2), thread(3, ''), thread(4)]
    const source = await connected()
    const read = need(kindOf('codex-threads').read)
    const result = await read(source, { signal: signal(), cursor: '2000' })
    expect(p.listCodexThreads).toHaveBeenCalledWith(2000)
    expect(result.items).toEqual([
      { ref: 't3', label: 'Untitled thread', text: 'text of t3', updatedAt: 3000 },
      { ref: 't4', label: 'Thread 4', text: 'text of t4', updatedAt: 4000 },
    ])
    expect(result.cursor).toBe('4000')

    const again = await read(source, { signal: signal(), cursor: result.cursor })
    expect(again.items).toEqual([])
    expect(again.cursor).toBe('4000')
  })

  it('read takes at most 40 threads, oldest first, and continues from there', async () => {
    h.threads = Array.from({ length: 50 }, (_, i) => thread(i + 1))
    const source = await connected()
    const read = need(kindOf('codex-threads').read)
    const first = await read(source, { signal: signal(), cursor: null })
    expect(first.items.map((i) => i.ref)).toEqual(Array.from({ length: 40 }, (_, i) => `t${i + 1}`))
    expect(first.cursor).toBe('40000')
    const second = await read(source, { signal: signal(), cursor: first.cursor })
    expect(second.items.map((i) => i.ref)).toEqual(Array.from({ length: 10 }, (_, i) => `t${i + 41}`))
  })

  it('threads sharing a timestamp are never split across the cursor', async () => {
    h.threads = [
      ...Array.from({ length: 39 }, (_, i) => thread(i + 1)),
      { id: 'tie-a', title: 'a', updatedAt: 40_000 },
      { id: 'tie-b', title: 'b', updatedAt: 40_000 },
    ]
    const source = await connected()
    const read = need(kindOf('codex-threads').read)
    const first = await read(source, { signal: signal(), cursor: null })
    const second = await read(source, { signal: signal(), cursor: first.cursor })
    const refs = [...first.items, ...second.items].map((i) => i.ref)
    expect(refs).toContain('tie-a')
    expect(refs).toContain('tie-b')
    expect(new Set(refs).size).toBe(41)
  })

  it('a truncated list never moves the cursor past threads it could not see', async () => {
    // 250 threads newer than the cursor: the broker returns only the newest 200.
    h.threads = Array.from({ length: 250 }, (_, i) => thread(i + 1))
    const source = await connected()
    const read = need(kindOf('codex-threads').read)
    const seen: string[] = []
    let cursor: string | null = null
    for (let run = 0; run < 5; run++) {
      const result = await read(source, { signal: signal(), cursor })
      seen.push(...result.items.map((i) => i.ref))
      cursor = result.cursor
      // Every list call still starts from the beginning: the 50 oldest are not skipped.
      expect(p.listCodexThreads).toHaveBeenLastCalledWith(undefined)
    }
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen).toHaveLength(200)

    // Once the older ones are reachable (the list is no longer full), they are read too.
    h.threads = h.threads.slice(0, 150)
    const later = await read(source, { signal: signal(), cursor })
    const rest = later.items.map((i) => i.ref)
    expect(rest).toEqual(Array.from({ length: 40 }, (_, i) => `t${i + 1}`))
  })
})
