import { type ClientQuestion, ch6Opening, recordId, type SourceRecord, tierFor } from '@shared/pm-pilot'
import type { Message } from '@shared/types'
import type { ConnectedSource } from '@shared/types/sources'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The bridge, the chat store, drafting and the Gmail pipeline are mocked; the PM store is the real one over test
// storage, so "answered once" and the pending backfill are checked as stored.

const h = vi.hoisted(() => {
  const interpolate = (key: string, values?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ''))
  class KnowledgeConflictError extends Error {
    conflict: { id: string }
    constructor(conflict: { id: string }) {
      super('conflict')
      this.conflict = conflict
    }
  }
  return {
    interpolate,
    KnowledgeConflictError,
    sources: [] as ConnectedSource[],
    sessions: new Map<
      string,
      { id: string; name: string; threadName?: string; projectId?: string; messages: Message[] }
    >(),
    role: 'jobs' as 'jobs' | 'quick' | 'other',
    knowledge: [] as Array<{ id: string; scopeId: string; text: string }>,
    openers: new Map<string, (e: unknown) => Promise<void> | void>(),
  }
})

vi.mock('@/i18n', () => ({ default: { t: h.interpolate } }))

vi.mock('./bridge', () => {
  const scopes: Record<string, { id: string; name: string; kind: string }> = {
    acme: { id: 'acme', name: 'Acme Co', kind: 'client' },
    globex: { id: 'globex', name: 'Globex', kind: 'client' },
  }
  return {
    EVERYWHERE_SCOPE_ID: '__everywhere__',
    NEVER_SEND_EMAIL: { id: 'builtin:never-send-email' },
    KnowledgeConflictError: h.KnowledgeConflictError,
    getScope: vi.fn(async (id: string) => scopes[id]),
    listSources: (filter?: { kind?: string }) => h.sources.filter((s) => !filter?.kind || s.kind === filter.kind),
    loadSources: vi.fn(async () => undefined),
    sourcesStore: { getState: () => ({ loaded: true }) },
    updateSource: vi.fn((id: string, patch: Partial<ConnectedSource>) => {
      h.sources = h.sources.map((s) => (s.id === id ? { ...s, ...patch } : s))
      return Promise.resolve()
    }),
    gmailConfig: (s: { config: Record<string, unknown> }) => ({
      accountId: String(s.config.accountId ?? ''),
      matchers: Array.isArray(s.config.matchers) ? (s.config.matchers as string[]) : [],
    }),
    proposeKnowledge: vi.fn(async (input: Record<string, unknown>) => ({ ...input, id: 'p1', createdAt: 1 })),
    approveProposal: vi.fn(async (id: string, opts: { text: string }) => ({
      id: `k-${id}`,
      scopeId: 'acme',
      kind: 'fact',
      text: opts.text,
      sources: [],
      updatedAt: 5,
    })),
    addKnowledge: vi.fn(async (input: { scopeId: string; text: string }) => ({
      id: 'k-added',
      kind: 'fact',
      sources: [],
      updatedAt: 5,
      ...input,
    })),
    resolveConflict: vi.fn(async () => undefined),
    ensureKnowledgeLoaded: vi.fn(async () => undefined),
    knowledgeForTurn: vi.fn((scopeId: string) =>
      h.knowledge.filter((k) => k.scopeId === scopeId).map((k) => ({ ...k, kind: 'fact', sources: [], updatedAt: 1 }))
    ),
    setReviewEntryState: vi.fn(async () => undefined),
    registerReviewOpener: vi.fn((type: string, open: (e: unknown) => Promise<void>) => {
      h.openers.set(type, open)
      return () => h.openers.delete(type)
    }),
    openConfiguration: vi.fn(async () => undefined),
    switchCurrentSession: vi.fn(async () => undefined),
  }
})

vi.mock('./act-call', () => ({ actOnThread: vi.fn(async () => 'drafted') }))
vi.mock('./pipeline', () => ({
  runGmailPipeline: vi.fn(async () => ({ summary: '', quiet: true })),
  getSourceHealth: () => ({ ok: true }),
}))
vi.mock('@/platform/windowRole', () => ({ getWindowRole: vi.fn(async () => h.role) }))
vi.mock('@/lib/startNewChat', () => ({ startNewChat: vi.fn() }))
vi.mock('@/stores/chatStore', () => ({
  createSession: vi.fn((input: { name: string; projectId?: string; messages: Message[] }) => {
    const session = { ...input, id: `s${h.sessions.size + 1}` }
    h.sessions.set(session.id, session)
    return Promise.resolve(session)
  }),
  getSession: vi.fn(async (id: string) => h.sessions.get(id) ?? null),
}))

