import { RETRIEVE_MAX_RECORDS, recordId, type SourceRecord } from '@shared/pm-pilot'
import type { KnowledgeItem } from '@shared/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { NEVER, knowledgeForTurn, ensureKnowledgeLoaded, getRecords } = vi.hoisted(() => ({
  NEVER: { id: 'builtin:never-send-email', text: 'Never send email' },
  knowledgeForTurn: vi.fn((_scopeId: string): KnowledgeItem[] => []),
  ensureKnowledgeLoaded: vi.fn(async (_opts?: unknown) => undefined),
  getRecords: vi.fn(async (_scopeId: string): Promise<SourceRecord[]> => []),
}))

vi.mock('./bridge', () => ({
  NEVER_SEND_EMAIL: NEVER,
  knowledgeForTurn: (scopeId: string) => knowledgeForTurn(scopeId),
  ensureKnowledgeLoaded: (opts?: unknown) => ensureKnowledgeLoaded(opts),
}))
vi.mock('./store', () => ({ pmStore: { getRecords: (scopeId: string) => getRecords(scopeId) } }))

import { LocalOnlyModelError, recordLabel, retrieveEvidence } from './retrieve'

const DAY = 24 * 60 * 60 * 1000
const SEP_12 = Date.UTC(2026, 8, 12, 12)

function rec(over: Partial<SourceRecord> & { externalId: string }): SourceRecord {
  return {
    id: recordId(over.sourceKind ?? 'gmail', over.externalId),
    sourceKind: 'gmail',
    sourceId: 'src-gmail',
    accountId: 'acc1',
    threadOrTaskId: `t-${over.externalId}`,
    scopeId: 'acme',
    author: 'jo@acme.com',
    authorName: 'Jo Bloggs',
    participants: ['jo@acme.com'],
    occurredAt: SEP_12,
    title: 'Launch',
    text: 'Hi',
    sentByMe: false,
    noise: false,
    link: { label: 'Gmail thread', url: 'https://mail.google.com/mail/#all/x' },
    ...over,
  }
}

function item(over: Partial<KnowledgeItem> & { id: string; text: string }): KnowledgeItem {
  return {
    scopeId: 'acme',
    kind: 'fact',
    sources: [{ id: 's1', kind: 'user', label: 'you' }],
    status: 'approved',
    history: [],
    revisions: [],
    approvedRevisionId: 'r1',
    createdAt: 0,
    updatedAt: SEP_12,
    ...over,
  }
}

const inbound = rec({
  externalId: 'in1',
  threadOrTaskId: 'thread-in',
  title: 'Launch date?',
  text: 'When is the website launch date for the new homepage?',
})

beforeEach(() => {
  knowledgeForTurn.mockReset().mockReturnValue([])
  ensureKnowledgeLoaded.mockClear()
  getRecords.mockReset().mockResolvedValue([])
})

