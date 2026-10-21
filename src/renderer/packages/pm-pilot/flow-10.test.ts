import type { GmailMessage, GmailThread, SyncCursor } from '@shared/pm-pilot'
import type { KnowledgeItem } from '@shared/types/knowledge'
import type { ReviewEntry } from '@shared/types/review'
import type { ConnectedSource } from '@shared/types/sources'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Flow 10 across modules (final review M3): msw Gmail, and the real pipeline, Gmail sync and write, store, act-call,
 * sent-readback and slice 5's Trust arrival. Mocked: the model (one fake answering each prompt), the sign-in token,
 * the other slices' sources, scopes and knowledge (in `./bridge`) and the undo toast.
 */

type UndoArg = { message: string; silent?: boolean; undo: () => Promise<void> }
const h = vi.hoisted(() => ({
  trust: 'auto' as string,
  sources: [] as ConnectedSource[],
  knowledge: [] as KnowledgeItem[],
  undos: [] as UndoArg[],
  proposals: [] as Array<{ text: string; scopeId: string }>,
  role: 'jobs',
}))

vi.mock('@/packages/undo', () => ({
  pushUndo: vi.fn((input: UndoArg) => {
    h.undos.push(input)
    return `undo-${h.undos.length}`
  }),
  canUndo: vi.fn(() => true),
  undoEntry: vi.fn(async () => true),
  DEFAULT_UNDO_MS: 5000,
}))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: { getState: () => ({ trustLevel: h.trust }) },
  initSettingsStore: vi.fn(async () => {}),
}))
vi.mock('@/platform/windowRole', () => ({ getWindowRole: vi.fn(async () => h.role) }))
vi.mock('./tokens', () => ({ getFreshToken: vi.fn(async () => ({ ok: true, token: 'tok' })) }))

const ACME = { id: 'acme', name: 'Acme Co', kind: 'client' }
vi.mock('./bridge', async () => {
  const review = await vi.importActual<typeof import('@/packages/review')>('@/packages/review')
  const modelCheck = await vi.importActual<typeof import('@/packages/sources/model-check')>(
    '@/packages/sources/model-check'
  )
  const { NeedsUserError } = await import('@/packages/background/errors')
  const { JOB_FIX_LABELS } = await import('@shared/types/background')
  const { EVERYWHERE_SCOPE_ID } = await import('@shared/types/scope')
  const listSources = (filter?: { kind?: string; scopeId?: string; includePending?: boolean }) =>
    h.sources.filter(
      (s) =>
        (!filter?.kind || s.kind === filter.kind) &&
        (!filter?.scopeId || s.scopeId === filter.scopeId) &&
        (filter?.includePending || s.removalPendingAt === undefined)
    )
  return {
    ...review,
    ...modelCheck,
    NeedsUserError,
    JOB_FIX_LABELS,
    EVERYWHERE_SCOPE_ID,
    NEVER_SEND_EMAIL: { id: 'never-send-email' },
    gmailConfig: (s: { config?: Record<string, unknown> }) => ({
      accountId: String(s.config?.accountId ?? ''),
      matchers: Array.isArray(s.config?.matchers) ? (s.config?.matchers as string[]) : [],
    }),
    getScope: vi.fn(async (id: string) => (id === ACME.id ? ACME : undefined)),
    listClientScopes: vi.fn(async () => [ACME]),
    isRemovalPending: (s: { removalPendingAt?: number }) => s.removalPendingAt !== undefined,
    listSources,
    loadSources: vi.fn(async () => undefined),
    sourcesStore: { getState: () => ({ loaded: true, sources: h.sources }) },
    ensureKnowledgeLoaded: vi.fn(async () => undefined),
    knowledgeForTurn: vi.fn(() => h.knowledge),
    recordKnowledgeUse: vi.fn(async () => undefined),
    proposeKnowledge: vi.fn((input: { text: string; scopeId: string }) => {
      h.proposals.push({ text: input.text, scopeId: input.scopeId })
      return Promise.resolve({ id: `p${h.proposals.length}`, ...input })
    }),
  }
})

// The model: one fake that answers the judge, the draft and the fact-diff prompts.
const REPLY = 'Hi Jo,\n\nThe launch is on 4 Nov.\n\nBest'
const generate = vi.fn((system: string, _user: string): Promise<string> => Promise.resolve(fakeModel(system)))
function fakeModel(system: string): string {
  if (system.startsWith('You help a project manager answer client email')) {
    return JSON.stringify({
      intent: 'question',
      summary: 'Jo asks for the launch date.',
      answer: 'The launch is on 4 Nov',
      evidenceIds: ['k:k1'],
      confidence: 0.95,
      candidates: [],
    })
  }
  if (system.startsWith('You write the body of a reply email')) return REPLY
  if (system.startsWith('You compare a reply')) {
    return JSON.stringify({
      changes: [{ what: 'launch date', fact: 'The launch is on 6 Nov.', draftSaid: '4 Nov', sentSaid: '6 Nov' }],
    })
  }
  throw new Error('unexpected prompt')
}
vi.mock('./background-model', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./background-model')>()
  return { ...orig, resolveBackgroundModel: vi.fn(async () => ({ cloud: true, generate })) }
})

