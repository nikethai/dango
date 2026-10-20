import type { Message, SessionSettings } from '@shared/types'
import type { KnowledgeProposal } from '@shared/types/knowledge'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extractFactsFromTranscript, transcriptFromMessages } from '@/packages/memory/extract'
import { memoryStore } from '@/stores/memoryStore'
import { _resetChatProposerForTests, proposeFromChatTurn } from './chat-proposer'
import { proposeKnowledge } from './proposals'

vi.mock('@/stores/memoryStore', () => {
  const counters: Record<string, number> = {}
  const state = {
    settings: { enabled: true, autoSave: true, retainEveryNTurns: 3 },
    bumpSessionTurn: vi.fn((id: string) => {
      counters[id] = (counters[id] ?? 0) + 1
      return counters[id]
    }),
    resetSessionTurn: vi.fn((id: string) => {
      counters[id] = 0
    }),
    replaceGlobalBank: vi.fn(),
    replaceAgentBank: vi.fn(),
    _counters: counters,
  }
  return { memoryStore: { getState: () => state }, ensureMemoryStoreInit: vi.fn(async () => undefined) }
})
vi.mock('@/packages/memory/extract', () => ({
  transcriptFromMessages: vi.fn(() => 'user: we launch on 13 Nov'),
  extractFactsFromTranscript: vi.fn(async () => ({ facts: [] })),
}))
vi.mock('@/packages/model-calls/toolsets/pm-pilot', () => ({
  loadLocalOnlyQuestionIds: vi.fn(async (ids: string[]) => new Set(ids)),
}))
vi.mock('./proposals', () => ({
  proposeKnowledge: vi.fn(
    async (input: Omit<KnowledgeProposal, 'id' | 'createdAt'>): Promise<KnowledgeProposal> => ({
      ...input,
      id: `p-${input.text}`,
      createdAt: 1,
    })
  ),
}))

const messages = [{ id: 'm1', role: 'user', contentParts: [{ type: 'text', text: 'hi' }] }] as Message[]
const turn = (over: Partial<Parameters<typeof proposeFromChatTurn>[0]> = {}) =>
  proposeFromChatTurn({
    sessionId: 's1',
    sessionName: 'Launch planning',
    messageId: 'm2',
    scopeId: 'acme',
    messages,
    ...over,
  })

const store = () =>
  memoryStore.getState() as unknown as {
    settings: { enabled: boolean; autoSave: boolean; retainEveryNTurns: number }
    _counters: Record<string, number>
    replaceGlobalBank: ReturnType<typeof vi.fn>
    replaceAgentBank: ReturnType<typeof vi.fn>
  }

beforeEach(() => {
  vi.clearAllMocks()
  _resetChatProposerForTests()
  for (const k of Object.keys(store()._counters)) delete store()._counters[k]
  store().settings = { enabled: true, autoSave: true, retainEveryNTurns: 3 }
  vi.mocked(extractFactsFromTranscript).mockResolvedValue({
    facts: [{ content: 'Launch is 13 Nov', tags: ['date'], scope: 'global' }],
  })
})

