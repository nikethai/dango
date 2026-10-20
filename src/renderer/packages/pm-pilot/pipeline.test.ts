import type { ClientQuestion, Judgement, SourceRecord, SyncCursor } from '@shared/pm-pilot'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import type { ConnectedSource } from '@shared/types/sources'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Bridge, Gmail, model calls and the store are mocked: this file tests the pipeline's decisions only.

const h = vi.hoisted(() => {
  const interpolate = (key: string, values?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ''))
  return {
    interpolate,
    sources: [] as ConnectedSource[],
    loaded: true,
    records: [] as SourceRecord[],
    cursors: [] as SyncCursor[],
    processed: new Set<string>(),
    questions: [] as ClientQuestion[],
    calls: [] as string[],
    model: null as null | { cloud: boolean; generate: () => Promise<string> },
  }
})

vi.mock('@/i18n', () => ({ default: { t: h.interpolate } }))

vi.mock('./bridge', async () => {
  const { NeedsUserError } = await import('@/packages/background/errors')
  const { JOB_FIX_LABELS } = await import('@shared/types/background')
  const scopes: Record<string, { id: string; name: string; kind: string }> = {
    acme: { id: 'acme', name: 'Acme Co', kind: 'client' },
    globex: { id: 'globex', name: 'Globex', kind: 'client' },
  }
  return {
    NeedsUserError,
    JOB_FIX_LABELS,
    EVERYWHERE_SCOPE_ID: '__everywhere__',
    gmailConfig: (s: { config: Record<string, unknown> }) => ({
      accountId: String(s.config.accountId ?? ''),
      matchers: Array.isArray(s.config.matchers) ? (s.config.matchers as string[]) : [],
    }),
    addReviewEntry: vi.fn(async (input: Record<string, unknown>) => ({ ...input, state: 'open' })),
    setReviewEntryState: vi.fn(async () => undefined),
    getScope: vi.fn(async (id: string) => scopes[id]),
    listSources: (filter?: { kind?: string }) => h.sources.filter((s) => !filter?.kind || s.kind === filter.kind),
    loadSources: vi.fn(async () => undefined),
    sourcesStore: { getState: () => ({ loaded: h.loaded, sources: h.sources }) },
    reviewStore: { getState: () => ({ loaded: true }) },
    loadReviewEntries: vi.fn(async () => undefined),
    ensureKnowledgeLoaded: vi.fn(async () => undefined),
  }
})

vi.mock('./store', () => {
  const key = (r: SourceRecord) => `${r.sourceId}|${r.id}`
  return {
    pmStore: {
      upsertRecords: vi.fn((records: SourceRecord[]) => {
        h.calls.push('upsert')
        for (const r of records) {
          const at = h.records.findIndex((x) => key(x) === key(r))
          if (at >= 0) h.records[at] = r
          else h.records.push(r)
        }
        return Promise.resolve()
      }),
      flushRecords: vi.fn(() => {
        h.calls.push('flush')
        return Promise.resolve()
      }),
      getRecords: vi.fn(async (scopeId: string) => h.records.filter((r) => r.scopeId === scopeId)),
      pruneRecords: vi.fn((kind: string, keep: ReadonlySet<string>) => {
        h.records = h.records.filter((r) => r.sourceKind !== kind || (r.sourceId !== null && keep.has(r.sourceId)))
        return Promise.resolve()
      }),
      getCursor: vi.fn(async (accountId: string, kind: string, scope: string) =>
        h.cursors.find((c) => c.accountId === accountId && c.sourceKind === kind && c.scope === scope)
      ),
      setCursor: vi.fn((c: SyncCursor) => {
        h.calls.push('cursor')
        h.cursors = [...h.cursors.filter((x) => !(x.accountId === c.accountId && x.scope === c.scope)), c]
        return Promise.resolve()
      }),
      markProcessed: vi.fn((accountId: string, ids: string | string[]) => {
        h.calls.push('processed')
        for (const id of Array.isArray(ids) ? ids : [ids]) h.processed.add(`${accountId}:${id}`)
        return Promise.resolve()
      }),
      isProcessed: vi.fn(async (accountId: string, id: string) => h.processed.has(`${accountId}:${id}`)),
      processedIds: vi.fn(
        async (accountId: string) =>
          new Set(
            [...h.processed].filter((k) => k.startsWith(`${accountId}:`)).map((k) => k.slice(accountId.length + 1))
          )
      ),
      saveQuestion: vi.fn((q: ClientQuestion) => {
        h.questions = [...h.questions.filter((x) => x.id !== q.id), q]
        return Promise.resolve()
      }),
      listPendingBackfills: vi.fn(async (accountId: string) =>
        h.questions.filter((q) => q.accountId === accountId && q.backfill !== undefined)
      ),
      bumpBackfillAttempts: vi.fn((id: string) => {
        let tries = 0
        h.questions = h.questions.map((q) => {
          if (q.id !== id || !q.backfill) return q
          tries = (q.backfill.attempts ?? 0) + 1
          return { ...q, backfill: { ...q.backfill, attempts: tries } }
        })
        return Promise.resolve(tries)
      }),
      clearBackfill: vi.fn((id: string) => {
        h.calls.push('clear-backfill')
        h.questions = h.questions.map((q) => {
          if (q.id !== id) return q
          const { backfill: _b, ...rest } = q
          return rest
        })
        return Promise.resolve()
      }),
      findOpenQuestion: vi.fn(async (by: Record<string, string>) =>
        h.questions.find(
          (q) =>
            q.state === 'open' &&
            ('domain' in by
              ? q.domain === by.domain
              : 'threadId' in by
                ? q.threadId === by.threadId
                : q.kind === by.kind && q.sourceId === by.sourceId)
        )
      ),
    },
  }
})

