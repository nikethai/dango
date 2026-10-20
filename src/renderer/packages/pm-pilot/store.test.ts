import {
  type ClientDraft,
  type ClientQuestion,
  DAILY_DRAFT_CAP,
  recordId,
  type SourceRecord,
  type SyncCursor,
} from '@shared/pm-pilot'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import platform from '@/platform'
import storage, { StorageKey } from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import {
  _resetPmStoreForTests,
  DRAFT_WRITE_STALE_MS,
  PmRecordError,
  PmStoreUnreadableError,
  PROCESSED_PER_ACCOUNT,
  pmStore,
} from './store'

function rec(over: Partial<SourceRecord> & { externalId: string }): SourceRecord {
  return {
    id: recordId(over.sourceKind ?? 'gmail', over.externalId),
    sourceKind: 'gmail',
    sourceId: 'src-gmail',
    accountId: 'acc1',
    threadOrTaskId: 't1',
    scopeId: 'acme',
    author: 'jo@acme.com',
    participants: ['jo@acme.com'],
    occurredAt: 1000,
    title: 'Quote',
    text: 'Hi',
    sentByMe: false,
    noise: false,
    link: { label: 'Gmail thread "Quote"', url: 'https://mail.google.com/mail/#all/t1' },
    ...over,
  }
}

function asana(over: Partial<SourceRecord> & { externalId: string }): SourceRecord {
  return rec({ sourceKind: 'asana', author: 'Jo', participants: [], ...over })
}

function draft(over: Partial<ClientDraft> = {}): ClientDraft {
  return {
    id: 'd1',
    scopeId: 'acme',
    accountId: 'acc1',
    threadId: 't1',
    inboundMessageId: 'm1',
    to: 'jo@acme.com',
    subject: 'Quote',
    text: 'Hello',
    answer: '42',
    evidence: [],
    state: 'proposed',
    createdAt: 1000,
    ...over,
  }
}

function question(over: Partial<ClientQuestion> = {}): ClientQuestion {
  return {
    id: 'q1',
    kind: 'which-client',
    scopeId: null,
    accountId: 'acc1',
    threadId: 't9',
    subject: 'Hello',
    from: 'ann@newco.com',
    summary: '',
    candidates: [],
    domain: 'newco.com',
    state: 'open',
    createdAt: 1000,
    ...over,
  }
}

async function clearStorage() {
  for (const key of await platform.getAllStoreKeys()) await platform.delStoreValue(key)
}

/** A new window: in-memory state gone, pending debounced writes flushed first. */
async function reload() {
  await vi.advanceTimersByTimeAsync(5000)
  _resetPmStoreForTests()
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  await clearStorage()
  _resetPmStoreForTests()
})

afterEach(async () => {
  await vi.advanceTimersByTimeAsync(5000)
  vi.useRealTimers()
})