import { reviewRegistryStore } from '@/packages/review'
import { setReviewStorageForTests } from '@/packages/review/store'
import platform from '@/platform'
import { initPmReview } from './act-call'
import { _resetPipelineForTests, runGmailPipeline } from './pipeline'
import { _resetPmStoreForTests, pmStore } from './store'

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const OWN = 'pm@agency.example'
const CONNECTED = Date.now() - 86_400_000

function b64url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function gmailMessage(
  id: string,
  over: { from: string; to: string; body: string; at: number; labels: string[] }
): GmailMessage {
  return {
    id,
    threadId: 't1',
    labelIds: over.labels,
    internalDate: String(over.at),
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: over.from },
        { name: 'To', value: over.to },
        { name: 'Subject', value: 'Launch' },
        { name: 'Message-ID', value: `<${id}@mail.example>` },
      ],
      body: { data: b64url(over.body) },
    },
  }
}

/** The mailbox Gmail holds: one thread, the drafts Dango wrote, and the history ids handed out. */
type Mailbox = {
  thread: GmailThread
  history: string[]
  drafts: Map<string, { messageId: string }>
  nextHistory: number
}
let mailbox: Mailbox
type Seen = { method: string; path: string }
let seen: Seen[] = []

function addMessage(m: GmailMessage) {
  mailbox.thread.messages = [...(mailbox.thread.messages ?? []), m]
  mailbox.history.push(m.id)
}