vi.mock('./tokens', () => ({ getFreshToken: vi.fn(async () => ({ ok: true, token: 'tok' })) }))
vi.mock('./gmail-sync', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./gmail-sync')>()
  return { ...orig, syncGmailMailbox: vi.fn() }
})
vi.mock('./background-model', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./background-model')>()
  return { errorClassName: orig.errorClassName, resolveBackgroundModel: vi.fn(async () => h.model) }
})
vi.mock('./retrieve', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./retrieve')>()
  return { LocalOnlyModelError: orig.LocalOnlyModelError, retrieveEvidence: vi.fn(async () => []) }
})
vi.mock('./judge-call', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./judge-call')>()
  return { ...orig, judgeThread: vi.fn() }
})
vi.mock('./act-call', () => ({ actOnThread: vi.fn(async () => 'drafted'), DRAFT_EMPTY: 'The model wrote no reply' }))
vi.mock('./sent-readback', () => ({ readBackSent: vi.fn(async () => undefined) }))

import { NeedsUserError } from '@/packages/background/errors'
import { actOnThread } from './act-call'
import { resolveBackgroundModel } from './background-model'
import { addReviewEntry, ensureKnowledgeLoaded, loadSources, setReviewEntryState } from './bridge'
import { GmailAuthError, GmailRateLimitError, syncGmailMailbox } from './gmail-sync'
import { JUDGE_FAILED, JUDGE_LOCAL_ONLY, JUDGE_UNREADABLE, judgeThread } from './judge-call'
import { _resetPipelineForTests, getSourceHealth, MAX_ATTEMPTS_PER_MESSAGE, runGmailPipeline } from './pipeline'
import { LocalOnlyModelError, retrieveEvidence } from './retrieve'
import { readBackSent } from './sent-readback'
import { pmStore } from './store'
import { getFreshToken } from './tokens'

const CONNECTED = 1_000_000
const OWN = 'pm@agency.com'
const CLOUD = { cloud: true, generate: async () => '' }
const LOCAL = { cloud: false, generate: async () => '' }

function source(over: Partial<ConnectedSource> = {}): ConnectedSource {
  return {
    id: 'g1',
    kind: 'gmail',
    scopeId: 'acme',
    label: OWN,
    backgroundReview: false,
    localOnly: false,
    config: { accountId: 'acc1', matchers: ['@acme.com'] },
    connectedAt: CONNECTED,
    ...over,
  }
}

let n = 0
/** One inbound message, unrouted, as the Gmail sync returns it. */
function mail(over: Partial<SourceRecord> = {}): SourceRecord {
  n += 1
  const externalId = over.externalId ?? `m${n}`
  return {
    id: `gmail:${externalId}`,
    sourceKind: 'gmail',
    sourceId: null,
    accountId: 'acc1',
    externalId,
    threadOrTaskId: over.threadOrTaskId ?? `t${n}`,
    scopeId: null,
    author: 'jo@acme.com',
    authorName: 'Jo',
    participants: ['jo@acme.com', OWN],
    occurredAt: CONNECTED + 1000 + n,
    title: 'Launch date?',
    text: 'When is the launch?',
    sentByMe: false,
    noise: false,
    link: { label: 'Gmail', url: 'https://mail.google.com/mail/#all/t' },
    ...over,
  }
}

function syncReturns(records: SourceRecord[], backfilled = false) {
  vi.mocked(syncGmailMailbox).mockResolvedValueOnce({
    records,
    backfilled,
    ownAddress: OWN,
    cursor: { accountId: 'acc1', sourceKind: 'gmail', scope: 'mailbox', value: 'h2', updatedAt: 1, ownAddress: OWN },
  })
}

const question: Judgement = {
  intent: 'question',
  summary: 'Jo asks for the launch date.',
  answer: '4 Nov',
  evidenceIds: [],
  confidence: 0.9,
  candidates: [],
}