import { createMessage } from '@shared/types'
import { startNewChat } from '@/lib/startNewChat'
import platform from '@/platform'
import { actOnThread } from './act-call'
import {
  answerClientQuestion,
  clientAnswerDescription,
  findAnswerableQuestion,
  initPmQuestions,
  localOnlyQuestionIds,
  openClientQuestion,
} from './answer'
import {
  addKnowledge,
  approveProposal,
  openConfiguration,
  proposeKnowledge,
  resolveConflict,
  setReviewEntryState,
  switchCurrentSession,
  updateSource,
} from './bridge'
import { runGmailPipeline } from './pipeline'
import { _resetPmStoreForTests, pmStore } from './store'

const at = (iso: string) => new Date(`${iso}T09:00:00`).getTime()

function source(id: string, kind: 'gmail' | 'asana', scopeId: string, config: Record<string, unknown>, over = {}) {
  return {
    id,
    scopeId,
    kind,
    label: id,
    backgroundReview: false,
    localOnly: false,
    config,
    connectedAt: 0,
    ...over,
  } as ConnectedSource
}

function rec(over: Partial<SourceRecord> & { externalId: string }): SourceRecord {
  return {
    id: recordId(over.sourceKind ?? 'gmail', over.externalId),
    sourceKind: 'gmail',
    sourceId: 'g1',
    accountId: 'acc1',
    threadOrTaskId: 't1',
    scopeId: 'acme',
    author: 'jo@acme.com',
    authorName: 'Jo Bloggs',
    participants: ['jo@acme.com'],
    occurredAt: at('2026-10-01'),
    title: 'Quote',
    text: 'Which quote is current?',
    sentByMe: false,
    noise: false,
    link: { label: 'Gmail', url: 'https://mail.google.com/mail/#all/t1' },
    ...over,
  }
}

function whichAnswer(over: Partial<ClientQuestion> = {}): ClientQuestion {
  return {
    id: 'q1',
    kind: 'which-answer',
    sourceId: 'g1',
    scopeId: 'acme',
    accountId: 'acc1',
    threadId: 't1',
    subject: 'Quote',
    from: 'jo@acme.com',
    summary: 'Client asks for the revised quote.',
    candidates: [
      { value: '8,400', date: at('2026-09-12'), sourceLabel: "Jo's 12 Sep email", evidenceIds: ['r:gmail:m0'] },
      { value: '9,100', date: at('2026-09-30'), sourceLabel: 'Asana "Quote"', evidenceIds: ['r:asana:task1'] },
    ],
    reviewEntryId: 'e1',
    state: 'open',
    createdAt: 1,
    ...over,
  }
}

function whichClient(over: Partial<ClientQuestion> = {}): ClientQuestion {
  return {
    id: 'q2',
    kind: 'which-client',
    scopeId: null,
    accountId: 'acc1',
    threadId: 't9',
    subject: 'New project',
    from: 'ann@newco.com',
    summary: '',
    candidates: [
      { value: 'Acme Co', sourceLabel: '', scopeId: 'acme' },
      { value: 'Globex', sourceLabel: '', scopeId: 'globex' },
    ],
    domain: 'newco.com',
    reviewEntryId: 'e2',
    state: 'open',
    createdAt: 1,
    ...over,
  }
}

function whichProject(over: Partial<ClientQuestion> = {}): ClientQuestion {
  return {
    id: 'q3',
    kind: 'which-project',
    sourceId: 'a1',
    scopeId: 'acme',
    accountId: 'asana1',
    threadId: '',
    subject: '',
    from: '',
    summary: '',
    candidates: [
      { value: 'Website redesign', sourceLabel: 'Asana', projectGid: '111' },
      { value: 'Brand book', sourceLabel: 'Asana', projectGid: '222' },
    ],
    reviewEntryId: 'e3',
    state: 'open',
    createdAt: 1,
    ...over,
  }
}

/** Opens the question's chat, then the user answers `text`; the answer being written is the last message. */
async function chatWith(q: ClientQuestion, text: string): Promise<string> {
  await pmStore.saveQuestion(q)
  const sessionId = await openClientQuestion(q.id)
  const session = h.sessions.get(sessionId)
  if (!session) throw new Error('no session')
  session.messages = [
    ...session.messages,
    createMessage('user', text),
    { ...createMessage('assistant', ''), generating: true },
  ]
  return sessionId
}

