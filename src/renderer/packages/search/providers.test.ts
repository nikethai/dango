import { beforeEach, describe, expect, it, vi } from 'vitest'
import { attachPrefill } from './attach'
import { chatsProvider } from './providers/chats'
import { importedThreadsProvider } from './providers/importedThreads'
import { knowledgeProvider } from './providers/knowledge'
import { workspaceFilesProvider } from './providers/workspaceFiles'
import type { SearchHit } from './types'

const m = vi.hoisted(() => ({
  listSessionsMeta: vi.fn(),
  searchSessions: vi.fn(),
  ensureKnowledgeLoaded: vi.fn(async () => undefined),
  listKnowledge: vi.fn(),
  scopeName: vi.fn((id: string) => (id === 'everywhere' ? 'Everywhere' : id === 's1' ? 'Acme' : 'Other')),
  readScopes: vi.fn(),
  loadSources: vi.fn(async () => undefined),
  listSources: vi.fn(),
  restoreProjectBinding: vi.fn(),
  searchWorkspace: vi.fn(),
  cancelWorkspaceRequest: vi.fn(async () => undefined),
  loadImportedHistory: vi.fn(),
  navigate: vi.fn(),
  capabilities: { supportsProjectWorkspace: true },
}))

vi.mock('i18next', () => ({
  t: (key: string, opts?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(opts?.[name] ?? '')),
}))
vi.mock('@/stores/chatStore', () => ({ listSessionsMeta: m.listSessionsMeta }))
vi.mock('@/stores/sessionHelpers', () => ({ searchSessions: m.searchSessions }))
vi.mock('@/packages/knowledge', () => ({
  ensureKnowledgeLoaded: m.ensureKnowledgeLoaded,
  listKnowledge: m.listKnowledge,
  scopeName: m.scopeName,
}))
vi.mock('@/hooks/useScopes', () => ({ readScopes: m.readScopes }))
vi.mock('@/packages/sources', () => ({ loadSources: m.loadSources, listSources: m.listSources }))
vi.mock('@/platform', () => ({
  default: {
    restoreProjectBinding: m.restoreProjectBinding,
    searchWorkspace: m.searchWorkspace,
    cancelWorkspaceRequest: m.cancelWorkspaceRequest,
  },
  platformCapabilities: m.capabilities,
}))
vi.mock('@/packages/imported-history', () => ({ loadImportedHistory: m.loadImportedHistory }))
vi.mock('@/router', () => ({ router: { navigate: m.navigate } }))

const textMessage = (id: string, text: string) => ({ id, role: 'user', contentParts: [{ type: 'text', text }] })
const signal = () => new AbortController().signal

beforeEach(() => {
  vi.clearAllMocks()
  m.capabilities.supportsProjectWorkspace = true
})

describe('chats provider', () => {
  beforeEach(() => {
    m.listSessionsMeta.mockResolvedValue([
      { id: 'c-msg', name: 'Weekly notes', projectId: 's1' },
      { id: 'c-name', name: 'Launch plan', projectId: 's1' },
      { id: 'c-other', name: 'Launch party', projectId: 's2' },
    ])
    m.searchSessions.mockImplementation(async (_text: string, _id: unknown, onResult: (s: unknown[]) => void) => {
      await Promise.resolve()
      onResult([
        {
          id: 'c-msg',
          name: 'Weekly notes',
          projectId: 's1',
          messages: [textMessage('m1', 'We talk about the launch\ndate'), textMessage('m2', 'launch again')],
        },
      ])
      onResult([{ id: 'c-other', name: 'Launch party', projectId: 's2', messages: [textMessage('m3', 'launch cake')] }])
    })
  })

  it('returns a name match before a message-only match and drops a chat in another scope', async () => {
    const hits = await chatsProvider.search({ text: 'launch', scopeIds: ['s1'] }, signal())
    expect(hits.map((h) => h.title)).toEqual(['Launch plan', 'Weekly notes'])
    expect(hits[0].sourceLabel).toBe('Chat “Launch plan”')
    expect(hits[0].scopeId).toBe('s1')
    expect(hits[1].excerpt).toBe('We talk about the launch date')
    expect(hits.every((h) => h.group === 'chats')).toBe(true)
  })

  it('keeps chats from every scope for All, one hit per chat', async () => {
    const hits = await chatsProvider.search({ text: 'launch', scopeIds: 'all' }, signal())
    expect(hits.map((h) => h.id)).toEqual(['chat:c-name', 'chat:c-other', 'chat:c-msg'])
    expect(hits.find((h) => h.id === 'chat:c-other')?.excerpt).toBe('launch cake')
  })

  it('drops message batches that arrive after the search was aborted', async () => {
    const controller = new AbortController()
    m.searchSessions.mockImplementation(async (_t: string, _i: unknown, onResult: (s: unknown[]) => void) => {
      await Promise.resolve()
      controller.abort()
      onResult([{ id: 'c-msg', name: 'Weekly notes', projectId: 's1', messages: [textMessage('m1', 'launch')] }])
    })
    const hits = await chatsProvider.search({ text: 'zzz', scopeIds: 'all' }, controller.signal)
    expect(hits).toEqual([])
  })
})