const NOW = CONNECTED + 86_400_000
const ctx = (signal = new AbortController().signal) => ({ signal, progress: vi.fn(), now: NOW })

beforeEach(() => {
  vi.clearAllMocks()
  _resetPipelineForTests()
  h.sources = [source()]
  h.loaded = true
  h.records = []
  h.cursors = []
  h.processed = new Set()
  h.questions = []
  h.calls = []
  h.model = CLOUD
  vi.mocked(syncGmailMailbox).mockReset()
  vi.mocked(judgeThread).mockReset()
  vi.mocked(judgeThread).mockResolvedValue({ judgement: question })
  vi.mocked(actOnThread).mockReset()
  vi.mocked(actOnThread).mockResolvedValue('drafted')
  vi.mocked(getFreshToken).mockResolvedValue({ ok: true, token: 'tok' })
})

describe('runGmailPipeline', () => {
  it('backfilled mail is stored but not acted on', async () => {
    const old = Array.from({ length: 30 }, (_, i) => mail({ occurredAt: CONNECTED - 1000 * (i + 1) }))
    syncReturns(old, true)
    const out = await runGmailPipeline(source(), ctx())
    expect(h.records).toHaveLength(30)
    expect(h.records.every((r) => r.scopeId === 'acme' && r.sourceId === 'g1')).toBe(true)
    expect(judgeThread).not.toHaveBeenCalled()
    expect(actOnThread).not.toHaveBeenCalled()
    expect(out).toEqual({ summary: 'Checked 30 new emails', quiet: true })
  })

  it('saves the whole returned cursor, own address included, after the records', async () => {
    syncReturns([mail()])
    await runGmailPipeline(source(), ctx())
    expect(pmStore.setCursor).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'h2', scope: 'mailbox', ownAddress: OWN })
    )
    expect(h.calls.indexOf('upsert')).toBeLessThan(h.calls.indexOf('cursor'))
    // Processed only after acting, which comes after the cursor.
    expect(h.calls.indexOf('cursor')).toBeLessThan(h.calls.indexOf('processed'))
  })

  it('a message processed once is not judged again after a history reset', async () => {
    const m = mail({ externalId: 'm-seen' })
    h.processed.add('acc1:m-seen')
    syncReturns([m], true)
    await runGmailPipeline(source(), ctx())
    expect(h.records).toHaveLength(1)
    expect(judgeThread).not.toHaveBeenCalled()
    expect(actOnThread).not.toHaveBeenCalled()
  })

  it('acts on at most 10 threads per tick', async () => {
    syncReturns(Array.from({ length: 15 }, () => mail()))
    const first = await runGmailPipeline(source(), ctx())
    expect(judgeThread).toHaveBeenCalledTimes(10)
    expect(actOnThread).toHaveBeenCalledTimes(10)
    expect(pmStore.markProcessed).toHaveBeenCalledTimes(10)
    expect(first.quiet).toBe(false)
    // The rest wait for the next tick, read back from the stored records.
    syncReturns([])
    await runGmailPipeline(source(), ctx())
    expect(judgeThread).toHaveBeenCalledTimes(15)
    syncReturns([])
    await runGmailPipeline(source(), ctx())
    expect(judgeThread).toHaveBeenCalledTimes(15)
  })

  it('acts only on the newest inbound message, never on sent or noise mail', async () => {
    syncReturns([
      // A thread the PM answered after the client wrote.
      mail({ threadOrTaskId: 'answered', occurredAt: CONNECTED + 10 }),
      mail({ threadOrTaskId: 'answered', occurredAt: CONNECTED + 20, sentByMe: true, author: OWN }),
      // Noise in an otherwise client thread.
      mail({ threadOrTaskId: 'noisy', noise: true }),
      // Two inbound messages: only the newer one is judged.
      mail({ threadOrTaskId: 'two', externalId: 'older', occurredAt: CONNECTED + 30 }),
      mail({ threadOrTaskId: 'two', externalId: 'newer', occurredAt: CONNECTED + 40 }),
    ])
    await runGmailPipeline(source(), ctx())
    expect(actOnThread).toHaveBeenCalledTimes(1)
    expect(vi.mocked(actOnThread).mock.calls[0][0].inbound.externalId).toBe('newer')
    expect(h.processed).toEqual(new Set(['acc1:newer']))
  })

  it('marks a message processed only after actOnThread resolves', async () => {
    vi.mocked(actOnThread).mockRejectedValueOnce(new Error('network down'))
    syncReturns([mail({ externalId: 'm-fail' })])
    const run = runGmailPipeline(source(), ctx())
    await expect(run).rejects.toThrow('the model call failed')
    await expect(run).rejects.not.toBeInstanceOf(NeedsUserError)
    expect(pmStore.markProcessed).not.toHaveBeenCalled()
    // Retried on the next run, from the stored records.
    syncReturns([])
    await runGmailPipeline(source(), ctx())
    expect(actOnThread).toHaveBeenCalledTimes(2)
    expect(h.processed.has('acc1:m-fail')).toBe(true)
  })

  it('a model outage over three runs gives no message up and processes nothing', async () => {
    vi.mocked(judgeThread).mockResolvedValue({ judgement: null, error: `${JUDGE_FAILED} (TypeError)` })
    syncReturns(Array.from({ length: 5 }, () => mail()))
    for (let i = 0; i < MAX_ATTEMPTS_PER_MESSAGE + 1; i++) {
      if (i > 0) syncReturns([])
      const run = runGmailPipeline(source(), ctx())
      await expect(run).rejects.toThrow('the model call failed')
      await expect(run).rejects.not.toBeInstanceOf(NeedsUserError)
    }
    // The loop stops at the first failed call: one call per run, no message blamed, none handed over.
    expect(judgeThread).toHaveBeenCalledTimes(MAX_ATTEMPTS_PER_MESSAGE + 1)
    expect(pmStore.markProcessed).not.toHaveBeenCalled()
    expect(h.questions).toHaveLength(0)
    // Back up: every message is still acted on.
    vi.mocked(judgeThread).mockResolvedValue({ judgement: question })
    syncReturns([])
    await runGmailPipeline(source(), ctx())
    expect(actOnThread).toHaveBeenCalledTimes(5)
  })

  it('a draft call that fails is an outage too, not the message', async () => {
    vi.mocked(actOnThread).mockRejectedValue(new Error('The model call failed (APICallError)'))
    syncReturns([mail(), mail()])
    for (let i = 0; i < MAX_ATTEMPTS_PER_MESSAGE + 1; i++) {
      if (i > 0) syncReturns([])
      await expect(runGmailPipeline(source(), ctx())).rejects.toThrow('the model call failed')
    }
    expect(actOnThread).toHaveBeenCalledTimes(MAX_ATTEMPTS_PER_MESSAGE + 1)
    expect(pmStore.markProcessed).not.toHaveBeenCalled()
  })

  it(`a message that fails ${MAX_ATTEMPTS_PER_MESSAGE} times becomes one Needs you, others still go`, async () => {
    vi.mocked(judgeThread).mockImplementation(async ({ inbound }) =>
      inbound.externalId === 'poison' ? { judgement: null, error: JUDGE_UNREADABLE } : { judgement: question }
    )
    syncReturns([mail({ externalId: 'poison', title: 'Odd mail' }), mail({ externalId: 'fine' })])
    for (let i = 0; i < MAX_ATTEMPTS_PER_MESSAGE - 1; i++) {
      if (i > 0) syncReturns([])
      await expect(runGmailPipeline(source(), ctx())).rejects.toThrow('the model reply could not be read')
    }
    expect(h.processed).toEqual(new Set(['acc1:fine']))
    syncReturns([])
    const last = await runGmailPipeline(source(), ctx())
    expect(last.quiet).toBe(false)
    expect(h.processed.has('acc1:poison')).toBe(true)
    expect(h.questions).toEqual([
      expect.objectContaining({ kind: 'which-answer', sourceId: 'g1', scopeId: 'acme', subject: 'Odd mail' }),
    ])
    expect(vi.mocked(addReviewEntry).mock.calls.at(-1)?.[0]).toMatchObject({
      kind: 'needs-you',
      source: 'Gmail',
      text: "Couldn't check this email",
      sub: 'jo@acme.com · "Odd mail"',
      ref: { type: 'question', id: h.questions[0].id },
    })
    syncReturns([])
    await runGmailPipeline(source(), ctx())
    expect(addReviewEntry).toHaveBeenCalledTimes(1)
  })

  it('two unknown threads from one domain make one question', async () => {
    syncReturns([
      mail({ author: 'ann@newco.com', participants: ['ann@newco.com', OWN], title: 'Hello' }),
      mail({ author: 'bo@newco.com', participants: ['bo@newco.com', OWN], title: 'Quote' }),
    ])
    const out = await runGmailPipeline(source(), ctx())
    expect(h.questions).toHaveLength(1)
    expect(h.questions[0]).toMatchObject({
      kind: 'which-client',
      scopeId: null,
      domain: 'newco.com',
      candidates: [{ value: 'Acme Co', scopeId: 'acme' }],
    })
    expect(addReviewEntry).toHaveBeenCalledTimes(1)
    expect(vi.mocked(addReviewEntry).mock.calls[0][0]).toMatchObject({
      kind: 'needs-you',
      scopeId: EVERYWHERE_SCOPE_ID,
      text: 'Which client is this?',
      options: [{ id: 'acme', text: 'Acme Co' }],
      ref: { type: 'question', id: h.questions[0].id },
    })
    expect(h.records).toHaveLength(0)
    expect(judgeThread).not.toHaveBeenCalled()
    expect(out.quiet).toBe(false)
    // An open question for the domain is not asked again.
    syncReturns([mail({ author: 'cy@newco.com', participants: ['cy@newco.com'] })])
    await runGmailPipeline(source(), ctx())
    expect(addReviewEntry).toHaveBeenCalledTimes(1)
  })

  it('a source without matchers asks which client and acts on nothing', async () => {
    h.sources = [source({ config: { accountId: 'acc1' } })]
    syncReturns([mail()])
    await runGmailPipeline(h.sources[0], ctx())
    expect(vi.mocked(syncGmailMailbox).mock.calls[0][0].backfillQuery).toBe('')
    expect(h.questions).toEqual([expect.objectContaining({ kind: 'which-client', domain: 'acme.com' })])
    expect(judgeThread).not.toHaveBeenCalled()
    expect(actOnThread).not.toHaveBeenCalled()
  })

  it('asks nothing about mail older than the connection, or about noise', async () => {
    h.sources = [source({ config: { accountId: 'acc1' } })]
    syncReturns([mail({ occurredAt: CONNECTED - 5 }), mail({ author: 'news@shop.com', noise: true })], true)
    await runGmailPipeline(h.sources[0], ctx())
    expect(h.questions).toHaveLength(0)
  })

  it('local-only source on a cloud model makes one Needs you and no model call', async () => {
    h.sources = [source({ localOnly: true })]
    syncReturns([mail(), mail(), mail()])
    const out = await runGmailPipeline(h.sources[0], ctx())
    expect(retrieveEvidence).not.toHaveBeenCalled()
    expect(judgeThread).not.toHaveBeenCalled()
    expect(actOnThread).not.toHaveBeenCalled()
    expect(h.questions).toEqual([expect.objectContaining({ kind: 'choose-model', sourceId: 'g1', scopeId: 'acme' })])
    expect(vi.mocked(addReviewEntry).mock.calls[0][0]).toMatchObject({
      kind: 'needs-you',
      text: 'Acme Co Gmail stays on this device. Choose a local model to draft replies.',
      actionLabel: 'Choose a model',
    })
    expect(out.quiet).toBe(false)
    syncReturns([mail()])
    await runGmailPipeline(h.sources[0], ctx())
    expect(addReviewEntry).toHaveBeenCalledTimes(1)
    expect(pmStore.markProcessed).not.toHaveBeenCalled()

    // A local model now: the waiting mail is acted on and the question closes.
    h.model = LOCAL
    syncReturns([])
    await runGmailPipeline(h.sources[0], ctx())
    expect(judgeThread).toHaveBeenCalledTimes(4)
    expect(setReviewEntryState).toHaveBeenCalledWith({ ref: { type: 'question', id: h.questions[0].id } }, 'done')
    expect(h.questions[0].state).toBe('answered')
  })

  it('a local-only refusal on a source that is not local-only is handed over once, not re-judged', async () => {
    vi.mocked(actOnThread).mockRejectedValueOnce(new LocalOnlyModelError())
    syncReturns([mail({ externalId: 'm1x' })])
    await expect(runGmailPipeline(source(), ctx())).resolves.toMatchObject({ quiet: false })
    expect(h.questions).toEqual([expect.objectContaining({ kind: 'which-answer', threadId: expect.any(String) })])
    expect(h.questions.some((q) => q.kind === 'choose-model')).toBe(false)
    expect(h.processed.has('acc1:m1x')).toBe(true)
    // The next tick neither asks again, closes anything nor calls the model.
    syncReturns([])
    await runGmailPipeline(source(), ctx())
    expect(judgeThread).toHaveBeenCalledTimes(1)
    expect(addReviewEntry).toHaveBeenCalledTimes(1)
    expect(setReviewEntryState).not.toHaveBeenCalled()
    expect(h.questions[0].state).toBe('open')
  })

  it('a local-only refusal from the judge on such a source is handed over the same way', async () => {
    vi.mocked(judgeThread).mockResolvedValueOnce({ judgement: null, error: JUDGE_LOCAL_ONLY })
    syncReturns([mail()])
    await runGmailPipeline(source(), ctx())
    expect(h.questions).toEqual([expect.objectContaining({ kind: 'which-answer' })])
    syncReturns([])
    await runGmailPipeline(source(), ctx())
    expect(judgeThread).toHaveBeenCalledTimes(1)
  })

  it('decides cloud or local once per run and passes it to retrieve, judge and draft', async () => {
    h.sources = [source(), source({ id: 'g2', scopeId: 'globex', localOnly: true, config: { accountId: 'acc1' } })]
    syncReturns([mail(), mail()])
    await runGmailPipeline(h.sources[0], ctx())
    expect(resolveBackgroundModel).toHaveBeenCalledTimes(1)
    const localOnly = new Set(['g2'])
    for (const call of vi.mocked(retrieveEvidence).mock.calls) {
      expect(call[0]).toMatchObject({ cloudModel: true, localOnlySourceIds: localOnly })
    }
    for (const call of vi.mocked(judgeThread).mock.calls) {
      expect(call[0]).toMatchObject({ model: CLOUD, localOnlySourceIds: localOnly })
    }
    for (const call of vi.mocked(actOnThread).mock.calls) {
      expect(call[0]).toMatchObject({ model: CLOUD, localOnlySourceIds: localOnly, localOnlyBlocked: false })
    }
    expect(actOnThread).toHaveBeenCalledTimes(2)
  })

  it('files a thread under the local-only source when two sources share its scope', async () => {
    h.sources = [source(), source({ id: 'g-local', localOnly: true })]
    syncReturns([mail()])
    await runGmailPipeline(h.sources[0], ctx())
    expect(h.records[0].sourceId).toBe('g-local')
  })

  it('an expired sign-in throws NeedsUserError with the reconnect fix', async () => {
    vi.mocked(getFreshToken).mockResolvedValueOnce({ ok: false, message: 'expired' })
    const run = runGmailPipeline(source(), ctx())
    await expect(run).rejects.toBeInstanceOf(NeedsUserError)
    await expect(run).rejects.toMatchObject({ reason: 'sign in again', fix: { action: 'reconnect' } })
    expect(syncGmailMailbox).not.toHaveBeenCalled()

    vi.mocked(syncGmailMailbox).mockRejectedValueOnce(new GmailAuthError('Gmail refused the sign-in', 401))
    await expect(runGmailPipeline(source(), ctx())).rejects.toMatchObject({ fix: { action: 'reconnect' } })
    expect(pmStore.setCursor).not.toHaveBeenCalled()
    expect(getSourceHealth('g1')).toEqual({ ok: false, message: 'sign in again' })
  })

  it('a rate limit is retried with translated copy and keeps the old cursor', async () => {
    vi.mocked(syncGmailMailbox).mockRejectedValueOnce(new GmailRateLimitError(429))
    const run = runGmailPipeline(source(), ctx())
    await expect(run).rejects.toThrow('Gmail is busy')
    await expect(run).rejects.not.toBeInstanceOf(NeedsUserError)
    expect(pmStore.setCursor).not.toHaveBeenCalled()
  })

  it('no usable model: records are stored, then the choose-model fix is asked for', async () => {
    h.model = null
    syncReturns([mail()])
    await expect(runGmailPipeline(source(), ctx())).rejects.toMatchObject({
      reason: 'no model is set up',
      fix: { action: 'choose-model' },
    })
    expect(h.records).toHaveLength(1)
    expect(pmStore.setCursor).toHaveBeenCalled()
    expect(judgeThread).not.toHaveBeenCalled()
  })

  it('runs one mailbox sync per account for all its sources and summarises each', async () => {
    h.sources = [
      source(),
      source({ id: 'g2', scopeId: 'globex', config: { accountId: 'acc1', matchers: ['@globex.com'] } }),
    ]
    syncReturns([
      mail(),
      mail({ author: 'li@globex.com', participants: ['li@globex.com'] }),
      mail({ author: 'mo@globex.com', participants: ['mo@globex.com'] }),
    ])
    const [a, b] = await Promise.all([runGmailPipeline(h.sources[0], ctx()), runGmailPipeline(h.sources[1], ctx())])
    expect(syncGmailMailbox).toHaveBeenCalledTimes(1)
    expect(vi.mocked(syncGmailMailbox).mock.calls[0][0].backfillQuery).toContain('@globex.com')
    expect(a.summary).toBe('Checked 1 new emails')
    expect(b.summary).toBe('Checked 2 new emails')
    expect(actOnThread).toHaveBeenCalledTimes(3)
  })

  it('a poll with nothing new is quiet, and health records the sync', async () => {
    syncReturns([])
    const out = await runGmailPipeline(source(), ctx())
    expect(out).toEqual({ summary: 'Checked 0 new emails', quiet: true })
    expect(getSourceHealth('g1')).toMatchObject({ ok: true, lastSyncAt: expect.any(Number) })
  })

  it('a judged FYI is stored and processed but stays quiet', async () => {
    vi.mocked(actOnThread).mockResolvedValueOnce('ignored')
    syncReturns([mail()])
    const out = await runGmailPipeline(source(), ctx())
    expect(out.quiet).toBe(true)
    expect(pmStore.markProcessed).toHaveBeenCalledTimes(1)
  })

  it('records of a removed source are pruned', async () => {
    h.records = [
      { ...mail(), scopeId: 'acme', sourceId: 'gone' },
      { ...mail(), scopeId: 'acme', sourceId: 'g1', occurredAt: CONNECTED - 1 },
    ]
    syncReturns([])
    await runGmailPipeline(source(), ctx())
    expect(h.records.map((r) => r.sourceId)).toEqual(['g1'])
  })

  it('never prunes while the sources cannot be read', async () => {
    h.loaded = false
    h.records = [{ ...mail(), scopeId: 'acme', sourceId: 'g1' }]
    await expect(runGmailPipeline(source(), ctx())).rejects.toThrow('sources could not be read')
    expect(pmStore.pruneRecords).not.toHaveBeenCalled()
    expect(h.records).toHaveLength(1)
  })

  it('reads back sent replies with Review and knowledge loaded', async () => {
    const sent = mail({ sentByMe: true, author: OWN, participants: [OWN, 'jo@acme.com'] })
    syncReturns([sent])
    await runGmailPipeline(source(), ctx())
    expect(ensureKnowledgeLoaded).toHaveBeenCalled()
    expect(readBackSent).toHaveBeenCalledWith(
      [expect.objectContaining({ externalId: sent.externalId, sourceId: 'g1' })],
      // The run's decision, not one of its own (M4).
      { model: CLOUD, localOnlySourceIds: new Set() }
    )
  })
})