describe('retrieveEvidence', () => {
  it('returns matching records from the same scope only', async () => {
    getRecords.mockResolvedValue([
      rec({ externalId: 'a', text: 'The website launch date is 12 Sep.' }),
      rec({ externalId: 'b', scopeId: 'other', text: 'The website launch date is 30 Oct.' }),
      rec({ externalId: 'c', title: 'Invoice', text: 'Invoice attached, payment due.' }),
      rec({ externalId: 'd', text: 'Homepage launch moved.', noise: true }),
    ])
    const out = await retrieveEvidence({ scopeId: 'acme', inbound, localOnlySourceIds: new Set(), cloudModel: true })
    expect(getRecords).toHaveBeenCalledWith('acme')
    expect(out.map((e) => e.id)).toEqual(['r:gmail:a'])
    expect(out[0]).toMatchObject({
      label: "Jo's 12 Sep email",
      date: SEP_12,
      text: expect.stringContaining('12 Sep'),
      source: { kind: 'email', sourceId: 'src-gmail' },
    })
  })

  it('ranks by overlap, keeps at most RETRIEVE_MAX_RECORDS and labels own mail and Asana tasks', async () => {
    const many = Array.from({ length: RETRIEVE_MAX_RECORDS + 5 }, (_, i) =>
      rec({ externalId: `m${i}`, text: 'launch', occurredAt: SEP_12 - i * DAY })
    )
    getRecords.mockResolvedValue([
      ...many,
      rec({ externalId: 'best', text: 'website launch date homepage', sentByMe: true }),
      rec({
        externalId: 'task1',
        sourceKind: 'asana',
        sourceId: 'src-asana',
        title: 'Homepage launch',
        text: 'website launch date',
        occurredAt: SEP_12 - 1000,
      }),
    ])
    const out = await retrieveEvidence({ scopeId: 'acme', inbound, localOnlySourceIds: new Set(), cloudModel: true })
    expect(out).toHaveLength(RETRIEVE_MAX_RECORDS)
    expect(out[0]).toMatchObject({ id: 'r:gmail:best', label: 'your 12 Sep email' })
    expect(out[1]).toMatchObject({
      id: 'r:asana:task1',
      label: 'Asana "Homepage launch"',
      source: { kind: 'task', sourceId: 'src-asana' },
    })
  })

  it('excludes the inbound thread', async () => {
    getRecords.mockResolvedValue([
      rec({ externalId: 'in1', threadOrTaskId: 'thread-in', text: 'website launch date' }),
      rec({ externalId: 'earlier', threadOrTaskId: 'thread-in', text: 'website launch date homepage' }),
      rec({ externalId: 'other', text: 'website launch date' }),
    ])
    const out = await retrieveEvidence({ scopeId: 'acme', inbound, localOnlySourceIds: new Set(), cloudModel: true })
    expect(out.map((e) => e.id)).toEqual(['r:gmail:other'])
  })

  it('skips local-only sources when the model is cloud', async () => {
    getRecords.mockResolvedValue([
      rec({ externalId: 'local', sourceId: 'src-local', text: 'website launch date' }),
      rec({ externalId: 'cloud', text: 'website launch date' }),
    ])
    const local = new Set(['src-local'])
    const onCloud = await retrieveEvidence({ scopeId: 'acme', inbound, localOnlySourceIds: local, cloudModel: true })
    expect(onCloud.map((e) => e.id)).toEqual(['r:gmail:cloud'])
    const onLocal = await retrieveEvidence({ scopeId: 'acme', inbound, localOnlySourceIds: local, cloudModel: false })
    expect(onLocal.map((e) => e.id).sort()).toEqual(['r:gmail:cloud', 'r:gmail:local'])
  })

  it('leaves out records of excluded sources (Background review off, B6) on any model', async () => {
    getRecords.mockResolvedValue([
      rec({ externalId: 'off', sourceId: 'src-off', text: 'website launch date' }),
      rec({ externalId: 'on', text: 'website launch date' }),
    ])
    const exclude = new Set(['src-off'])
    for (const cloudModel of [true, false]) {
      const out = await retrieveEvidence({
        scopeId: 'acme',
        inbound,
        localOnlySourceIds: new Set(),
        cloudModel,
        excludeSourceIds: exclude,
      })
      expect(out.map((e) => e.id)).toEqual(['r:gmail:on'])
    }
  })

  it('refuses when the inbound record itself is local-only and the model is cloud', async () => {
    getRecords.mockResolvedValue([rec({ externalId: 'cloud', text: 'website launch date' })])
    const localInbound = { ...inbound, sourceId: 'src-local' }
    await expect(
      retrieveEvidence({
        scopeId: 'acme',
        inbound: localInbound,
        localOnlySourceIds: new Set(['src-local']),
        cloudModel: true,
      })
    ).rejects.toBeInstanceOf(LocalOnlyModelError)
    const ok = await retrieveEvidence({
      scopeId: 'acme',
      inbound: localInbound,
      localOnlySourceIds: new Set(['src-local']),
      cloudModel: false,
    })
    expect(ok.map((e) => e.id)).toEqual(['r:gmail:cloud'])
  })

  it('includes approved knowledge with k: ids', async () => {
    knowledgeForTurn.mockReturnValue([
      NEVER as unknown as KnowledgeItem,
      item({ id: 'k1', text: 'The website launch is on 12 Sep, confirmed by the CEO in the kickoff meeting.' }),
    ])
    const out = await retrieveEvidence({ scopeId: 'acme', inbound, localOnlySourceIds: new Set(), cloudModel: true })
    expect(ensureKnowledgeLoaded).toHaveBeenCalledWith({ fresh: true })
    expect(ensureKnowledgeLoaded.mock.invocationCallOrder[0]).toBeLessThan(knowledgeForTurn.mock.invocationCallOrder[0])
    expect(knowledgeForTurn).toHaveBeenCalledWith('acme')
    expect(out.map((e) => e.id)).toEqual(['k:k1'])
    expect(out[0]).toMatchObject({
      label: 'approved: The website launch is on 12 Sep, confirm',
      text: 'The website launch is on 12 Sep, confirmed by the CEO in the kickoff meeting.',
      date: SEP_12,
    })
  })

  it('matches Vietnamese words with or without diacritics', async () => {
    getRecords.mockResolvedValue([rec({ externalId: 'vn', text: 'Báo giá cho trang chủ là 50 triệu.' })])
    const vnInbound = { ...inbound, title: 'Bao gia', text: 'Anh gửi lại báo giá trang chủ nhé' }
    const out = await retrieveEvidence({
      scopeId: 'acme',
      inbound: vnInbound,
      localOnlySourceIds: new Set(),
      cloudModel: true,
    })
    expect(out.map((e) => e.id)).toEqual(['r:gmail:vn'])
  })

  it('on a cloud model drops knowledge when any of its sources is local-only', async () => {
    knowledgeForTurn.mockReturnValue([
      item({
        id: 'mixed',
        text: 'Launch is 12 Sep.',
        sources: [
          { id: 's1', kind: 'email', label: 'a', sourceId: 'src-cloud' },
          { id: 's2', kind: 'email', label: 'b', sourceId: 'src-local' },
        ],
      }),
      item({ id: 'typed', text: 'Launch is 12 Sep.' }),
      item({
        id: 'removed-local',
        text: 'Launch is 12 Sep.',
        sources: [
          { id: 's1', kind: 'email', label: 'a', sourceId: 'src-cloud' },
          { id: 's2', kind: 'email', label: 'b', sourceId: 'src-local', removed: true },
        ],
      }),
    ])
    const local = new Set(['src-local'])
    const onCloud = await retrieveEvidence({ scopeId: 'acme', inbound, localOnlySourceIds: local, cloudModel: true })
    expect(onCloud.map((e) => e.id)).toEqual(['k:typed', 'k:removed-local'])
    const onLocal = await retrieveEvidence({ scopeId: 'acme', inbound, localOnlySourceIds: local, cloudModel: false })
    expect(onLocal.map((e) => e.id)).toEqual(['k:mixed', 'k:typed', 'k:removed-local'])
    expect(onLocal[0].sourceIds).toEqual(['src-cloud', 'src-local'])
  })

  it('on a cloud model refuses an inbound record without a source id and skips records without one', async () => {
    getRecords.mockResolvedValue([
      rec({ externalId: 'orphan', sourceId: null, text: 'website launch date' }),
      rec({ externalId: 'ok', text: 'website launch date' }),
    ])
    const orphanInbound = { ...inbound, sourceId: null }
    await expect(
      retrieveEvidence({ scopeId: 'acme', inbound: orphanInbound, localOnlySourceIds: new Set(), cloudModel: true })
    ).rejects.toBeInstanceOf(LocalOnlyModelError)
    const onCloud = await retrieveEvidence({
      scopeId: 'acme',
      inbound,
      localOnlySourceIds: new Set(),
      cloudModel: true,
    })
    expect(onCloud.map((e) => e.id)).toEqual(['r:gmail:ok'])
    const onLocal = await retrieveEvidence({
      scopeId: 'acme',
      inbound: orphanInbound,
      localOnlySourceIds: new Set(),
      cloudModel: false,
    })
    expect(onLocal.map((e) => e.id).sort()).toEqual(['r:gmail:ok', 'r:gmail:orphan'])
  })
})

describe('recordLabel', () => {
  it('shows {{ }} in a sender name or task title as written, not expanded by i18next', () => {
    const name = recordLabel(rec({ externalId: 'x', authorName: '{{date}} Bloggs' }))
    expect(name.replace(/\u200b/g, '')).toBe("{{date}}'s 12 Sep email")
    const task = recordLabel(rec({ externalId: 'y', sourceKind: 'asana', title: 'Plan {{name}}' }))
    expect(task.replace(/\u200b/g, '')).toBe('Asana "Plan {{name}}"')
  })
})