async function clearStorage() {
  for (const key of await platform.getAllStoreKeys()) await platform.delStoreValue(key)
}

beforeEach(async () => {
  vi.clearAllMocks()
  await clearStorage()
  _resetPmStoreForTests()
  h.sessions.clear()
  h.openers.clear()
  h.knowledge = []
  h.role = 'jobs'
  h.sources = [
    source('g1', 'gmail', 'acme', { accountId: 'acc1', matchers: ['@acme.com'] }),
    source('g2', 'gmail', 'globex', { accountId: 'acc1', matchers: ['@globex.com'] }),
    source('a1', 'asana', 'acme', { accountId: 'asana1' }),
  ]
  await pmStore.upsertRecords([
    rec({ externalId: 'm0', occurredAt: at('2026-09-12'), text: 'The quote is 8,400.' }),
    rec({ externalId: 'm1' }),
    rec({
      externalId: 'task1',
      sourceKind: 'asana',
      sourceId: 'a1',
      threadOrTaskId: 'task1',
      author: 'Sam',
      title: 'Quote',
      text: 'Final quote 9,100',
      link: { label: 'Asana', url: 'https://app.asana.com/0/1/2' },
    }),
  ])
  await pmStore.flushRecords()
})

describe('openClientQuestion', () => {
  it('opens one chat per question with the CH6 opening', async () => {
    await pmStore.saveQuestion(whichAnswer())
    const id = await openClientQuestion('q1')
    const session = h.sessions.get(id)
    expect(session?.name).toBe('Quote')
    expect(session?.projectId).toBe('acme')
    expect(session?.messages).toHaveLength(1)
    const [opening] = session?.messages ?? []
    expect(opening.role).toBe('assistant')
    expect(opening.pmQuestionId).toBe('q1')
    // No side model call sees the mail: no follow-up suggestions for the opening, and no thread naming.
    expect(opening.followUpSuggestions).toEqual([])
    expect(session?.threadName).toBe('Quote')
    expect(opening.contentParts).toEqual([
      {
        type: 'text',
        text: [
          "Client asks for the revised quote. I found two answers and can't tell which is current:",
          "8,400 · 12 Sep · Jo's 12 Sep email",
          '9,100 · 30 Sep · Asana "Quote"',
          "Pick one, or type the answer. I'll save it for Acme Co and draft the reply.",
        ].join('\n'),
      },
    ])
    expect((await pmStore.getQuestion('q1'))?.sessionId).toBe(id)
    // Later calls reopen the same chat, even at the same moment.
    const again = await Promise.all([openClientQuestion('q1'), openClientQuestion('q1')])
    expect(again).toEqual([id, id])
    expect(h.sessions.size).toBe(1)
  })

  it('opens a new chat when the earlier one was deleted', async () => {
    await pmStore.saveQuestion(whichAnswer({ sessionId: 'gone' }))
    const id = await openClientQuestion('q1')
    expect(id).not.toBe('gone')
    expect((await pmStore.getQuestion('q1'))?.sessionId).toBe(id)
  })

  it('asks which client with numbered scopes and no scope on the chat', async () => {
    await pmStore.saveQuestion(whichClient())
    const session = h.sessions.get(await openClientQuestion('q2'))
    expect(session?.projectId).toBeUndefined()
    expect(session?.name).toBe('New project')
    expect(session?.messages[0].contentParts).toEqual([
      {
        type: 'text',
        text: [
          'Which client is this? ann@newco.com wrote about "New project".',
          '1. Acme Co',
          '2. Globex',
          "Pick one and I'll file this thread and others from newco.com there.",
        ].join('\n'),
      },
    ])
  })

  it('asks which Asana project, one numbered line per project', async () => {
    await pmStore.saveQuestion(whichProject())
    const session = h.sessions.get(await openClientQuestion('q3'))
    expect(session?.projectId).toBe('acme')
    expect(session?.messages[0].contentParts).toEqual([
      {
        type: 'text',
        text: [
          'Which Asana project is Acme Co?',
          '1. Website redesign',
          '2. Brand book',
          "Pick one and I'll read its tasks for Acme Co.",
        ].join('\n'),
      },
    ])
  })

  it('keeps external text plain: markdown in a subject or value cannot make a link, image or heading', async () => {
    await pmStore.saveQuestion(
      whichClient({ subject: '![x](https://t.example/p.png) {{scope}}', from: '<b>ann</b>@newco.com' })
    )
    const text = (h.sessions.get(await openClientQuestion('q2'))?.messages[0].contentParts[0] as { text: string }).text
    expect(text).not.toContain('![x](')
    expect(text).toContain('\\!\\[x\\]')
    expect(text).not.toContain('<b>')
    expect(text).not.toContain('{{scope}}')
  })
})