describe('pmStore records', () => {
  it('upserting the same id twice keeps one record', async () => {
    await pmStore.upsertRecords([rec({ externalId: 'm1', text: 'first' })])
    await pmStore.upsertRecords([rec({ externalId: 'm1', text: 'second' })])
    await pmStore.upsertRecords([rec({ externalId: 'm1', text: 'second' })])
    const records = await pmStore.getRecords('acme')
    expect(records).toHaveLength(1)
    expect(records[0].text).toBe('second')
  })

  it('refuses records without a scope', async () => {
    await expect(
      pmStore.upsertRecords([rec({ externalId: 'm1' }), rec({ externalId: 'm2', scopeId: null })])
    ).rejects.toThrow()
    expect(await pmStore.getRecords('acme')).toEqual([])
  })

  it('a refusal is a PmRecordError and writes nothing', async () => {
    const error = await pmStore
      .upsertRecords([rec({ externalId: 'm1' }), rec({ externalId: 'm2', scopeId: null })])
      .catch((e) => e)
    expect(error).toBeInstanceOf(PmRecordError)
    const missingSource = await pmStore.upsertRecords([rec({ externalId: 'm3', sourceId: null })]).catch((e) => e)
    expect(missingSource).toBeInstanceOf(PmRecordError)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await platform.getAllStoreKeys()).not.toContain(StorageKeyGenerator.pmRecords('acme'))
  })

  it('an unchanged upsert writes nothing', async () => {
    await pmStore.upsertRecords([rec({ externalId: 'm1' })])
    await vi.advanceTimersByTimeAsync(5000)
    const write = vi.spyOn(platform, 'setStoreValue')
    try {
      await pmStore.upsertRecords([rec({ externalId: 'm1' })])
      await vi.advanceTimersByTimeAsync(5000)
      expect(write).not.toHaveBeenCalled()
    } finally {
      write.mockRestore()
    }
  })

  it('setCursor writes pending records first, so a quit right after keeps them', async () => {
    await pmStore.upsertRecords([rec({ externalId: 'm1' })])
    await pmStore.setCursor({ accountId: 'acc1', sourceKind: 'gmail', scope: 'mailbox', value: 'h2', updatedAt: 1 })
    // No timers advanced: the debounced write has not run, as after a quit.
    expect(await platform.getStoreValue(StorageKeyGenerator.pmRecords('acme'))).toEqual([
      expect.objectContaining({ id: 'gmail:m1' }),
    ])
    _resetPmStoreForTests()
    expect((await pmStore.getRecords('acme')).map((r) => r.id)).toEqual(['gmail:m1'])
  })

  it('refuses records without a source', async () => {
    await expect(pmStore.upsertRecords([rec({ externalId: 'm1', sourceId: null })])).rejects.toThrow()
    expect(await pmStore.getRecords('acme')).toEqual([])
  })

  it('keeps one copy per source when two sources share a record id', async () => {
    await pmStore.upsertRecords([asana({ externalId: 'task1', sourceId: 'proj-a', text: 'from A' })])
    await pmStore.upsertRecords([asana({ externalId: 'task1', sourceId: 'proj-b', text: 'from B' })])
    await pmStore.upsertRecords([asana({ externalId: 'task1', sourceId: 'proj-a', text: 'from A again' })])
    const records = await pmStore.getRecords('acme')
    expect(records.map((r) => [r.sourceId, r.text]).sort()).toEqual([
      ['proj-a', 'from A again'],
      ['proj-b', 'from B'],
    ])
  })

  it('deleteRecords removes only the given source copy', async () => {
    await pmStore.upsertRecords([
      asana({ externalId: 'task1', sourceId: 'proj-a' }),
      asana({ externalId: 'task1', sourceId: 'proj-b' }),
      asana({ externalId: 'task2', sourceId: 'proj-a' }),
    ])
    await pmStore.deleteRecords('proj-a', 'asana', ['task1'])
    const records = await pmStore.getRecords('acme')
    expect(records.map((r) => `${r.sourceId}:${r.externalId}`).sort()).toEqual(['proj-a:task2', 'proj-b:task1'])
  })

  it('deleteRecordsByThread drops a task and its comments for that source only', async () => {
    await pmStore.upsertRecords([
      asana({ externalId: 'task1', threadOrTaskId: 'task1', sourceId: 'proj-a' }),
      asana({ externalId: 'c1', threadOrTaskId: 'task1', sourceId: 'proj-a' }),
      asana({ externalId: 'c2', threadOrTaskId: 'task1', sourceId: 'proj-b' }),
      asana({ externalId: 'task2', threadOrTaskId: 'task2', sourceId: 'proj-a' }),
    ])
    await pmStore.deleteRecordsByThread('proj-a', ['task1'])
    const records = await pmStore.getRecords('acme')
    expect(records.map((r) => `${r.sourceId}:${r.externalId}`).sort()).toEqual(['proj-a:task2', 'proj-b:c2'])
  })

  it('removeSourceRecords removes only that source', async () => {
    await pmStore.upsertRecords([
      rec({ externalId: 'm1', sourceId: 'g1', scopeId: 'acme' }),
      rec({ externalId: 'm2', sourceId: 'g2', scopeId: 'acme' }),
      rec({ externalId: 'm3', sourceId: 'g1', scopeId: 'beta' }),
    ])
    await reload()
    await pmStore.removeSourceRecords('g1')
    expect((await pmStore.getRecords('acme')).map((r) => r.externalId)).toEqual(['m2'])
    expect(await pmStore.getRecords('beta')).toEqual([])
  })
})