describe('runGmailPipeline, fix round', () => {
  it('files which-client questions before the cursor moves, and a replay adds no second question', async () => {
    h.sources = [source({ config: { accountId: 'acc1' } })]
    const m = mail({ author: 'ann@newco.com', participants: ['ann@newco.com'] })
    vi.mocked(addReviewEntry).mockRejectedValueOnce(new Error('review store busy'))
    syncReturns([m])
    await expect(runGmailPipeline(h.sources[0], ctx())).rejects.toThrow()
    expect(pmStore.setCursor).not.toHaveBeenCalled()
    // The cursor did not move, so history returns the thread again: the same question, its entry added this time.
    syncReturns([m])
    await runGmailPipeline(h.sources[0], ctx())
    expect(pmStore.setCursor).toHaveBeenCalledTimes(1)
    expect(h.questions).toHaveLength(1)
    expect(pmStore.saveQuestion).toHaveBeenCalledTimes(1)
    const refs = vi.mocked(addReviewEntry).mock.calls.map((c) => (c[0] as { ref: { id: string } }).ref.id)
    expect(refs).toEqual([h.questions[0].id, h.questions[0].id])
  })

  it('reads the processed list once per run and never calls isProcessed per message', async () => {
    syncReturns(Array.from({ length: 4 }, () => mail()))
    await runGmailPipeline(source(), ctx())
    expect(pmStore.processedIds).toHaveBeenCalledTimes(1)
    expect(pmStore.isProcessed).not.toHaveBeenCalled()
  })

  it('looks back at most 90 days for mail to act on, even for a source connected long ago', async () => {
    const now = CONNECTED + 200 * 86_400_000
    syncReturns([
      mail({ externalId: 'old', occurredAt: CONNECTED + 1000 }),
      mail({ externalId: 'recent', occurredAt: now - 86_400_000 }),
    ])
    await runGmailPipeline(source(), { ...ctx(), now })
    expect(actOnThread).toHaveBeenCalledTimes(1)
    expect(vi.mocked(actOnThread).mock.calls[0][0].inbound.externalId).toBe('recent')
  })

  it('one stopped job does not stop the shared run for the other; both stopped does', async () => {
    h.sources = [source(), source({ id: 'g2', scopeId: 'globex', config: { accountId: 'acc1' } })]
    let release!: () => void
    let seen!: AbortSignal
    vi.mocked(syncGmailMailbox).mockImplementation(async (input) => {
      seen = input.signal as AbortSignal
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return {
        records: [],
        backfilled: false,
        ownAddress: OWN,
        cursor: { accountId: 'acc1', sourceKind: 'gmail', scope: 'mailbox', value: 'h2', updatedAt: 1 },
      }
    })
    const a = new AbortController()
    const b = new AbortController()
    const runA = runGmailPipeline(h.sources[0], ctx(a.signal))
    const runB = runGmailPipeline(h.sources[1], ctx(b.signal))
    await vi.waitFor(() => expect(syncGmailMailbox).toHaveBeenCalledTimes(1))
    a.abort()
    expect(seen.aborted).toBe(false)
    release()
    await expect(runB).resolves.toMatchObject({ summary: 'Checked 0 new emails' })
    await runA.catch(() => undefined)

    const c = new AbortController()
    const d = new AbortController()
    const runC = runGmailPipeline(h.sources[0], ctx(c.signal))
    const runD = runGmailPipeline(h.sources[1], ctx(d.signal))
    await vi.waitFor(() => expect(syncGmailMailbox).toHaveBeenCalledTimes(2))
    c.abort()
    expect(seen.aborted).toBe(false)
    d.abort()
    expect(seen.aborted).toBe(true)
    release()
    await Promise.allSettled([runC, runD])
  })
})