describe('proposeFromChatTurn', () => {
  it('runs on every third turn only', async () => {
    for (let i = 0; i < 7; i++) await turn()
    expect(extractFactsFromTranscript).toHaveBeenCalledTimes(2)
    expect(proposeKnowledge).toHaveBeenCalledTimes(2)
  })

  it('does nothing when the session opted out', async () => {
    for (let i = 0; i < 6; i++) await turn({ sessionSettings: { memoryAutoSave: false } })
    expect(extractFactsFromTranscript).not.toHaveBeenCalled()
    expect(proposeKnowledge).not.toHaveBeenCalled()
  })

  it('does nothing when auto-save is off globally', async () => {
    store().settings = { enabled: true, autoSave: false, retainEveryNTurns: 3 }
    for (let i = 0; i < 6; i++) await turn()
    expect(extractFactsFromTranscript).not.toHaveBeenCalled()
  })

  it('preference tag goes to Everywhere, decision tag becomes a decision', async () => {
    vi.mocked(extractFactsFromTranscript).mockResolvedValue({
      facts: [
        { content: 'Prefers short answers', tags: ['preference', 'decision'], scope: 'global' },
        { content: 'We use Postgres', tags: ['decision'], scope: 'global' },
        { content: 'Launch is 13 Nov', tags: ['date'], scope: 'agent' },
      ],
    })
    await turn()
    await turn()
    const out = await turn()
    expect(out).toHaveLength(3)
    const calls = vi.mocked(proposeKnowledge).mock.calls.map((c) => c[0])
    expect(calls[0]).toMatchObject({ kind: 'preference', scopeId: EVERYWHERE_SCOPE_ID, text: 'Prefers short answers' })
    expect(calls[1]).toMatchObject({ kind: 'decision', scopeId: 'acme' })
    expect(calls[2]).toMatchObject({
      kind: 'fact',
      scopeId: 'acme',
      origin: 'chat',
      sessionId: 's1',
      messageId: 'm2',
      sources: [{ kind: 'chat', label: 'Launch planning', ref: 's1' }],
    })
  })

  it('unscoped chat proposes to Everywhere', async () => {
    await turn({ scopeId: null })
    await turn({ scopeId: null })
    await turn({ scopeId: null })
    expect(proposeKnowledge).toHaveBeenCalledWith(expect.objectContaining({ scopeId: EVERYWHERE_SCOPE_ID }))
  })

  it('sends no old memory summary and writes no old bank', async () => {
    await turn()
    await turn()
    await turn()
    const arg = vi.mocked(extractFactsFromTranscript).mock.calls[0][0]
    expect(arg.existingSummaries).toBeUndefined()
    expect(store().replaceGlobalBank).not.toHaveBeenCalled()
    expect(store().replaceAgentBank).not.toHaveBeenCalled()
  })

  it('passes the session settings so the session model extracts', async () => {
    const sessionSettings = { memoryAutoSave: true, modelId: 'gpt-x' } as SessionSettings
    await turn({ sessionSettings })
    await turn({ sessionSettings })
    await turn({ sessionSettings })
    expect(extractFactsFromTranscript).toHaveBeenCalledWith(expect.objectContaining({ sessionSettings }))
  })

  it('an extraction error is logged and proposes nothing', async () => {
    vi.mocked(extractFactsFromTranscript).mockResolvedValue({ facts: [], error: 'offline' })
    await turn()
    await turn()
    expect(await turn()).toEqual([])
    expect(proposeKnowledge).not.toHaveBeenCalled()
  })

  it('runs at most once per session at a time', async () => {
    let release: () => void = () => undefined
    vi.mocked(extractFactsFromTranscript).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ facts: [] })
        })
    )
    store()._counters.s1 = 2
    const first = turn()
    await vi.waitFor(() => expect(extractFactsFromTranscript).toHaveBeenCalledTimes(1))
    store()._counters.s1 = 2
    await turn()
    expect(extractFactsFromTranscript).toHaveBeenCalledTimes(1)
    release()
    await first
  })
})

describe('proposeFromChatTurn and the PM pilot (ADR 0003)', () => {
  const recallAnswer = {
    id: 'm1',
    role: 'assistant',
    contentParts: [
      {
        type: 'tool-call',
        state: 'result',
        toolCallId: 'c1',
        toolName: 'client_recall',
        args: { query: 'price' },
        result: { ok: true, records: [{ text: 'The price is 4,200' }], localOnly: true },
      },
      { type: 'text', text: 'Jo said the price is 4,200.' },
    ],
  } as Message

  it('a cloud model is never sent a local-only recall answer', async () => {
    const chat = [
      { id: 'u1', role: 'user', contentParts: [{ type: 'text', text: 'price?' }] },
      recallAnswer,
    ] as Message[]
    for (let i = 0; i < 3; i++) await turn({ messages: chat, sessionSettings: { provider: 'openai' } })
    expect(extractFactsFromTranscript).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(vi.mocked(transcriptFromMessages).mock.calls)).not.toContain('4,200')

    vi.mocked(transcriptFromMessages).mockClear()
    for (let i = 0; i < 3; i++) await turn({ sessionId: 's2', messages: chat, sessionSettings: { provider: 'ollama' } })
    expect(JSON.stringify(vi.mocked(transcriptFromMessages).mock.calls)).toContain('4,200')
  })

  it('a Needs you chat (CH6) is never read for proposals: its opening is client mail', async () => {
    const chat = [
      { id: 'o1', role: 'assistant', pmQuestionId: 'q1', contentParts: [{ type: 'text', text: 'Jo quoted 8,400' }] },
      { id: 'u1', role: 'user', contentParts: [{ type: 'text', text: '9,100' }] },
    ] as Message[]
    for (let i = 0; i < 6; i++) await turn({ messages: chat, sessionSettings: { provider: 'ollama' } })
    expect(transcriptFromMessages).not.toHaveBeenCalled()
    expect(extractFactsFromTranscript).not.toHaveBeenCalled()
  })
})