describe('pmStore cursors, processed ids, drafts and questions', () => {
  it('processed ids are capped at 5000', async () => {
    expect(PROCESSED_PER_ACCOUNT).toBe(5000)
    const ids = Array.from({ length: 5002 }, (_, i) => `m${i}`)
    await pmStore.markProcessed('acc1', ids)
    await pmStore.markProcessed('acc2', 'other')
    expect(await pmStore.isProcessed('acc1', 'm0')).toBe(false)
    expect(await pmStore.isProcessed('acc1', 'm1')).toBe(false)
    expect(await pmStore.isProcessed('acc1', 'm2')).toBe(true)
    expect(await pmStore.isProcessed('acc1', 'm5001')).toBe(true)
    expect(await pmStore.isProcessed('acc2', 'other')).toBe(true)
    expect(await pmStore.isProcessed('acc2', 'm5001')).toBe(false)
  })

  it('draft count resets at local midnight', async () => {
    const lateEvening = new Date(2026, 9, 20, 23, 59).getTime()
    const nextMorning = new Date(2026, 9, 21, 0, 1).getTime()
    expect(await pmStore.countDraftsToday(lateEvening)).toBe(0)
    await pmStore.bumpDraftsToday(lateEvening)
    expect(await pmStore.bumpDraftsToday(lateEvening)).toBe(2)
    expect(await pmStore.countDraftsToday(lateEvening)).toBe(2)
    expect(await pmStore.countDraftsToday(nextMorning)).toBe(0)
    expect(await pmStore.bumpDraftsToday(nextMorning)).toBe(1)
    expect(DAILY_DRAFT_CAP).toBe(20)
  })

  it('tryBumpDraftsToday lets exactly one of two runs past the cap', async () => {
    const now = new Date(2026, 9, 20, 12, 0).getTime()
    for (let i = 0; i < DAILY_DRAFT_CAP - 1; i++) await pmStore.bumpDraftsToday(now)
    const results = await Promise.all([
      pmStore.tryBumpDraftsToday(now, DAILY_DRAFT_CAP),
      pmStore.tryBumpDraftsToday(now, DAILY_DRAFT_CAP),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await pmStore.countDraftsToday(now)).toBe(DAILY_DRAFT_CAP)
  })

  it('a malformed stored drafts or questions value throws and is not overwritten', async () => {
    await platform.setStoreValue(StorageKey.PmDrafts, { secret: 'client words' })
    await platform.setStoreValue(StorageKey.PmQuestions, 'client words')
    const error = await pmStore.saveDraft(draft()).catch((e) => e)
    expect(error).toBeInstanceOf(PmStoreUnreadableError)
    expect(String(error.message)).not.toContain('client words')
    await expect(pmStore.getDraft('d1')).rejects.toBeInstanceOf(PmStoreUnreadableError)
    await expect(pmStore.saveQuestion(question())).rejects.toBeInstanceOf(PmStoreUnreadableError)
    await expect(pmStore.findOpenQuestion({ domain: 'newco.com' })).rejects.toBeInstanceOf(PmStoreUnreadableError)
    expect(await platform.getStoreValue(StorageKey.PmDrafts)).toEqual({ secret: 'client words' })
    expect(await platform.getStoreValue(StorageKey.PmQuestions)).toBe('client words')
  })

  it('saveDraft writes through at once', async () => {
    await pmStore.saveDraft(draft({ state: 'proposed' }))
    // No timers advanced: the draft is already in storage, so a retry after a crash sees it.
    const stored = await platform.getStoreValue(StorageKey.PmDrafts)
    expect(stored).toEqual([expect.objectContaining({ id: 'd1', state: 'proposed' })])
  })

  it('finds drafts by id and thread, and open questions by domain or thread', async () => {
    await pmStore.saveDraft(draft({ id: 'd1', threadId: 't1', createdAt: 1000 }))
    await pmStore.saveDraft(draft({ id: 'd2', threadId: 't1', createdAt: 2000 }))
    await pmStore.saveDraft(draft({ id: 'd1', threadId: 't1', createdAt: 1000, state: 'written' }))
    expect((await pmStore.getDraft('d1'))?.state).toBe('written')
    expect((await pmStore.findDraftByThread('t1'))?.id).toBe('d2')
    expect(await pmStore.findDraftByThread('nope')).toBeUndefined()
    await pmStore.saveDraft(draft({ id: 'd0', threadId: 't1', createdAt: 500 }))
    expect((await pmStore.listDraftsByThread('t1')).map((d) => d.id)).toEqual(['d0', 'd1', 'd2'])
    expect(await pmStore.listDraftsByThread('nope')).toEqual([])

    await pmStore.saveQuestion(question({ id: 'q1', domain: 'newco.com', threadId: 't9' }))
    expect((await pmStore.findOpenQuestion({ domain: 'newco.com' }))?.id).toBe('q1')
    expect((await pmStore.findOpenQuestion({ threadId: 't9' }))?.id).toBe('q1')
    await pmStore.saveQuestion(question({ id: 'q1', state: 'answered' }))
    expect(await pmStore.findOpenQuestion({ domain: 'newco.com' })).toBeUndefined()
    expect((await pmStore.getQuestion('q1'))?.state).toBe('answered')
  })

  it('state survives a reload', async () => {
    const cursor: SyncCursor = {
      accountId: 'acc1',
      sourceKind: 'gmail',
      scope: 'mailbox',
      value: 'h123',
      updatedAt: 5,
      ownAddress: 'pm@agency.com',
    }
    await pmStore.upsertRecords([rec({ externalId: 'm1' })])
    await pmStore.setCursor(cursor)
    await pmStore.markProcessed('acc1', 'm1')
    await pmStore.saveDraft(draft())
    await pmStore.saveQuestion(question())
    const now = new Date(2026, 9, 20, 12, 0).getTime()
    await pmStore.bumpDraftsToday(now)

    await reload()

    expect((await pmStore.getRecords('acme')).map((r) => r.id)).toEqual(['gmail:m1'])
    expect(await pmStore.getCursor('acc1', 'gmail', 'mailbox')).toEqual(cursor)
    expect(await pmStore.getCursor('acc1', 'asana', 'mailbox')).toBeUndefined()
    expect(await pmStore.isProcessed('acc1', 'm1')).toBe(true)
    expect((await pmStore.getDraft('d1'))?.text).toBe('Hello')
    expect((await pmStore.findOpenQuestion({ domain: 'newco.com' }))?.id).toBe('q1')
    expect(await pmStore.countDraftsToday(now)).toBe(1)
    expect(await storage.getAllKeys()).toContain(StorageKeyGenerator.pmRecords('acme'))
  })
})

describe('pmStore draft writes', () => {
  it('claims a draft once: a second claim while the write runs is in progress', async () => {
    await pmStore.saveDraft(draft())
    const [a, b] = await Promise.all([pmStore.claimDraftWrite('d1', 5000), pmStore.claimDraftWrite('d1', 5000)])
    expect([a.ok, b.ok].sort()).toEqual([false, true])
    expect(a.ok ? b : a).toEqual({ ok: false, reason: 'in-progress' })
    expect((await pmStore.getDraft('d1'))?.writeStartedAt).toBe(5000)
  })

  it('a stale marker is cleared and reported once, then the draft can be claimed', async () => {
    await pmStore.saveDraft(draft({ writeStartedAt: 1 }))
    await expect(pmStore.claimDraftWrite('d1', 1 + DRAFT_WRITE_STALE_MS)).resolves.toEqual({
      ok: false,
      reason: 'interrupted',
    })
    expect((await pmStore.getDraft('d1'))?.writeStartedAt).toBeUndefined()
    expect((await pmStore.claimDraftWrite('d1', 2 + DRAFT_WRITE_STALE_MS)).ok).toBe(true)
  })

  it('refuses written, sent and missing drafts', async () => {
    await pmStore.saveDraft(draft({ state: 'written' }))
    await expect(pmStore.claimDraftWrite('d1', 1)).resolves.toEqual({ ok: false, reason: 'written' })
    await pmStore.saveDraft(draft({ state: 'sent' }))
    await expect(pmStore.claimDraftWrite('d1', 1)).resolves.toEqual({ ok: false, reason: 'not-appliable' })
    await expect(pmStore.claimDraftWrite('nope', 1)).resolves.toEqual({ ok: false, reason: 'missing' })
  })

  it('settles only the claim that holds the marker', async () => {
    await pmStore.saveDraft(draft())
    await pmStore.claimDraftWrite('d1', 7)
    await expect(pmStore.settleDraftWrite('d1', 8, { state: 'written' })).resolves.toBe(false)
    await expect(pmStore.settleDraftWrite('d1', 7, { state: 'written', editedText: undefined })).resolves.toBe(true)
    const d = await pmStore.getDraft('d1')
    expect(d?.state).toBe('written')
    expect(d && 'writeStartedAt' in d).toBe(false)
    expect(d && 'editedText' in d).toBe(false)
  })

  it('stores an edit on an appliable draft; the body itself clears it', async () => {
    await pmStore.saveDraft(draft())
    await expect(pmStore.setDraftEdit('d1', 'Edited')).resolves.toBe(true)
    expect((await pmStore.getDraft('d1'))?.editedText).toBe('Edited')
    await pmStore.setDraftEdit('d1', 'Hello')
    expect((await pmStore.getDraft('d1'))?.editedText).toBeUndefined()
    await pmStore.saveDraft(draft({ state: 'written' }))
    await expect(pmStore.setDraftEdit('d1', 'Edited')).resolves.toBe(false)
  })
})
