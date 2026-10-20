import {
  type ClientDraft,
  ClientDraftSchema,
  type ClientQuestion,
  ClientQuestionSchema,
  type PmSourceKind,
  type SourceRecord,
  SourceRecordSchema,
  type SyncCursor,
  SyncCursorSchema,
} from '@shared/pm-pilot'
import { z } from 'zod'
import { createStore } from 'zustand/vanilla'
import { createLockedQueue } from '@/lib/lockedQueue'

/*
 * The PM pilot's local state (slice 10). Device-only: none of these keys goes into a settings export.
 *
 * - Records: one document per scope (`pm:records:{scopeId}`), written debounced because 90 days of mail can be large
 *   (preflight R25). A record is keyed by its source and id: one Asana task in two synced projects is two copies, and
 *   a write or delete from one source never touches the other's. Every record change (upserts, deletes and
 *   `removeSourceRecords`) must run in the jobs window: its copy is authoritative, and a change made in another window
 *   would be written back over by the jobs window's cache. Another window calls `reloadRecords()` before reading (R24).
 *   `setCursor` flushes pending record writes first, so a cursor is never stored ahead of its records.
 * - Cursors, processed ids, drafts, questions and the daily draft count: small documents written through at once
 *   (`setItemNow`), each change a read-modify-write of the stored value under a Web Lock, so the main and jobs
 *   windows never drop each other's writes. Reads go to storage too, so a window never acts on a stale draft.
 *
 * Titles, names and mail text in records are external data; nothing here renders or interprets them.
 */

export const PROCESSED_PER_ACCOUNT = 5000

type PmState = {
  /** Scopes whose records this window has loaded. */
  records: Record<string, SourceRecord[]>
  cursors: SyncCursor[]
  drafts: ClientDraft[]
  questions: ClientQuestion[]
}

const initialState = (): PmState => ({ records: {}, cursors: [], drafts: [], questions: [] })

/** This window's view of the pilot state, updated after every read and write. */
export const pmStateStore = createStore<PmState>()(initialState)

/** A stored drafts or questions document is not a list: nothing is written over it (no stored text in the message). */
export class PmStoreUnreadableError extends Error {
  constructor(what: string) {
    super(`Stored PM ${what} could not be read`)
    this.name = 'PmStoreUnreadableError'
  }
}

export class PmRecordError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PmRecordError'
  }
}

// Lazy: `@/storage` reaches the platform when it loads.
async function getStorage() {
  const [mod, { StorageKeyGenerator }] = await Promise.all([import('@/storage'), import('@/storage/StoreStorage')])
  return { storage: mod.default, keys: mod.StorageKey, recordsKey: StorageKeyGenerator.pmRecords }
}

const RECORDS_PREFIX = 'pm:records:'

function parseList<T>(schema: z.ZodType<T>, value: unknown): T[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const parsed = schema.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}

/** Like `parseList`, but a stored value that is present and not a list throws rather than reading as empty. */
function parseStrictList<T>(schema: z.ZodType<T>, value: unknown, what: string): T[] {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) throw new PmStoreUnreadableError(what)
  return parseList(schema, value)
}

const ProcessedSchema = z.record(z.string(), z.array(z.string())).catch({})
const DraftCountSchema = z.object({ day: z.string(), count: z.number() }).catch({ day: '', count: 0 })

// ---------------------------------------------------------------------------------------------------------------------
// Records

const recordsQueue = createLockedQueue('dango:pm-records')
let recordCache = new Map<string, SourceRecord[]>()
/** Scopes whose records were changed here and may still sit in the debounced write. */
let dirtyScopes = new Set<string>()

function recordKey(r: Pick<SourceRecord, 'sourceId' | 'id'>): string {
  return `${r.sourceId}\u0000${r.id}`
}

async function loadScope(scopeId: string): Promise<SourceRecord[]> {
  const cached = recordCache.get(scopeId)
  if (cached) return cached
  const { storage, recordsKey } = await getStorage()
  const list = parseList(SourceRecordSchema, await storage.readItem(recordsKey(scopeId)))
  recordCache.set(scopeId, list)
  pmStateStore.setState((s) => ({ records: { ...s.records, [scopeId]: list } }))
  return list
}