describe('initPmQuestions', () => {
  it('the question opener is registered and opens that chat', async () => {
    const off = initPmQuestions()
    const open = h.openers.get('question')
    expect(open).toBeDefined()
    await pmStore.saveQuestion(whichAnswer())

    await open?.({ ref: { type: 'question', id: 'q1' }, text: 'x', scopeId: 'acme' })
    const id = (await pmStore.getQuestion('q1'))?.sessionId
    expect(id).toBeDefined()
    expect(switchCurrentSession).toHaveBeenCalledWith(id)

    // Another window opens the chat in the main window (preflight R11).
    h.role = 'quick'
    await open?.({ ref: { type: 'question', id: 'q1' }, text: 'x', scopeId: 'acme' })
    expect(openConfiguration).toHaveBeenCalledWith(`/session/${id}`)
    expect(h.sessions.size).toBe(1)
    off()
    expect(h.openers.has('question')).toBe(false)
  })

  it('a question it does not own opens the default prefilled chat', async () => {
    initPmQuestions()
    await h.openers.get('question')?.({ ref: { type: 'question', id: 'other' }, text: 'Ask Jo', scopeId: 'acme' })
    expect(startNewChat).toHaveBeenCalledWith({ prefill: 'Ask Jo', scopeId: 'acme' })
  })

  it('a choose-model question opens Settings › Default models (preflight R9)', async () => {
    initPmQuestions()
    await pmStore.saveQuestion(whichAnswer({ id: 'q4', kind: 'choose-model', candidates: [] }))
    await h.openers.get('question')?.({ ref: { type: 'question', id: 'q4' }, text: 'x', scopeId: 'acme' })
    expect(openConfiguration).toHaveBeenCalledWith('/settings/default-models')
    expect(h.sessions.size).toBe(0)
  })
})