describe('chats provider message scan', () => {
  beforeEach(() => {
    m.listSessionsMeta.mockResolvedValue([{ id: 'c-name', name: 'L plan', projectId: 's1' }])
    m.searchSessions.mockResolvedValue(undefined)
  })

  it('passes the signal, a scope filter and the group limit to searchSessions', async () => {
    const controller = new AbortController()
    await chatsProvider.search({ text: 'launch', scopeIds: ['s1'] }, controller.signal)
    expect(m.searchSessions).toHaveBeenCalledTimes(1)
    const [text, sessionId, , opts] = m.searchSessions.mock.calls[0]
    expect(text).toBe('launch')
    expect(sessionId).toBeUndefined()
    expect(opts.signal).toBe(controller.signal)
    expect(opts.maxSessions).toBe(8)
    expect(opts.include({ id: 'a', projectId: 's1' })).toBe(true)
    expect(opts.include({ id: 'b', projectId: 's2' })).toBe(false)
    expect(opts.include({ id: 'c' })).toBe(false)
    expect(opts.include({ id: 'd', projectId: 's1', hidden: true })).toBe(false)
  })

  it('one character matches names only and scans no messages', async () => {
    const hits = await chatsProvider.search({ text: 'l', scopeIds: 'all' }, signal())
    expect(m.searchSessions).not.toHaveBeenCalled()
    expect(hits.map((h) => h.title)).toEqual(['L plan'])
  })

  it('the excerpt is a window around the match, so it shows the query', async () => {
    m.listSessionsMeta.mockResolvedValue([])
    const long = `${'a'.repeat(300)} the launch date ${'b'.repeat(300)}`
    m.searchSessions.mockImplementation(async (_t: string, _i: unknown, onResult: (s: unknown[]) => void) => {
      await Promise.resolve()
      onResult([{ id: 'c1', name: 'Long', messages: [textMessage('m1', long)] }])
    })
    const [only] = await chatsProvider.search({ text: 'Launch', scopeIds: 'all' }, signal())
    expect(only.excerpt).toContain('launch')
    expect(only.excerpt?.startsWith('…')).toBe(true)
    expect(only.excerpt?.endsWith('…')).toBe(true)
    expect(only.excerpt?.length).toBeLessThanOrEqual(160)
  })

  it('a short message is the whole excerpt, without ellipses', async () => {
    m.listSessionsMeta.mockResolvedValue([])
    m.searchSessions.mockImplementation(async (_t: string, _i: unknown, onResult: (s: unknown[]) => void) => {
      await Promise.resolve()
      onResult([{ id: 'c1', name: 'Short', messages: [textMessage('m1', 'the launch\ndate')] }])
    })
    const [only] = await chatsProvider.search({ text: 'launch', scopeIds: 'all' }, signal())
    expect(only.excerpt).toBe('the launch date')
  })
})

describe('knowledge provider', () => {
  it('lists the chosen scope with the query and labels it with the scope name', async () => {
    m.listKnowledge.mockReturnValue([{ id: 'k1', scopeId: 's1', text: 'Launch is on Tuesday' }])
    const hits = await knowledgeProvider.search({ text: 'launch', scopeIds: ['s1'] }, signal())
    expect(m.ensureKnowledgeLoaded).toHaveBeenCalled()
    expect(m.listKnowledge).toHaveBeenCalledWith('s1', { query: 'launch' })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      group: 'knowledge',
      title: 'Launch is on Tuesday',
      scopeId: 's1',
      sourceLabel: 'Acme knowledge',
    })
    await hits[0].open()
    expect(m.navigate).toHaveBeenCalledWith({
      to: '/scope/$scopeId',
      params: { scopeId: 's1' },
      search: { tab: 'knowledge' },
    })
  })

  it('All searches every scope and Everywhere', async () => {
    m.readScopes.mockResolvedValue([{ id: 's1' }, { id: 's2' }])
    m.listKnowledge.mockReturnValue([])
    await knowledgeProvider.search({ text: 'launch', scopeIds: 'all' }, signal())
    expect(m.listKnowledge.mock.calls.map((c) => c[0])).toEqual(['s1', 's2', 'everywhere'])
  })
})