async function writeScope(scopeId: string, list: SourceRecord[]): Promise<void> {
  recordCache.set(scopeId, list)
  dirtyScopes.add(scopeId)
  pmStateStore.setState((s) => ({ records: { ...s.records, [scopeId]: list } }))
  const { storage, recordsKey } = await getStorage()
  // Debounced: an empty list is written rather than removed, so a pending write never brings old records back.
  await storage.setItem(recordsKey(scopeId), list)
}

/**
 * Writes every scope changed here at once. `setCursor` calls it first: a cursor stored ahead of its records would
 * skip those messages for good after a quit.
 */
function flushRecords(): Promise<void> {
  return recordsQueue(async () => {
    if (dirtyScopes.size === 0) return
    const { storage, recordsKey } = await getStorage()
    for (const scopeId of [...dirtyScopes]) {
      const list = recordCache.get(scopeId)
      if (list) await storage.setItemNow(recordsKey(scopeId), list)
      dirtyScopes.delete(scopeId)
    }
  })
}

/** Every scope that may hold records: the ones loaded here and the ones in storage. */
async function knownScopeIds(): Promise<string[]> {
  const { storage } = await getStorage()
  const stored = (await storage.getAllKeys())
    .filter((k) => k.startsWith(RECORDS_PREFIX))
    .map((k) => k.slice(RECORDS_PREFIX.length))
  return [...new Set([...recordCache.keys(), ...stored])]
}

/** Drops the records `remove` picks, in every scope. */
function removeRecordsWhere(remove: (r: SourceRecord) => boolean): Promise<void> {
  return recordsQueue(async () => {
    for (const scopeId of await knownScopeIds()) {
      const list = await loadScope(scopeId)
      const kept = list.filter((r) => !remove(r))
      if (kept.length !== list.length) await writeScope(scopeId, kept)
    }
  })
}

/**
 * Adds or replaces records by source and id. Every record needs a `scopeId` and a `sourceId`; when one lacks either,
 * nothing is written and it throws `PmRecordError`. Writing the same records again changes nothing.
 */
async function upsertRecords(records: SourceRecord[]): Promise<void> {
  for (const r of records) {
    if (!r.scopeId || !r.sourceId) throw new PmRecordError('A PM record needs a scope and a source')
    if (!SourceRecordSchema.safeParse(r).success) throw new PmRecordError('A PM record is malformed')
  }
  const byScope = new Map<string, SourceRecord[]>()
  for (const r of records) byScope.set(r.scopeId as string, [...(byScope.get(r.scopeId as string) ?? []), r])
  await recordsQueue(async () => {
    for (const [scopeId, incoming] of byScope) {
      const list = await loadScope(scopeId)
      const index = new Map(list.map((r, i) => [recordKey(r), i]))
      const next = [...list]
      let changed = false
      for (const r of incoming) {
        const at = index.get(recordKey(r))
        if (at === undefined) {
          index.set(recordKey(r), next.length)
          next.push(r)
          changed = true
        } else if (JSON.stringify(next[at]) !== JSON.stringify(r)) {
          next[at] = r
          changed = true
        }
      }
      if (changed) await writeScope(scopeId, next)
    }
  })
}

/** Removes one source's records of `kind` with these external ids (another source's copies stay). */
function deleteRecords(sourceId: string, kind: PmSourceKind, externalIds: string[]): Promise<void> {
  const ids = new Set(externalIds)
  return removeRecordsWhere((r) => r.sourceId === sourceId && r.sourceKind === kind && ids.has(r.externalId))
}

/** Removes every record of one source in these threads or tasks (an Asana task deleted: the task and its comments). */
function deleteRecordsByThread(sourceId: string, threadOrTaskIds: string[]): Promise<void> {
  const ids = new Set(threadOrTaskIds)
  return removeRecordsWhere((r) => r.sourceId === sourceId && ids.has(r.threadOrTaskId))
}

