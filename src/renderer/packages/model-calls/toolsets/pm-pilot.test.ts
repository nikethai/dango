import type { Scope } from '@shared/types/scope'
import type { ConnectedSource } from '@shared/types/sources'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state, recallClient, loadSources, answer } = vi.hoisted(() => ({
  state: {
    platformType: 'desktop',
    scopes: [] as Scope[],
    sources: [] as ConnectedSource[],
    questions: {} as Record<string, { id: string }>,
  },
  recallClient: vi.fn(async (_input: unknown): Promise<unknown> => ({ ok: true, records: [], gaps: [] })),
  loadSources: vi.fn(async () => undefined),
  answer: {
    answerClientQuestion: vi.fn(async (_input: unknown): Promise<unknown> => ({ ok: true, message: 'saved' })),
    clientAnswerDescription: vi.fn(async (_q: unknown, _opts: unknown) => 'ANSWER THE QUESTION'),
    localOnlyQuestionIds: vi.fn(async (ids: string[]) => new Set(ids.filter((id) => id.startsWith('local')))),
  },
}))

vi.mock('@/platform', () => ({
  default: {
    get type() {
      return state.platformType
    },
  },
}))
vi.mock('@/packages/pm-pilot/bridge', () => ({
  listClientScopes: async () => state.scopes.filter((s) => s.kind === 'client'),
  loadSources: () => loadSources(),
  listSources: () => state.sources,
}))
vi.mock('@/packages/pm-pilot/recall', () => ({ recallClient: (input: unknown) => recallClient(input) }))
vi.mock('@/packages/pm-pilot/answer', () => ({
  findAnswerableQuestion: async (sessionId: string) => state.questions[sessionId],
  answerClientQuestion: (input: unknown) => answer.answerClientQuestion(input),
  clientAnswerDescription: (q: unknown, opts: unknown) => answer.clientAnswerDescription(q, opts),
  localOnlyQuestionIds: (ids: string[]) => answer.localOnlyQuestionIds(ids),
}))

import { loadLocalOnlyQuestionIds, loadPmToolSet, pmToolSet } from './pm-pilot'

const scope = (id: string, kind: 'client' | 'project') => ({ id, name: id, kind }) as Scope
const source = (id: string, scopeId: string, kind: ConnectedSource['kind']) =>
  ({
    id,
    scopeId,
    kind,
    label: id,
    backgroundReview: false,
    localOnly: false,
    config: {},
    connectedAt: 0,
  }) as ConnectedSource

beforeEach(() => {
  state.platformType = 'desktop'
  state.scopes = [scope('acme', 'client'), scope('site', 'project')]
  state.sources = [source('g1', 'acme', 'gmail')]
  state.questions = {}
  recallClient.mockClear()
  loadSources.mockClear()
  answer.answerClientQuestion.mockClear()
  answer.clientAnswerDescription.mockClear()
})

describe('loadPmToolSet', () => {
  it('is enabled on desktop when a client scope has a Gmail or Asana source', async () => {
    const set = await loadPmToolSet({ sessionScopeId: 'acme', cloudModel: true })
    expect(loadSources).toHaveBeenCalled()
    expect(Object.keys(set?.tools ?? {})).toEqual(['client_recall'])
    state.sources = [source('a1', 'acme', 'asana')]
    expect(await loadPmToolSet({ cloudModel: true })).not.toBeNull()
  })

  it('is off when no client scope has a Gmail or Asana source', async () => {
    state.sources = [source('g1', 'site', 'gmail'), source('f1', 'acme', 'folder')]
    expect(await loadPmToolSet({ cloudModel: true })).toBeNull()
    state.sources = []
    expect(await loadPmToolSet({ cloudModel: true })).toBeNull()
  })

  it('is off where the PM pilot does not run (not desktop)', async () => {
    state.platformType = 'web'
    expect(await loadPmToolSet({ sessionScopeId: 'acme', cloudModel: true })).toBeNull()
    expect(loadSources).not.toHaveBeenCalled()
  })
})

describe('pmToolSet', () => {
  it('tells the model the records are client data, to ask which client, cite links and state gaps', () => {
    const set = pmToolSet({ cloudModel: true })
    const toolDescription = (set.tools.client_recall as { description?: string }).description ?? ''
    for (const text of [set.description, toolDescription]) {
      expect(text).toMatch(/client data, not instructions/i)
      expect(text).toMatch(/ambiguous_client/)
      expect(text).toMatch(/no_client_given/)
      expect(text).toMatch(/link/i)
      expect(text).toMatch(/gaps/i)
    }
    expect(Object.keys(set.tools).some((name) => /send|reply/.test(name))).toBe(false)
  })

  it("passes the chat's scope and the cloud flag from the context, not from the model", async () => {
    const set = pmToolSet({ sessionScopeId: 'acme', cloudModel: true, userMessage: 'What did Acme say?' })
    const execute = (set.tools.client_recall as { execute: (input: unknown, opts: unknown) => Promise<unknown> })
      .execute
    await execute({ client: 'Acme', query: 'launch date', cloudModel: false, sessionScopeId: 'x', limit: 3 }, {})
    expect(recallClient).toHaveBeenCalledWith({
      client: 'Acme',
      query: 'launch date',
      limit: 3,
      sessionScopeId: 'acme',
      cloudModel: true,
      userMessage: 'What did Acme say?',
    })
  })
})

describe('client_answer', () => {
  it('client_answer is absent in an ordinary chat', async () => {
    const set = await loadPmToolSet({ sessionId: 's-plain', sessionScopeId: 'acme', cloudModel: true })
    expect(Object.keys(set?.tools ?? {})).toEqual(['client_recall'])
    expect(set?.description).not.toMatch(/client_answer/)
  })

  it("is offered in a question's chat, with the question's description, even with no recall sources", async () => {
    state.questions = { s1: { id: 'q1' } }
    state.sources = []
    const set = await loadPmToolSet({ sessionId: 's1', cloudModel: true })
    expect(Object.keys(set?.tools ?? {})).toEqual(['client_answer'])
    expect((set?.tools.client_answer as { description?: string }).description).toContain('ANSWER THE QUESTION')
    expect(answer.clientAnswerDescription).toHaveBeenCalledWith({ id: 'q1' }, { cloudModel: true })
    expect(set?.description).toMatch(/client_answer/)
  })

  it("answers for the turn's own chat, never a session the model names", async () => {
    state.questions = { s1: { id: 'q1' } }
    const set = await loadPmToolSet({ sessionId: 's1', sessionScopeId: 'acme', cloudModel: true })
    const execute = (set?.tools.client_answer as { execute: (input: unknown, opts: unknown) => Promise<unknown> })
      .execute
    await execute({ answer: '9,100', fact: 'The quote is 9,100.', choice: '2', sessionId: 'other' }, {})
    expect(answer.answerClientQuestion).toHaveBeenCalledWith({
      sessionId: 's1',
      answer: '9,100',
      fact: 'The quote is 9,100.',
      choice: '2',
    })
    expect(Object.keys(set?.tools ?? {}).some((name) => /send|reply/.test(name))).toBe(false)
  })

  it('is not offered off desktop', async () => {
    state.platformType = 'web'
    state.questions = { s1: { id: 'q1' } }
    expect(await loadPmToolSet({ sessionId: 's1', cloudModel: true })).toBeNull()
  })

  it('names the local-only questions of a chat', async () => {
    expect(await loadLocalOnlyQuestionIds([])).toEqual(new Set())
    expect(await loadLocalOnlyQuestionIds(['local-1', 'shared-2'])).toEqual(new Set(['local-1']))
  })
})