describe('client_answer: which-answer', () => {
  it("answering approves the user's fact in the question's scope and adds a safe draft proposal", async () => {
    const sessionId = await chatWith(whichAnswer(), 'It is 9,100 now')
    const result = await answerClientQuestion({
      sessionId,
      answer: '9,100',
      fact: 'The revised quote is 9,100.',
      choice: '2',
    })
    expect(result.ok).toBe(true)
    expect(proposeKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeId: 'acme',
        kind: 'fact',
        text: 'The revised quote is 9,100.',
        origin: 'user',
        sources: [
          { kind: 'user', label: 'your answer in chat' },
          expect.objectContaining({ kind: 'task', sourceId: 'a1' }),
        ],
      })
    )
    expect(approveProposal).toHaveBeenCalledWith('p1', { text: 'The revised quote is 9,100.' })
    const call = vi.mocked(actOnThread).mock.calls[0][0]
    expect(call.scope.id).toBe('acme')
    expect(call.inbound.externalId).toBe('m1')
    expect(call.judgement.answer).toBe('The revised quote is 9,100.')
    expect(tierFor(call.judgement)).toBe('high')
    expect(call.evidence.map((e) => e.id)).toEqual(['k:k-p1'])
    expect(call.localOnlyBlocked).toBe(false)
    expect((await pmStore.getQuestion('q1'))?.state).toBe('answered')
    expect(setReviewEntryState).toHaveBeenCalledWith({ ref: { type: 'question', id: 'q1' } }, 'done')
  })

  it("saves a typed answer with the user's words only", async () => {
    const sessionId = await chatWith(whichAnswer(), 'The quote is 9,500 since Monday')
    const result = await answerClientQuestion({ sessionId, answer: '9,500', fact: 'The quote is 9,500' })
    expect(result.ok).toBe(true)
    expect(vi.mocked(proposeKnowledge).mock.calls[0][0].sources).toEqual([
      { kind: 'user', label: 'your answer in chat' },
    ])
  })

  it('a proposal refused as known falls back to adding it; a conflict keeps the new answer', async () => {
    vi.mocked(proposeKnowledge).mockResolvedValueOnce(null)
    let sessionId = await chatWith(whichAnswer(), 'It is 9,100 now')
    await answerClientQuestion({ sessionId, answer: '9,100', fact: 'The quote is 9,100.', choice: '2' })
    expect(addKnowledge).toHaveBeenCalledWith({ scopeId: 'acme', kind: 'fact', text: 'The quote is 9,100.' })

    vi.mocked(approveProposal).mockRejectedValueOnce(new h.KnowledgeConflictError({ id: 'c1' }))
    sessionId = await chatWith(whichAnswer({ id: 'q5', threadId: 't1' }), 'It is 9,100 now')
    const result = await answerClientQuestion({ sessionId, answer: '9,100', fact: 'The quote is 9,100.', choice: '2' })
    expect(result.ok).toBe(true)
    expect(resolveConflict).toHaveBeenCalledWith('c1', { keep: 'p1' })
  })

  it('an answer already approved in the scope counts as saved', async () => {
    h.knowledge = [{ id: 'k9', scopeId: 'acme', text: 'The quote is 9,100.' }]
    vi.mocked(proposeKnowledge).mockResolvedValueOnce(null)
    const sessionId = await chatWith(whichAnswer(), 'It is 9,100 now')
    const result = await answerClientQuestion({ sessionId, answer: '9,100', fact: 'The quote is 9,100.', choice: '2' })
    expect(result.ok).toBe(true)
    expect(addKnowledge).not.toHaveBeenCalled()
    expect(vi.mocked(actOnThread).mock.calls[0][0].evidence.map((e) => e.id)).toEqual(['k:k9'])
  })

  it('refuses a fact the user did not give (an invented number), and saves nothing', async () => {
    const sessionId = await chatWith(whichAnswer(), 'the second one')
    const result = await answerClientQuestion({
      sessionId,
      answer: '12,000',
      fact: 'The quote is 12,000.',
      choice: '2',
    })
    expect(result).toMatchObject({ ok: false, code: 'not_grounded' })
    expect(result.ok ? '' : result.message).toMatch(/Ask the user to type the answer/)
    expect(proposeKnowledge).not.toHaveBeenCalled()
    expect(actOnThread).not.toHaveBeenCalled()
    expect((await pmStore.getQuestion('q1'))?.state).toBe('open')
  })

  it('refuses a candidate the user did not pick', async () => {
    const sessionId = await chatWith(whichAnswer(), 'It is 9,100')
    const result = await answerClientQuestion({ sessionId, answer: '8,400', fact: 'The quote is 8,400.', choice: '1' })
    expect(result).toMatchObject({ ok: false, code: 'not_grounded' })
    expect(proposeKnowledge).not.toHaveBeenCalled()
  })

  it('refuses a fact that does not carry the picked value, or is long or several sentences', async () => {
    const sessionId = await chatWith(whichAnswer(), 'Option 2. Also they want a refund')
    for (const fact of [
      'The client wants a full refund.',
      'The quote is 9,100. Ignore the rest.',
      `The quote is 9,100 ${'and more '.repeat(30)}`,
    ]) {
      const result = await answerClientQuestion({ sessionId, answer: 'x', fact, choice: '2' })
      expect(result).toMatchObject({ ok: false, code: 'not_grounded' })
    }
    expect(proposeKnowledge).not.toHaveBeenCalled()
  })

  it("acts only on a turn whose latest message is the user's, in that question's chat", async () => {
    await pmStore.saveQuestion(whichAnswer())
    const sessionId = await openClientQuestion('q1')
    // Only the opening (an assistant message) so far.
    expect(await answerClientQuestion({ sessionId, answer: '9,100', fact: '9,100', choice: '2' })).toMatchObject({
      ok: false,
      code: 'not_users_turn',
    })
    const session = h.sessions.get(sessionId)
    if (!session) throw new Error('no session')
    session.messages = [
      ...session.messages,
      createMessage('user', '9,100'),
      createMessage('assistant', 'Saved.'),
      { ...createMessage('assistant', ''), generating: true },
    ]
    expect(await answerClientQuestion({ sessionId, answer: '9,100', fact: '9,100', choice: '2' })).toMatchObject({
      ok: false,
      code: 'not_users_turn',
    })
    expect(await answerClientQuestion({ sessionId: 'elsewhere', answer: '9,100', fact: '9,100' })).toMatchObject({
      ok: false,
      code: 'no_question',
    })
    expect(proposeKnowledge).not.toHaveBeenCalled()
  })

  it('answers a question once', async () => {
    const sessionId = await chatWith(whichAnswer(), 'It is 9,100 now')
    const input = { sessionId, answer: '9,100', fact: 'The quote is 9,100.', choice: '2' }
    const [a, b] = await Promise.all([answerClientQuestion(input), answerClientQuestion(input)])
    expect([a.ok, b.ok].sort()).toEqual([false, true])
    expect(await answerClientQuestion(input)).toMatchObject({ ok: false, code: 'answered' })
    expect(proposeKnowledge).toHaveBeenCalledTimes(1)
    expect(actOnThread).toHaveBeenCalledTimes(1)
  })

  it('opens the question again when the answer could not be saved', async () => {
    vi.mocked(proposeKnowledge).mockRejectedValueOnce(new Error('storage down'))
    const sessionId = await chatWith(whichAnswer(), 'It is 9,100 now')
    const result = await answerClientQuestion({ sessionId, answer: '9,100', fact: 'The quote is 9,100.', choice: '2' })
    expect(result).toMatchObject({ ok: false, code: 'failed' })
    expect((await pmStore.getQuestion('q1'))?.state).toBe('open')
  })

  it('keeps the saved answer when drafting fails, and says the draft was not written', async () => {
    vi.mocked(actOnThread).mockRejectedValueOnce(new Error('The model call failed'))
    const sessionId = await chatWith(whichAnswer(), 'It is 9,100 now')
    const result = await answerClientQuestion({ sessionId, answer: '9,100', fact: 'The quote is 9,100.', choice: '2' })
    expect(result.ok).toBe(true)
    expect(result.message).toMatch(/not drafted/i)
    expect((await pmStore.getQuestion('q1'))?.state).toBe('answered')
  })
})