function removeSourceRecords(sourceId: string): Promise<void> {
  return removeRecordsWhere((r) => r.sourceId === sourceId)
}

function getRecords(scopeId: string): Promise<SourceRecord[]> {
  return recordsQueue(async () => [...(await loadScope(scopeId))])
}

/** Forgets this window's records so the next read comes from storage (a window that does not run the sync). */
function reloadRecords(): Promise<void> {
  return recordsQueue(() => {
    recordCache = new Map()
    pmStateStore.setState({ records: {} })
    return Promise.resolve()
  })
}

// ---------------------------------------------------------------------------------------------------------------------
// Small documents

const stateQueue = createLockedQueue('dango:pm-state')

type DocKey = 'PmCursors' | 'PmDrafts' | 'PmQuestions' | 'PmProcessed' | 'PmDraftCount'

async function readDoc(key: DocKey): Promise<unknown> {
  const { storage, keys } = await getStorage()
  return storage.readItem(keys[key])
}

/** Reads the stored value, applies `fn` and writes the result at once, under the lock. */
function mutateDoc<T, R>(key: DocKey, parse: (v: unknown) => T, fn: (current: T) => { next: T; result: R }) {
  return stateQueue(async () => {
    const { storage, keys } = await getStorage()
    const { next, result } = fn(parse(await storage.readItem(keys[key])))
    await storage.setItemNow(keys[key], next)
    return { next, result }
  })
}

const parseCursors = (v: unknown) => parseList(SyncCursorSchema, v)
const parseDrafts = (v: unknown) => parseStrictList(ClientDraftSchema, v, 'drafts')
const parseQuestions = (v: unknown) => parseStrictList(ClientQuestionSchema, v, 'questions')
const parseProcessed = (v: unknown) => ProcessedSchema.parse(v ?? {})
const parseDraftCount = (v: unknown) => DraftCountSchema.parse(v ?? {})

function replaceBy<T>(list: T[], item: T, same: (a: T) => boolean): T[] {
  const at = list.findIndex(same)
  if (at < 0) return [...list, item]
  const next = [...list]
  next[at] = item
  return next
}

async function getCursor(accountId: string, kind: PmSourceKind, scope: string): Promise<SyncCursor | undefined> {
  const cursors = parseCursors(await readDoc('PmCursors'))
  pmStateStore.setState({ cursors })
  return cursors.find((c) => c.accountId === accountId && c.sourceKind === kind && c.scope === scope)
}

async function setCursor(cursor: SyncCursor): Promise<void> {
  const parsed = SyncCursorSchema.parse(cursor)
  await flushRecords()
  const { next } = await mutateDoc('PmCursors', parseCursors, (cursors) => ({
    next: replaceBy(
      cursors,
      parsed,
      (c) => c.accountId === parsed.accountId && c.sourceKind === parsed.sourceKind && c.scope === parsed.scope
    ),
    result: undefined,
  }))
  pmStateStore.setState({ cursors: next })
}

/** Remembers that the pipeline acted on these messages; keeps the newest `PROCESSED_PER_ACCOUNT` per account. */
async function markProcessed(accountId: string, messageIds: string | string[]): Promise<void> {
  const ids = [...new Set(Array.isArray(messageIds) ? messageIds : [messageIds])]
  const added = new Set(ids)
  await mutateDoc('PmProcessed', parseProcessed, (processed) => {
    const kept = (processed[accountId] ?? []).filter((id) => !added.has(id))
    return { next: { ...processed, [accountId]: [...kept, ...ids].slice(-PROCESSED_PER_ACCOUNT) }, result: undefined }
  })
}

async function isProcessed(accountId: string, messageId: string): Promise<boolean> {
  return (parseProcessed(await readDoc('PmProcessed'))[accountId] ?? []).includes(messageId)
}