describe('a "Which client is this?" answer handed to the jobs window', () => {
  it('the next Gmail run reloads sources, backfills the answered domain, then routes and acts on the thread', async () => {
    // Answered in another window: g2's matcher and the pending backfill are in storage, not in this window yet.
    h.sources = [source(), source({ id: 'g2', scopeId: 'globex', config: { accountId: 'acc1', matchers: [] } })]
    vi.mocked(loadSources).mockImplementationOnce(() => {
      h.sources = [
        source(),
        source({ id: 'g2', scopeId: 'globex', config: { accountId: 'acc1', matchers: ['@newco.com'] } }),
      ]
      return Promise.resolve()
    })
    h.questions = [
      {
        id: 'q2',
        kind: 'which-client',
        scopeId: null,
        accountId: 'acc1',
        threadId: 't-new',
        subject: 'Hello',
        from: 'ann@newco.com',
        summary: '',
        candidates: [],
        domain: 'newco.com',
        state: 'answered',
        createdAt: 1,
        backfill: { sourceId: 'g2', matcher: '@newco.com' },
      },
    ]
    h.cursors = [
      { accountId: 'acc1', sourceKind: 'gmail', scope: 'mailbox', value: 'h1', updatedAt: 1, ownAddress: OWN },
    ]
    const asked = mail({
      externalId: 'm-new',
      threadOrTaskId: 't-new',
      author: 'ann@newco.com',
      participants: ['ann@newco.com', OWN],
    })
    syncReturns([asked], true) // the backfill
    syncReturns([]) // the poll
    await runGmailPipeline(source({ id: 'g2', scopeId: 'globex' }), ctx())
    expect(loadSources).toHaveBeenCalled()
    expect(vi.mocked(syncGmailMailbox).mock.calls[0][0]).toMatchObject({
      cursor: null,
      backfillQuery: 'from:(@newco.com) OR to:(@newco.com)',
    })
    expect(h.records.find((r) => r.externalId === 'm-new')).toMatchObject({ scopeId: 'globex', sourceId: 'g2' })
    expect(h.questions[0].backfill).toBeUndefined()
    // The thread the question was about is now client mail, and is acted on once.
    expect(actOnThread).toHaveBeenCalledTimes(1)
    expect(vi.mocked(actOnThread).mock.calls[0][0].inbound.externalId).toBe('m-new')

    // Nothing pending: the next run backfills nothing.
    syncReturns([])
    await runGmailPipeline(source(), ctx())
    expect(syncGmailMailbox).toHaveBeenCalledTimes(3)
  })

  it('a failed backfill stays pending for the next run', async () => {
    h.questions = [
      {
        id: 'q2',
        kind: 'which-client',
        scopeId: null,
        accountId: 'acc1',
        threadId: 't9',
        subject: 'Hello',
        from: 'ann@newco.com',
        summary: '',
        candidates: [],
        state: 'answered',
        createdAt: 1,
        backfill: { sourceId: 'g1', matcher: '@newco.com' },
      },
    ]
    vi.mocked(getFreshToken).mockResolvedValueOnce({ ok: false } as never)
    await expect(runGmailPipeline(source(), ctx())).rejects.toBeInstanceOf(NeedsUserError)
    expect(h.questions[0].backfill).toEqual({ sourceId: 'g1', matcher: '@newco.com' })
  })
})