const server = setupServer(
  http.get(`${API}/profile`, () => HttpResponse.json({ emailAddress: OWN, historyId: String(mailbox.nextHistory) })),
  http.get(`${API}/history`, ({ request }) => {
    const start = Number(new URL(request.url).searchParams.get('startHistoryId'))
    const added = mailbox.history
      .slice(start - 1)
      .map((id) => ({ messagesAdded: [{ message: { id, threadId: 't1' } }] }))
    mailbox.nextHistory = mailbox.history.length + 1
    return HttpResponse.json({ history: added, historyId: String(mailbox.nextHistory) })
  }),
  http.get(`${API}/threads/:id`, ({ params }) =>
    params.id === 't1' ? HttpResponse.json(mailbox.thread) : new HttpResponse(null, { status: 404 })
  ),
  http.get(`${API}/labels`, () => HttpResponse.json({ labels: [{ id: 'Label_9', name: 'Dango/Draft ready' }] })),
  http.post(`${API}/threads/:id/modify`, () => HttpResponse.json({ id: 't1' })),
  http.post(`${API}/drafts`, () => {
    const id = `d${mailbox.drafts.size + 1}`
    mailbox.drafts.set(id, { messageId: `dm${mailbox.drafts.size + 1}` })
    return HttpResponse.json({ id, message: { id: mailbox.drafts.get(id)?.messageId, threadId: 't1' } })
  }),
  http.get(`${API}/drafts/:id`, ({ params }) => {
    const d = mailbox.drafts.get(String(params.id))
    return d
      ? HttpResponse.json({ id: params.id, message: { id: d.messageId, threadId: 't1' } })
      : new HttpResponse(null, { status: 404 })
  }),
  http.delete(`${API}/drafts/:id`, ({ params }) => {
    mailbox.drafts.delete(String(params.id))
    return new HttpResponse(null, { status: 204 })
  })
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

const KEY = 'review-entries'
let data: Record<string, unknown>
const entries = (): ReviewEntry[] => (data[KEY] as { entries?: ReviewEntry[] } | undefined)?.entries ?? []
const draftEntry = () => entries().find((e) => e.ref.type === 'draft') as ReviewEntry

const ctx = () => ({ signal: new AbortController().signal, progress: () => undefined })
let cleanup: () => void = () => {}

beforeEach(async () => {
  data = {}
  setReviewStorageForTests({
    getItem: <T>(k: string, f: T) => Promise.resolve((data[k] as T) ?? f),
    setItemNow: (k: string, v: unknown) => {
      data[k] = JSON.parse(JSON.stringify(v))
      return Promise.resolve()
    },
  })
  for (const key of await platform.getAllStoreKeys()) await platform.delStoreValue(key)
  _resetPmStoreForTests()
  _resetPipelineForTests()
  h.undos = []
  h.proposals = []
  h.sources = [
    {
      id: 'g1',
      kind: 'gmail',
      scopeId: 'acme',
      label: OWN,
      // The flow judges and drafts, which needs Background review on (B6).
      backgroundReview: true,
      localOnly: false,
      config: { accountId: 'acc1', matchers: ['@acme.example'] },
      connectedAt: CONNECTED,
    } as ConnectedSource,
  ]
  h.knowledge = [
    {
      id: 'k1',
      scopeId: 'acme',
      kind: 'fact',
      text: 'The launch is on 4 Nov',
      sources: [{ id: 's1', kind: 'user', label: 'you' }],
      status: 'approved',
      history: [],
      revisions: [],
      approvedRevisionId: '',
      createdAt: CONNECTED,
      updatedAt: CONNECTED,
    } as KnowledgeItem,
  ]
  generate.mockClear()
  seen = []
  server.events.removeAllListeners()
  server.events.on('request:start', ({ request }) => {
    seen.push({ method: request.method, path: new URL(request.url).pathname.replace('/gmail/v1/users/me/', '') })
  })
  // The account has synced before: the cursor is at history 1, and Jo's question arrives after the connection.
  mailbox = { thread: { id: 't1', historyId: '1', messages: [] }, history: [], drafts: new Map(), nextHistory: 1 }
  const cursor: SyncCursor = {
    accountId: 'acc1',
    sourceKind: 'gmail',
    scope: 'mailbox',
    value: '1',
    updatedAt: CONNECTED,
    ownAddress: OWN,
  }
  await pmStore.setCursor(cursor)
  addMessage(
    gmailMessage('m1', {
      from: 'Jo Lee <jo@acme.example>',
      to: OWN,
      body: 'Hi, when is the launch?',
      at: Date.now() - 60_000,
      labels: ['INBOX'],
    })
  )
  cleanup = initPmReview()
})

afterEach(() => {
  cleanup()
  setReviewStorageForTests(null)
  reviewRegistryStore.setState({ openers: {}, renderers: {} })
})

function expectNeverSent() {
  expect(seen.some((s) => /(^|\/)(send|import)(\/|$)/i.test(s.path))).toBe(false)
  expect(seen.some((s) => s.method === 'POST' && s.path === 'messages')).toBe(false)
  const allowed = new Set(['GET', 'POST', 'DELETE'])
  expect(seen.every((s) => allowed.has(s.method))).toBe(true)
}

describe('flow 10 end to end (final review M3)', () => {
  it('Trust Auto: a High message ends as a draft written in Gmail with the Done copy; Undo takes it back', async () => {
    h.trust = 'auto'
    await runGmailPipeline(h.sources[0], ctx())

    const e = draftEntry()
    expect(e).toMatchObject({ kind: 'done', state: 'done' })
    expect(e.text).toBe('Reply drafted in Gmail: The launch is on 4 Nov, per approved: The launch is on 4 Nov.')
    expect(e.sub).toBe('Draft is in the thread, not sent')
    expect(seen.filter((s) => s.method === 'POST' && s.path === 'drafts')).toHaveLength(1)
    const [draft] = await pmStore.listDraftsByThread('t1')
    expect(draft).toMatchObject({ state: 'written', gmailDraftId: 'd1', to: 'jo@acme.example' })
    expect(await pmStore.isProcessed('acc1', 'm1')).toBe(true)

    // Undo (slice 5's silent arrival undo) deletes the draft Dango wrote and turns the row back into a proposal.
    expect(h.undos).toHaveLength(1)
    expect(h.undos[0].silent).toBe(true)
    await h.undos[0].undo()
    expect(seen.some((s) => s.method === 'DELETE' && s.path === 'drafts/d1')).toBe(true)
    expect(mailbox.drafts.size).toBe(0)
    expect((await pmStore.getDraft(draft.id))?.state).toBe('undone')
    expect(draftEntry()).toMatchObject({ kind: 'proposal', state: 'open' })
    expectNeverSent()
  })

  it('Trust Ask: the High draft waits with Apply and nothing is written to Gmail', async () => {
    h.trust = 'ask'
    await runGmailPipeline(h.sources[0], ctx())

    expect(draftEntry()).toMatchObject({
      kind: 'proposal',
      state: 'open',
      risk: 'safe',
      actionLabel: 'Apply',
      text: REPLY,
    })
    expect(seen.some((s) => s.path.startsWith('drafts'))).toBe(false)
    expect((await pmStore.listDraftsByThread('t1'))[0].state).toBe('proposed')
    expect(h.undos).toHaveLength(0)
    expectNeverSent()
  })

  it('a sent reply with a changed date yields a knowledge proposal, and the draft counts as sent', async () => {
    h.trust = 'auto'
    await runGmailPipeline(h.sources[0], ctx())
    expect((await pmStore.listDraftsByThread('t1'))[0].state).toBe('written')

    // The PM changes the date and sends the reply from Gmail.
    addMessage(
      gmailMessage('m2', {
        from: OWN,
        to: 'Jo Lee <jo@acme.example>',
        body: 'Hi Jo,\n\nThe launch is on 6 Nov.\n\nBest',
        at: Date.now() + 60_000,
        labels: ['SENT'],
      })
    )
    await runGmailPipeline(h.sources[0], ctx())

    expect(h.proposals).toEqual([{ text: 'The launch is on 6 Nov.', scopeId: 'acme' }])
    expect((await pmStore.listDraftsByThread('t1'))[0].state).toBe('sent')
    // The sent reply is the PM's own answer: nothing new is drafted for the thread.
    expect(seen.filter((s) => s.method === 'POST' && s.path === 'drafts')).toHaveLength(1)
    expectNeverSent()
  })
})