/** Written through at once: a draft's state must be stored before any Gmail write is retried. */
async function saveDraft(draft: ClientDraft): Promise<void> {
  const parsed = ClientDraftSchema.parse(draft)
  const { next } = await mutateDoc('PmDrafts', parseDrafts, (drafts) => ({
    next: replaceBy(drafts, parsed, (d) => d.id === parsed.id),
    result: undefined,
  }))
  pmStateStore.setState({ drafts: next })
}

async function readDrafts(): Promise<ClientDraft[]> {
  const drafts = parseDrafts(await readDoc('PmDrafts'))
  pmStateStore.setState({ drafts })
  return drafts
}

async function getDraft(id: string): Promise<ClientDraft | undefined> {
  return (await readDrafts()).find((d) => d.id === id)
}

/** The newest draft for a Gmail thread, in any state. */
async function findDraftByThread(threadId: string): Promise<ClientDraft | undefined> {
  return (await readDrafts())
    .filter((d) => d.threadId === threadId)
    .reduce<ClientDraft | undefined>(
      (newest, d) => (!newest || d.createdAt >= newest.createdAt ? d : newest),
      undefined
    )
}

async function saveQuestion(question: ClientQuestion): Promise<void> {
  const parsed = ClientQuestionSchema.parse(question)
  const { next } = await mutateDoc('PmQuestions', parseQuestions, (questions) => ({
    next: replaceBy(questions, parsed, (q) => q.id === parsed.id),
    result: undefined,
  }))
  pmStateStore.setState({ questions: next })
}

async function readQuestions(): Promise<ClientQuestion[]> {
  const questions = parseQuestions(await readDoc('PmQuestions'))
  pmStateStore.setState({ questions })
  return questions
}

async function getQuestion(id: string): Promise<ClientQuestion | undefined> {
  return (await readQuestions()).find((q) => q.id === id)
}

/** The open question about an outside domain (or address), or about one thread. */
async function findOpenQuestion(by: { domain: string } | { threadId: string }): Promise<ClientQuestion | undefined> {
  return (await readQuestions()).find(
    (q) => q.state === 'open' && ('domain' in by ? q.domain === by.domain : q.threadId === by.threadId)
  )
}

/** The local calendar day of `now`, so the count resets at local midnight. */
function localDay(now: number): string {
  const d = new Date(now)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

async function countDraftsToday(now: number): Promise<number> {
  const stored = parseDraftCount(await readDoc('PmDraftCount'))
  return stored.day === localDay(now) ? stored.count : 0
}

/** Adds one to today's count and returns the new count. */
async function bumpDraftsToday(now: number): Promise<number> {
  const day = localDay(now)
  const { result } = await mutateDoc('PmDraftCount', parseDraftCount, (stored) => {
    const count = (stored.day === day ? stored.count : 0) + 1
    return { next: { day, count }, result: count }
  })
  return result
}

/**
 * Bumps today's count only when it is below `cap`, in one step under the lock, so two runs at `cap - 1` cannot both
 * pass. True when it bumped.
 */
async function tryBumpDraftsToday(now: number, cap: number): Promise<boolean> {
  const day = localDay(now)
  const { result } = await mutateDoc('PmDraftCount', parseDraftCount, (stored) => {
    const count = stored.day === day ? stored.count : 0
    return count < cap ? { next: { day, count: count + 1 }, result: true } : { next: stored, result: false }
  })
  return result
}

export const pmStore = {
  upsertRecords,
  deleteRecords,
  deleteRecordsByThread,
  removeSourceRecords,
  getRecords,
  reloadRecords,
  flushRecords,
  getCursor,
  setCursor,
  markProcessed,
  isProcessed,
  saveDraft,
  getDraft,
  findDraftByThread,
  saveQuestion,
  getQuestion,
  findOpenQuestion,
  countDraftsToday,
  bumpDraftsToday,
  tryBumpDraftsToday,
}

/** Forgets this window's in-memory state (storage is left as is), as a new window would start. */
export function _resetPmStoreForTests(): void {
  recordCache = new Map()
  dirtyScopes = new Set()
  pmStateStore.setState(initialState())
}