describe('a backfill that keeps failing (fix round M2)', () => {
  const pending = (): ClientQuestion => ({
    id: 'q2',
    kind: 'which-client',
    scopeId: null,
    accountId: 'acc1',
    threadId: 't9',
    subject: 'Hello',
    from: 'ann@newco.com',
    summary: '',
    candidates: [],
    domain: 'newco.com',
    state: 'answered',
    createdAt: 1,
    backfill: { sourceId: 'g1', matcher: '@newco.com' },
  })

  it("does not block the account's run, and is handed to the user after three tries", async () => {
    h.questions = [pending()]
    for (let run = 1; run <= 3; run++) {
      vi.mocked(syncGmailMailbox).mockRejectedValueOnce(new Error('Gmail 500')) // the backfill
      syncReturns([mail({ externalId: `new-${run}` })]) // the poll still runs and acts
      await runGmailPipeline(source(), ctx())
      expect(vi.mocked(actOnThread).mock.calls.at(-1)?.[0].inbound.externalId).toBe(`new-${run}`)
      if (run < 3) expect(h.questions[0].backfill?.attempts).toBe(run)
    }
    expect(h.questions[0].backfill).toBeUndefined()
    expect(addReviewEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'needs-you',
        ref: { type: 'question', id: 'q2' },
        text: "Couldn't read earlier emails from this sender. New ones are filed.",
      })
    )
  })
})