describe('importedThreads provider', () => {
  it('returns [] when scoped', async () => {
    const hits = await importedThreadsProvider.search({ text: 'launch', scopeIds: ['s1'] }, signal())
    expect(hits).toEqual([])
    expect(m.loadImportedHistory).not.toHaveBeenCalled()
  })

  it('returns one hit per conversation for All', async () => {
    m.loadImportedHistory.mockResolvedValue({
      sources: [
        {
          id: 'src',
          status: 'published',
          originalFilename: 'x.zip',
          conversations: [
            {
              id: 'conv',
              title: 'Trip',
              messages: [
                { id: 'a', text: 'launch one' },
                { id: 'b', text: 'launch two' },
              ],
            },
          ],
        },
      ],
    })
    const hits = await importedThreadsProvider.search({ text: 'launch', scopeIds: 'all' }, signal())
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ group: 'sources', title: 'Trip', sourceLabel: 'ChatGPT “Trip”' })
    expect(hits[0].scopeId).toBeUndefined()
  })
})

describe('workspaceFiles provider', () => {
  it('skips a scope whose binding is missing and searches a ready one', async () => {
    m.listSources.mockReturnValue([
      { id: 'f1', kind: 'folder', scopeId: 's1' },
      { id: 'f2', kind: 'folder', scopeId: 's2' },
    ])
    m.restoreProjectBinding.mockImplementation(async (scopeId: string) =>
      scopeId === 's1'
        ? { projectId: 's1', capabilityId: 'cap-1', status: 'ready' }
        : { projectId: 's2', capabilityId: 'cap-2', status: 'missing' }
    )
    m.searchWorkspace.mockResolvedValue({
      hits: [{ relativePath: 'docs/launch.md', line: 4, excerpt: 'Launch day', kind: 'content' }],
    })
    const hits = await workspaceFilesProvider.search({ text: 'launch', scopeIds: 'all' }, signal())
    expect(m.loadSources).toHaveBeenCalled()
    expect(m.listSources).toHaveBeenCalledWith({ kind: 'folder' })
    expect(m.searchWorkspace).toHaveBeenCalledTimes(1)
    expect(m.searchWorkspace.mock.calls[0].slice(0, 2)).toEqual(['cap-1', 'launch'])
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      group: 'sources',
      title: 'docs/launch.md',
      excerpt: 'Launch day',
      scopeId: 's1',
      sourceLabel: 'docs/launch.md:4',
    })
    await hits[0].open()
    expect(m.navigate).toHaveBeenCalledWith({
      to: '/scope/$scopeId',
      params: { scopeId: 's1' },
      search: { tab: 'files' },
    })
  })

  it('searches only the chosen scopes', async () => {
    m.listSources.mockReturnValue([
      { id: 'f1', kind: 'folder', scopeId: 's1' },
      { id: 'f2', kind: 'folder', scopeId: 's2' },
    ])
    m.restoreProjectBinding.mockResolvedValue({ projectId: 's2', capabilityId: 'cap-2', status: 'ready' })
    m.searchWorkspace.mockResolvedValue({ hits: [] })
    await workspaceFilesProvider.search({ text: 'launch', scopeIds: ['s2'] }, signal())
    expect(m.restoreProjectBinding).toHaveBeenCalledTimes(1)
    expect(m.restoreProjectBinding).toHaveBeenCalledWith('s2')
  })

  it('does nothing without project workspace support', async () => {
    m.capabilities.supportsProjectWorkspace = false
    const hits = await workspaceFilesProvider.search({ text: 'launch', scopeIds: 'all' }, signal())
    expect(hits).toEqual([])
    expect(m.loadSources).not.toHaveBeenCalled()
  })

  it('cancels the native search when aborted', async () => {
    const controller = new AbortController()
    m.listSources.mockReturnValue([{ id: 'f1', kind: 'folder', scopeId: 's1' }])
    m.restoreProjectBinding.mockResolvedValue({ projectId: 's1', capabilityId: 'cap-1', status: 'ready' })
    m.searchWorkspace.mockImplementation(async () => {
      await Promise.resolve()
      controller.abort()
      return { hits: [{ relativePath: 'a.md', kind: 'filename' }] }
    })
    const hits = await workspaceFilesProvider.search({ text: 'launch', scopeIds: 'all' }, controller.signal)
    const requestId = m.searchWorkspace.mock.calls[0][2]
    expect(typeof requestId).toBe('string')
    expect(m.cancelWorkspaceRequest).toHaveBeenCalledWith(requestId)
    expect(hits).toEqual([])
  })
})

describe('attachPrefill', () => {
  const hit = (over: Partial<SearchHit>): SearchHit => ({
    id: 'h',
    group: 'chats',
    title: 'Plan',
    sourceLabel: 'Chat “Plan”',
    open: () => undefined,
    ...over,
  })

  it('quotes the excerpt on one line and names the source', () => {
    expect(attachPrefill(hit({ excerpt: 'a\nb' }))).toBe('> a b\n> — Chat “Plan”\n\n')
  })

  it('falls back to the title and cuts at 280 characters', () => {
    expect(attachPrefill(hit({ title: 'x'.repeat(400) }))).toBe(`> ${'x'.repeat(280)}\n> — Chat “Plan”\n\n`)
  })
})