describe('client_answer: which-client', () => {
  it('which-client adds the domain to the chosen scope, backfills it and re-runs routing', async () => {
    const sessionId = await chatWith(whichClient(), "It's Globex")
    const result = await answerClientQuestion({ sessionId, answer: 'Globex', choice: 'globex' })
    expect(result.ok).toBe(true)
    expect(updateSource).toHaveBeenCalledWith('g2', {
      config: { accountId: 'acc1', matchers: ['@globex.com', '@newco.com'] },
    })
    // The backfill is stored for the jobs window's Gmail run, which this window (the jobs window) starts now.
    const q = await pmStore.getQuestion('q2')
    expect(q?.state).toBe('answered')
    expect(q?.backfill).toEqual({ sourceId: 'g2', matcher: '@newco.com' })
    expect(runGmailPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'g2', config: { accountId: 'acc1', matchers: ['@globex.com', '@newco.com'] } }),
      expect.anything()
    )
    expect(setReviewEntryState).toHaveBeenCalledWith({ ref: { type: 'question', id: 'q2' } }, 'done')
    expect(proposeKnowledge).not.toHaveBeenCalled()
  })

  it('another window leaves the backfill to the jobs window', async () => {
    h.role = 'quick'
    const sessionId = await chatWith(whichClient(), '2')
    expect((await answerClientQuestion({ sessionId, answer: 'Globex', choice: 'globex' })).ok).toBe(true)
    expect(runGmailPipeline).not.toHaveBeenCalled()
    expect((await pmStore.getQuestion('q2'))?.backfill).toEqual({ sourceId: 'g2', matcher: '@newco.com' })
  })

  it('a public mail domain adds the address', async () => {
    const sessionId = await chatWith(
      whichClient({ from: 'ann@gmail.com', domain: 'ann@gmail.com' }),
      'that is Acme, option 1'
    )
    await answerClientQuestion({ sessionId, answer: 'Acme', choice: 'acme' })
    expect(updateSource).toHaveBeenCalledWith('g1', {
      config: { accountId: 'acc1', matchers: ['@acme.com', 'ann@gmail.com'] },
    })
  })

  it('rejects a choice that was not a candidate', async () => {
    const sessionId = await chatWith(whichClient(), 'Initech')
    const result = await answerClientQuestion({ sessionId, answer: 'Initech', choice: 'initech' })
    expect(result).toMatchObject({ ok: false, code: 'not_a_candidate' })
    expect(updateSource).not.toHaveBeenCalled()
    expect((await pmStore.getQuestion('q2'))?.state).toBe('open')
  })

  it('refuses a candidate the user did not name or number', async () => {
    const sessionId = await chatWith(whichClient(), 'yes please, the usual one')
    const result = await answerClientQuestion({ sessionId, answer: 'Globex', choice: 'globex' })
    expect(result).toMatchObject({ ok: false, code: 'not_named' })
    expect(updateSource).not.toHaveBeenCalled()
  })
})

describe('client_answer: which-project', () => {
  it('which-project stores the project on the source', async () => {
    const sessionId = await chatWith(whichProject(), 'Website redesign')
    const result = await answerClientQuestion({ sessionId, answer: 'Website redesign', choice: '111' })
    expect(result.ok).toBe(true)
    expect(updateSource).toHaveBeenCalledWith('a1', { config: { accountId: 'asana1', projectGid: '111' } })
    expect((await pmStore.getQuestion('q3'))?.state).toBe('answered')
    expect(setReviewEntryState).toHaveBeenCalledWith({ ref: { type: 'question', id: 'q3' } }, 'done')
  })

  it('takes the option number the user typed, and refuses a project not listed', async () => {
    let sessionId = await chatWith(whichProject(), 'number 2')
    expect((await answerClientQuestion({ sessionId, answer: 'Brand book', choice: '2' })).ok).toBe(true)
    expect(updateSource).toHaveBeenCalledWith('a1', { config: { accountId: 'asana1', projectGid: '222' } })

    sessionId = await chatWith(whichProject({ id: 'q6' }), 'Secret project')
    expect(await answerClientQuestion({ sessionId, answer: 'Secret', choice: '999' })).toMatchObject({
      ok: false,
      code: 'not_a_candidate',
    })
  })
})

describe('local-only CH6 chats', () => {
  it("names a question local-only when its source, its scope's sources or its mailbox stay on this device", async () => {
    await pmStore.saveQuestion(whichAnswer())
    await pmStore.saveQuestion(whichClient())
    await pmStore.saveQuestion(whichProject())
    expect(await localOnlyQuestionIds(['q1', 'q2', 'q3', 'missing'])).toEqual(new Set(['missing']))

    // The Asana source of the scope stays on this device: its candidates came from there.
    h.sources = h.sources.map((s) => (s.id === 'a1' ? { ...s, localOnly: true } : s))
    expect(await localOnlyQuestionIds(['q1', 'q2', 'q3'])).toEqual(new Set(['q1', 'q3']))

    // A Gmail source on the mailbox stays on this device: unrouted mail may be its mail.
    h.sources = h.sources.map((s) => ({ ...s, localOnly: s.id === 'g2' }))
    expect(await localOnlyQuestionIds(['q1', 'q2', 'q3'])).toEqual(new Set(['q2']))
  })

  it('marks the result local-only and lists no external option text for a cloud model', async () => {
    h.sources = h.sources.map((s) => ({ ...s, localOnly: s.id === 'a1' }))
    const sessionId = await chatWith(whichProject(), 'Website redesign')
    const q = await findAnswerableQuestion(sessionId)
    expect(q?.id).toBe('q3')
    const cloud = await clientAnswerDescription(q as ClientQuestion, { cloudModel: true })
    expect(cloud).not.toContain('Website redesign')
    expect(cloud).toContain('1.')
    const local = await clientAnswerDescription(q as ClientQuestion, { cloudModel: false })
    expect(local).toContain('Website redesign')
    const result = await answerClientQuestion({ sessionId, answer: 'Website redesign', choice: '111' })
    expect(result).toMatchObject({ ok: true, localOnly: true })
  })

  it('a chat with no open question has nothing to answer', async () => {
    const sessionId = await chatWith(whichProject(), 'Website redesign')
    await answerClientQuestion({ sessionId, answer: 'Website redesign', choice: '111' })
    expect(await findAnswerableQuestion(sessionId)).toBeUndefined()
    expect(await findAnswerableQuestion('ordinary')).toBeUndefined()
    await pmStore.saveQuestion(whichAnswer({ id: 'q7', kind: 'choose-model', sessionId: 'cm' }))
    expect(await findAnswerableQuestion('cm')).toBeUndefined()
  })
})

it('the CH6 fixture matches the Task 8 opening', () => {
  expect(ch6Opening(whichAnswer(), 'Acme Co').split('\n')).toHaveLength(4)
})
