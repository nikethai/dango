import {
  type ClientQuestion,
  type CopyFormat,
  GMAIL_BACKFILL_DAYS,
  inertValues,
  needsYouEntry,
  PIPELINE_MAX_THREADS_PER_TICK,
  type RouteResult,
  type RouteSource,
  routeThread,
  type SourceRecord,
} from '@shared/pm-pilot'
import { v4 as uuidv4 } from 'uuid'
import i18n from '@/i18n'
import { actOnThread, DRAFT_EMPTY } from './act-call'
import { type BackgroundModel, errorClassName, resolveBackgroundModel } from './background-model'
import {
  addReviewEntry,
  type ConnectedSource,
  EVERYWHERE_SCOPE_ID,
  ensureKnowledgeLoaded,
  getScope,
  gmailConfig,
  isRemovalPending,
  JOB_FIX_LABELS,
  listSources,
  loadReviewEntries,
  loadSources,
  NeedsUserError,
  reviewStore,
  type Scope,
  setReviewEntryState,
  sourcesStore,
} from './bridge'
import {
  buildMatcherQuery,
  GmailAuthError,
  GmailRateLimitError,
  GmailRequestError,
  syncGmailMailbox,
} from './gmail-sync'
import { JUDGE_LOCAL_ONLY, JUDGE_NO_MODEL, JUDGE_UNREADABLE, judgeThread } from './judge-call'
import { LocalOnlyModelError, retrieveEvidence } from './retrieve'
import { readBackSent } from './sent-readback'
import { pmStore } from './store'
import { getFreshToken } from './tokens'

/*
 * Slice 10, flow 10: the Gmail sync. One mailbox poll per account per tick, shared by that account's Gmail sources;
 * routing, storing, the sent-reply read-back, "Which client is this?" questions and acting on new client mail. Runs in
 * the jobs window only (slice 7 runs sync jobs there), so every record change happens there.
 *
 * Safety rules kept here:
 * - Nothing sends. Drafts are written only by the draft applier (`act-call`), never from here.
 * - Acts only on a thread's newest inbound message, and only when it arrived after its source was connected, is not
 *   noise, was not answered by the PM and was not processed before: a backfill (first sync or an expired history id)
 *   stores 90 days of mail and acts on none of it. A message is marked processed only after `actOnThread` resolves.
 * - The whole returned cursor (with the mailbox's own address) is saved only after the records are stored and flushed
 *   (`setCursor` flushes first); a failed run keeps the old cursor.
 * - Cloud or local is decided once per run, and the same model and local-only set go to retrieval, judge and draft.
 *   A local-only source on a cloud model gets one "choose a local model" Needs you, and no model call.
 * - Mail is only ever proposed to knowledge (slice 4), never approved here.
 * - A source with Background review off (B6) is synced and stored only: no model is resolved for it, and none of its
 *   mail is read back, judged or drafted for. Its "Which client is this?" questions and backfills (no model) stay.
 * - Logs carry fixed text and error class names, never mail text.
 */

const format: CopyFormat = (key, values) => i18n.t(key, values) as string
const t = (key: string, values?: Record<string, string | number>): string =>
  values ? i18n.t(key, values) : i18n.t(key)

// Job reasons and retry messages: English keys, translated where they are shown (the runner translates reasons).
export const SIGN_IN_AGAIN = 'sign in again'
export const NO_MODEL = 'no model is set up'
export const GMAIL_BUSY = 'Gmail is busy'
export const GMAIL_UNREACHABLE = 'Gmail could not be reached'
export const GMAIL_FAILED = 'Gmail could not be synced'
export const SOURCES_UNREADABLE = 'sources could not be read'
export const MODEL_FAILED = 'the model call failed'
export const MODEL_UNREADABLE = 'the model reply could not be read'

/** A message whose judge or draft failed this many times in this window is given up (marked processed). */
export const MAX_ATTEMPTS_PER_MESSAGE = 3

function warn(what: string, e?: unknown): void {
  const name = errorClassName(e)
  console.warn(`[pm-pilot] ${what}`, ...(name ? [name] : []))
}

/** A failure the runner retries; its message is already translated copy. */
export class PmRetryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PmRetryError'
  }
}

export function signInAgain(): NeedsUserError {
  return new NeedsUserError(SIGN_IN_AGAIN, { action: 'reconnect', label: JOB_FIX_LABELS.reconnect })
}

function noModel(): NeedsUserError {
  return new NeedsUserError(NO_MODEL, { action: 'choose-model', label: JOB_FIX_LABELS['choose-model'] })
}

export function isAbort(e: unknown, signal?: AbortSignal): boolean {
  return !!signal?.aborted || (e instanceof Error && e.name === 'AbortError')
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
}

// ---------------------------------------------------------------------------------------------------------------------
// Source health (in memory, set at the end of every sync)

export type SourceHealth = { ok: true; lastSyncAt?: number } | { ok: false; message: string }
const health = new Map<string, SourceHealth>()

export function getSourceHealth(sourceId: string): SourceHealth {
  return health.get(sourceId) ?? { ok: true }
}

export function setSourceHealth(sourceId: string, value: SourceHealth): void {
  health.set(sourceId, value)
}

/** What the user sees for a failed sync: the translated reason of a `NeedsUserError`, else the error's copy. */
export function healthMessage(e: unknown): string {
  if (e instanceof NeedsUserError) return t(e.reason)
  return e instanceof PmRetryError ? e.message : t(GMAIL_FAILED)
}

/** Gmail errors as the runner should see them: an expired sign-in needs the user, the rest is retried. */
function mapGmailError(e: unknown, signal?: AbortSignal): unknown {
  if (e instanceof NeedsUserError || e instanceof PmRetryError || isAbort(e, signal)) return e
  if (e instanceof GmailAuthError) return signInAgain()
  if (e instanceof GmailRateLimitError) return new PmRetryError(t(GMAIL_BUSY))
  if (e instanceof GmailRequestError) return new PmRetryError(t(GMAIL_UNREACHABLE))
  warn('Gmail sync failed', e)
  return new PmRetryError(t(GMAIL_FAILED))
}

// ---------------------------------------------------------------------------------------------------------------------
// Sources and routing

/**
 * Every Gmail source, read from the loaded sources store; unreadable sources are retried, never treated as none.
 * Sources pending removal (S11) are included: their records are not pruned and their mail is still filed under them,
 * so an Undo loses nothing, but nothing reviews, judges or drafts for them.
 */
async function gmailSources(): Promise<ConnectedSource[]> {
  if (!sourcesStore.getState().loaded) await loadSources()
  if (!sourcesStore.getState().loaded) throw new PmRetryError(t(SOURCES_UNREADABLE))
  return listSources({ kind: 'gmail', includePending: true })
}

/** The source was removed, or its removal started, after this run read it (S11): its mail is left alone. */
function removedSince(sourceId: string): boolean {
  const now = listSources({ includePending: true }).find((s) => s.id === sourceId)
  return !now || isRemovalPending(now)
}

/** Records of removed sources go (slice 7's revoke has no hook for slice 10). Only with the sources store loaded. */
export async function pruneRemovedSources(kind: 'gmail' | 'asana', current: ConnectedSource[]): Promise<void> {
  await pmStore.pruneRecords(kind, new Set(current.map((s) => s.id)))
}

/** Routing targets: local-only sources first, so a scope with two Gmail sources files its mail under the local one. */
function routeSourcesOf(sources: ConnectedSource[]): RouteSource[] {
  return [...sources]
    .sort((a, b) => Number(b.localOnly) - Number(a.localOnly))
    .map((s) => ({ id: s.id, scopeId: s.scopeId, config: gmailConfig(s) }))
}

type Unknown = { records: SourceRecord[]; route: Extract<RouteResult, { type: 'unknown' }> }

/** Routes each thread: records of a client thread get its scope and source; unknown threads are kept for a question. */
function routeRecords(
  records: SourceRecord[],
  sources: RouteSource[],
  ownAddress: string
): { stored: SourceRecord[]; unknown: Unknown[] } {
  const byThread = new Map<string, SourceRecord[]>()
  for (const r of records) byThread.set(r.threadOrTaskId, [...(byThread.get(r.threadOrTaskId) ?? []), r])
  const stored: SourceRecord[] = []
  const unknown: Unknown[] = []
  for (const thread of byThread.values()) {
    const route = routeThread(thread, sources, ownAddress)
    if (route.type === 'scope') {
      stored.push(...thread.map((r) => ({ ...r, scopeId: route.scopeId, sourceId: route.sourceId })))
    } else if (route.type === 'unknown') {
      unknown.push({ records: thread, route })
    }
  }
  return { stored, unknown }
}

function newestFirst(records: SourceRecord[]): SourceRecord[] {
  return [...records].sort((a, b) => b.occurredAt - a.occurredAt)
}

/** The newest message the PM did not send. */
function newestInbound(records: SourceRecord[]): SourceRecord | undefined {
  return newestFirst(records).find((r) => !r.sentByMe)
}

// ---------------------------------------------------------------------------------------------------------------------
// One account run

type SourceStats = { threads: Set<string>; notable: boolean }
type RunStats = Map<string, SourceStats>

type RunContext = {
  accountId: string
  signal: AbortSignal
  progress(text: string): void
  now: number
  stats: RunStats
  scopes: Map<string, Promise<Scope | undefined>>
  /** Decided once per run: the background model (null: none) and the sources that stay on this device. */
  model: BackgroundModel | null
  localOnly: Set<string>
  /** Gmail sources with Background review off (B6): their mail is never evidence. Decided once per run. */
  reviewOff: Set<string>
  /** The account's processed message ids, read once per run and kept up to date by this run. */
  processed: Set<string>
}

function statsFor(ctx: RunContext, sourceId: string): SourceStats {
  let s = ctx.stats.get(sourceId)
  if (!s) {
    s = { threads: new Set(), notable: false }
    ctx.stats.set(sourceId, s)
  }
  return s
}

function scopeOf(ctx: RunContext, scopeId: string): Promise<Scope | undefined> {
  let scope = ctx.scopes.get(scopeId)
  if (!scope) {
    scope = getScope(scopeId)
    ctx.scopes.set(scopeId, scope)
  }
  return scope
}

/** Failed judge or draft attempts per message in this window (`MAX_ATTEMPTS_PER_MESSAGE`). */
const attempts = new Map<string, number>()

async function runAccount(ctx: RunContext): Promise<void> {
  const { accountId, signal } = ctx
  const all = await gmailSources()
  await pruneRemovedSources('gmail', all)
  const sources = all.filter((s) => gmailConfig(s).accountId === accountId)
  if (sources.length === 0) return

  const token = await getFreshToken(accountId)
  if (!token.ok) throw signInAgain()
  throwIfAborted(signal)
  const cursor = await pmStore.getCursor(accountId, 'gmail', 'mailbox')
  ctx.progress(t('Reading Gmail…'))
  const result = await syncGmailMailbox({
    accountId,
    accessToken: token.token,
    cursor: cursor ?? null,
    backfillQuery: buildMatcherQuery(sources.flatMap((s) => gmailConfig(s).matchers)),
    now: ctx.now,
    signal,
  })
  throwIfAborted(signal)

  const { stored, unknown } = routeRecords(result.records, routeSourcesOf(sources), result.ownAddress)
  await pmStore.upsertRecords(stored)
  for (const r of stored) if (r.sourceId) statsFor(ctx, r.sourceId).threads.add(r.threadOrTaskId)

  ctx.processed = await pmStore.processedIds(accountId)

  // Questions about unknown threads before the cursor moves: those threads are not stored, so a failure after the
  // cursor would lose them. Filing is idempotent per domain, so a replay after a failed cursor save adds nothing.
  await askWhichClient(ctx, sources, unknown)
  // The whole cursor, own address included, only now: `setCursor` flushes the records above first.
  await pmStore.setCursor(result.cursor)

  // Background review off (B6): the source's mail is only synced and stored. No model is resolved for it, and its
  // mail is not read back, judged or drafted for; a "choose a local model" question left from when it was on closes.
  // A source pending removal (S11) is not reviewed either; its questions stay as they are for an Undo.
  const reviewing = sources.filter((s) => s.backgroundReview && !isRemovalPending(s))
  for (const s of sources) if (!s.backgroundReview && !isRemovalPending(s)) await closeLocalModelQuestion(s)
  if (reviewing.length === 0) return
  const reviewingIds = new Set(reviewing.map((s) => s.id))

  // Decided once per run and passed to every model step (read-back, retrieve, judge, draft).
  ctx.model = await resolveBackgroundModel()
  ctx.localOnly = new Set(
    listSources({ includePending: true })
      .filter((s) => s.localOnly)
      .map((s) => s.id)
  )
  // A Gmail source pending removal (S11) counts as review off: its mail is no one's evidence.
  ctx.reviewOff = new Set(
    listSources({ includePending: true })
      .filter((s) => s.kind === 'gmail' && (!s.backgroundReview || isRemovalPending(s)))
      .map((s) => s.id)
  )

  const reviewed = stored.filter((r) => r.sourceId && reviewingIds.has(r.sourceId))
  await readBack(ctx, reviewed)
  await actOnNewMail(ctx, reviewing)
}

/** The sent-reply read-back (flow 10 step 5), with Review and knowledge loaded so its notes land. Never fails a run. */
async function readBack(ctx: RunContext, records: SourceRecord[]): Promise<void> {
  if (!records.some((r) => r.sentByMe)) return
  try {
    if (!reviewStore.getState().loaded) await loadReviewEntries()
    await ensureKnowledgeLoaded()
    await readBackSent(records, { model: ctx.model, localOnlySourceIds: ctx.localOnly })
  } catch (e) {
    warn('Sent replies could not be read back', e)
  }
}

/** One "Which client is this?" per outside domain, for new mail only, under Everywhere with the scopes offered. */
async function askWhichClient(ctx: RunContext, sources: ConnectedSource[], unknown: Unknown[]): Promise<void> {
  const connectedAt = Math.min(...sources.map((s) => s.connectedAt))
  for (const { records, route } of unknown) {
    // Only Everywhere sources on the account: there is no client to offer.
    if (route.candidateScopeIds.length === 0) continue
    const inbound = newestInbound(records)
    if (!inbound || inbound.noise || inbound.occurredAt <= connectedAt) continue
    if (ctx.processed.has(inbound.externalId)) continue
    // Ids are fixed per account, domain and thread, so filing again (a run that failed before its cursor was saved)
    // finds the same question and only re-adds its entry, which slice 1b merges by ref.
    const id = `which-client:${ctx.accountId}:${route.domain}:${inbound.threadOrTaskId}`
    const open = await pmStore.findOpenQuestion({ domain: route.domain })
    if (open && open.id !== id) continue
    const scopes = (await Promise.all(route.candidateScopeIds.map((sid) => scopeOf(ctx, sid)))).filter(
      (s): s is Scope => !!s
    )
    if (scopes.length === 0) continue
    const entryId = `${id}:entry`
    const question: ClientQuestion = {
      id,
      kind: 'which-client',
      scopeId: null,
      accountId: ctx.accountId,
      threadId: inbound.threadOrTaskId,
      subject: inbound.title,
      from: inbound.author,
      summary: '',
      candidates: scopes.map((s) => ({ value: s.name, sourceLabel: '', scopeId: s.id })),
      domain: route.domain,
      reviewEntryId: entryId,
      state: 'open',
      createdAt: open?.createdAt ?? ctx.now,
    }
    if (!open) await pmStore.saveQuestion(question)
    await addReviewEntry({
      ...needsYouEntry(question, '', format),
      id: entryId,
      // Scope names are the user's own text, shown as plain option text.
      options: scopes.map((s) => ({ id: s.id, text: s.name })),
    })
    for (const s of sources) if (route.candidateScopeIds.includes(s.scopeId)) statsFor(ctx, s.id).notable = true
  }
}

/** One open "choose a local model" Needs you per local-only source (preflight R9); none while one is open. */
async function askForLocalModel(ctx: RunContext, source: ConnectedSource): Promise<void> {
  if (await pmStore.findOpenQuestion({ kind: 'choose-model', sourceId: source.id })) return
  const scope = await scopeOf(ctx, source.scopeId)
  const entryId = uuidv4()
  const question: ClientQuestion = {
    id: uuidv4(),
    kind: 'choose-model',
    sourceId: source.id,
    scopeId: source.scopeId,
    accountId: ctx.accountId,
    threadId: '',
    subject: '',
    from: '',
    summary: '',
    candidates: [],
    reviewEntryId: entryId,
    state: 'open',
    createdAt: ctx.now,
  }
  await pmStore.saveQuestion(question)
  await addReviewEntry({ ...needsYouEntry(question, scope?.name ?? '', format), id: entryId })
  statsFor(ctx, source.id).notable = true
}

/** A "choose a local model" question that no longer applies (a local model now, or the switch is off) is closed. */
async function closeLocalModelQuestion(source: ConnectedSource): Promise<void> {
  const open = await pmStore.findOpenQuestion({ kind: 'choose-model', sourceId: source.id })
  if (!open) return
  await pmStore.saveQuestion({ ...open, state: 'answered' })
  await setReviewEntryState({ ref: { type: 'question', id: open.id } }, 'done')
}

type Candidate = { source: ConnectedSource; inbound: SourceRecord }

const DAY_MS = 86_400_000

/**
 * Threads of the account's client sources whose newest inbound message may be acted on: not noise, not answered by the
 * PM since, not processed, newer than the source's connection and at most `GMAIL_BACKFILL_DAYS` old. Newest first.
 * Read from the stored records, so threads left over from an earlier tick (the per-tick cap, a failure) come back.
 */
async function newMailCandidates(ctx: RunContext, sources: ConnectedSource[]): Promise<Candidate[]> {
  const oldest = ctx.now - GMAIL_BACKFILL_DAYS * DAY_MS
  const out: Candidate[] = []
  for (const source of sources) {
    if (source.scopeId === EVERYWHERE_SCOPE_ID) continue
    const after = Math.max(source.connectedAt, oldest)
    const records = (await pmStore.getRecords(source.scopeId)).filter(
      (r) => r.sourceId === source.id && r.sourceKind === 'gmail' && r.occurredAt > after
    )
    const byThread = new Map<string, SourceRecord[]>()
    for (const r of records) byThread.set(r.threadOrTaskId, [...(byThread.get(r.threadOrTaskId) ?? []), r])
    for (const thread of byThread.values()) {
      if (newestFirst(thread)[0]?.sentByMe) continue
      const inbound = newestInbound(thread)
      if (!inbound || inbound.noise || ctx.processed.has(inbound.externalId)) continue
      out.push({ source, inbound })
    }
  }
  return out.sort((a, b) => b.inbound.occurredAt - a.inbound.occurredAt)
}

class NoModelError extends Error {}

/** A failure that belongs to one message (an unreadable judgement, an empty draft): counted against that message. */
class MessageFailure extends Error {}

/**
 * Retrieve, judge and act on one message with the run's model; marks it processed once `actOnThread` resolved.
 * Throws `MessageFailure` for a failure of this message only; any other throw is a failure of the model or the
 * service (an outage, a bad key, a rate limit), which no message is blamed for.
 */
async function judgeAndAct(ctx: RunContext, c: Candidate, model: BackgroundModel): Promise<void> {
  const scope = await scopeOf(ctx, c.source.scopeId)
  if (!scope) return
  const evidence = await retrieveEvidence({
    scopeId: scope.id,
    inbound: c.inbound,
    localOnlySourceIds: ctx.localOnly,
    cloudModel: model.cloud,
    excludeSourceIds: ctx.reviewOff,
  })
  throwIfAborted(ctx.signal)
  const { judgement, error } = await judgeThread({
    scopeName: scope.name,
    inbound: c.inbound,
    evidence,
    localOnlySourceIds: ctx.localOnly,
    model,
  })
  throwIfAborted(ctx.signal)
  if (!judgement) {
    if (error === JUDGE_LOCAL_ONLY) throw new LocalOnlyModelError()
    if (error === JUDGE_NO_MODEL) throw new NoModelError()
    if (error === JUDGE_UNREADABLE) throw new MessageFailure(MODEL_UNREADABLE)
    throw new PmRetryError(t(MODEL_FAILED))
  }
  let outcome: Awaited<ReturnType<typeof actOnThread>>
  try {
    outcome = await actOnThread({
      scope,
      inbound: c.inbound,
      judgement,
      evidence,
      localOnlyBlocked: false,
      model,
      localOnlySourceIds: ctx.localOnly,
    })
  } catch (e) {
    if (e instanceof Error && e.message === DRAFT_EMPTY) throw new MessageFailure(DRAFT_EMPTY)
    throw e
  }
  await pmStore.markProcessed(ctx.accountId, c.inbound.externalId)
  ctx.processed.add(c.inbound.externalId)
  attempts.delete(`${ctx.accountId}:${c.inbound.externalId}`)
  const stats = statsFor(ctx, c.source.id)
  stats.threads.add(c.inbound.threadOrTaskId)
  if (outcome !== 'ignored') stats.notable = true
}

/**
 * A message Dango could not check is handed to the user: one Needs you on its thread ("Couldn't check this email",
 * answered like any other question), then it is marked processed so it is not judged again.
 */
async function giveUp(ctx: RunContext, c: Candidate): Promise<void> {
  if (!(await pmStore.findOpenQuestion({ threadId: c.inbound.threadOrTaskId }))) {
    const scope = await scopeOf(ctx, c.source.scopeId)
    const entryId = uuidv4()
    const question: ClientQuestion = {
      id: uuidv4(),
      kind: 'which-answer',
      sourceId: c.source.id,
      scopeId: c.source.scopeId,
      accountId: ctx.accountId,
      threadId: c.inbound.threadOrTaskId,
      subject: c.inbound.title,
      from: c.inbound.author,
      summary: '',
      candidates: [],
      reviewEntryId: entryId,
      state: 'open',
      createdAt: ctx.now,
    }
    await pmStore.saveQuestion(question)
    await addReviewEntry({
      ...needsYouEntry(question, scope?.name ?? '', format),
      id: entryId,
      source: t('Gmail'),
      text: t("Couldn't check this email"),
      // The sender and subject are external text, passed as inert values.
      sub: format('{{from}} · "{{subject}}"', inertValues({ from: c.inbound.author, subject: c.inbound.title })),
    })
  }
  await pmStore.markProcessed(ctx.accountId, c.inbound.externalId)
  ctx.processed.add(c.inbound.externalId)
  attempts.delete(`${ctx.accountId}:${c.inbound.externalId}`)
  statsFor(ctx, c.source.id).notable = true
}

async function actOnNewMail(ctx: RunContext, sources: ConnectedSource[]): Promise<void> {
  const { model, localOnly } = ctx
  const candidates = await newMailCandidates(ctx, sources)
  if (model) {
    for (const s of sources) if (!model.cloud || !localOnly.has(s.id)) await closeLocalModelQuestion(s)
  }

  let acted = 0
  let retryable = false
  for (const c of candidates) {
    if (acted >= PIPELINE_MAX_THREADS_PER_TICK) break
    throwIfAborted(ctx.signal)
    if (ctx.processed.has(c.inbound.externalId)) continue
    if (removedSince(c.source.id)) continue
    if (!model) throw noModel()
    if (model.cloud && localOnly.has(c.source.id)) {
      // No model call for a source that stays on this device (ADR 0003).
      await askForLocalModel(ctx, c.source)
      continue
    }
    acted += 1
    ctx.progress(t('Checking new client emails…'))
    try {
      await judgeAndAct(ctx, c, model)
    } catch (e) {
      if (isAbort(e, ctx.signal)) throw e
      if (e instanceof NoModelError) throw noModel()
      if (e instanceof LocalOnlyModelError) {
        // A local-only source waits for a local model. On any other source the refusal is about this message (its
        // evidence, a switch flipped mid-run): it is handed to the user once rather than re-judged every tick.
        if (localOnly.has(c.source.id)) await askForLocalModel(ctx, c.source)
        else await giveUp(ctx, c)
        continue
      }
      if (e instanceof MessageFailure) {
        const key = `${ctx.accountId}:${c.inbound.externalId}`
        const tries = (attempts.get(key) ?? 0) + 1
        attempts.set(key, tries)
        if (tries >= MAX_ATTEMPTS_PER_MESSAGE) {
          warn('A client email could not be checked; handed to the user')
          await giveUp(ctx, c)
        } else {
          retryable = true
        }
        continue
      }
      // The model or the service failed (an outage, a bad key, a rate limit): stop here, blame no message and retry
      // the whole run later. Nothing was marked processed.
      if (e instanceof PmRetryError || e instanceof NeedsUserError) throw e
      warn('The model could not be reached', e)
      throw new PmRetryError(t(MODEL_FAILED))
    }
  }
  if (retryable) throw new PmRetryError(t(MODEL_UNREADABLE))
}

// ---------------------------------------------------------------------------------------------------------------------
// The shared run per account

type Joiner = { signal: AbortSignal; progress(text: string): void }
type SharedRun = { promise: Promise<RunStats>; joiners: Set<Joiner>; controller: AbortController }

/** The account's poll in flight, which later jobs join; cleared when it settles (preflight R14). */
const inflight = new Map<string, SharedRun>()
/** The last mailbox read queued per account (a poll or a backfill): the next one starts after it, never alongside. */
const accountTails = new Map<string, Promise<unknown>>()

function onAccount<T>(accountId: string, task: () => Promise<T>): Promise<T> {
  const next = (accountTails.get(accountId) ?? Promise.resolve()).catch(() => undefined).then(task)
  const tail = next.catch(() => undefined)
  accountTails.set(accountId, tail)
  void tail.then(() => {
    if (accountTails.get(accountId) === tail) accountTails.delete(accountId)
  })
  return next
}

function join(run: SharedRun, joiner: Joiner): void {
  run.joiners.add(joiner)
  const onAbort = () => {
    // Stopped only when every job waiting on it was stopped.
    if ([...run.joiners].every((j) => j.signal.aborted)) run.controller.abort(joiner.signal.reason)
  }
  if (joiner.signal.aborted) onAbort()
  else joiner.signal.addEventListener('abort', onAbort, { once: true })
}

function accountRun(accountId: string, joiner: Joiner, now: number): Promise<RunStats> {
  const existing = inflight.get(accountId)
  if (existing) {
    join(existing, joiner)
    return existing.promise
  }
  const controller = new AbortController()
  const run: SharedRun = { joiners: new Set(), controller, promise: Promise.resolve(new Map()) }
  join(run, joiner)
  const ctx: RunContext = {
    accountId,
    signal: controller.signal,
    progress: (text) => {
      for (const j of run.joiners) j.progress(text)
    },
    now,
    stats: new Map(),
    scopes: new Map(),
    model: null,
    localOnly: new Set(),
    reviewOff: new Set(),
    processed: new Set(),
  }
  run.promise = onAccount(accountId, async () => {
    try {
      await drainBackfills(ctx)
      await runAccount(ctx)
      return ctx.stats
    } catch (e) {
      throw mapGmailError(e, controller.signal)
    }
  }).finally(() => {
    if (inflight.get(accountId) === run) inflight.delete(accountId)
  })
  inflight.set(accountId, run)
  return run.promise
}

/**
 * Slice 7's sync for one Gmail source. Joins the account's run in flight, or starts it; summarises only this source:
 * `Checked {n} new emails` (threads stored or acted on for it this run). Quiet unless it drafted or asked something.
 * An expired sign-in throws `NeedsUserError` with the reconnect fix, no usable model the choose-model fix; anything
 * else throws a retryable error with translated copy, and the cursor stays where it was.
 */
export async function runGmailPipeline(
  source: ConnectedSource,
  ctx: { signal: AbortSignal; progress(text: string): void; now?: number }
): Promise<{ summary: string; quiet: boolean }> {
  const { accountId } = gmailConfig(source)
  try {
    if (!accountId) throw signInAgain()
    const stats = await accountRun(accountId, { signal: ctx.signal, progress: ctx.progress }, ctx.now ?? Date.now())
    const mine = stats.get(source.id)
    setSourceHealth(source.id, { ok: true, lastSyncAt: Date.now() })
    return {
      summary: t('Checked {{count}} new emails', { count: mine?.threads.size ?? 0 }),
      quiet: !mine?.notable,
    }
  } catch (e) {
    if (!isAbort(e, ctx.signal)) setSourceHealth(source.id, { ok: false, message: healthMessage(e) })
    throw e
  }
}

type BackfillContext = { signal?: AbortSignal; progress?(text: string): void }

/**
 * After "Which client is this?" adds `matcher` to `source`: reads `GMAIL_BACKFILL_DAYS` of the account's mail matching
 * it and stores the threads that now route to a client scope. Leaves the account cursor alone and acts on nothing.
 * Only `drainBackfills` calls it, in the jobs window, inside the account's run (which holds its mailbox slot). Errors
 * are not mapped here. Returns how many records it stored.
 */
async function readMatcher(source: ConnectedSource, matcher: string, ctx: BackfillContext): Promise<number> {
  const { accountId } = gmailConfig(source)
  if (ctx.signal) throwIfAborted(ctx.signal)
  const token = await getFreshToken(accountId)
  if (!token.ok) throw signInAgain()
  const cursor = await pmStore.getCursor(accountId, 'gmail', 'mailbox')
  ctx.progress?.(t('Reading earlier emails…'))
  const result = await syncGmailMailbox({
    accountId,
    accessToken: token.token,
    cursor: null,
    backfillQuery: buildMatcherQuery([matcher]),
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  })
  if (ctx.signal) throwIfAborted(ctx.signal)
  const sources = (await gmailSources())
    .filter((s) => gmailConfig(s).accountId === accountId)
    .map((s) => {
      if (s.id !== source.id) return s
      const matchers = [...new Set([...gmailConfig(s).matchers, matcher])]
      return { ...s, config: { ...s.config, matchers } }
    })
  const ownAddress = result.ownAddress || cursor?.ownAddress || ''
  const { stored } = routeRecords(result.records, routeSourcesOf(sources), ownAddress)
  await pmStore.upsertRecords(stored)
  await pmStore.flushRecords()
  return stored.length
}

/** A pending backfill that failed this many runs is dropped and handed to the user. */
export const MAX_BACKFILL_ATTEMPTS = 3

/** Tells the user the earlier mail of an answered sender could not be read (new mail is filed all the same). */
async function backfillGivenUp(ctx: RunContext, q: ClientQuestion, target: ConnectedSource | undefined): Promise<void> {
  await addReviewEntry({
    ...needsYouEntry(q, '', format),
    id: `${q.id}:backfill`,
    scopeId: target?.scopeId ?? EVERYWHERE_SCOPE_ID,
    text: t("Couldn't read earlier emails from this sender. New ones are filed."),
    actionLabel: t('Open'),
  })
  if (target) statsFor(ctx, target.id).notable = true
}

/**
 * "Which client is this?" answers waiting for their backfill (`client_answer` stores them on the question, in any
 * window), run at the start of the account's run, in the jobs window and its mailbox slot, so the answered thread is
 * stored under its client before the poll acts on new mail. Sources are read again first: the answer may have changed
 * one in another window. A backfill that fails stays pending for the next run without holding this one up; after
 * `MAX_BACKFILL_ATTEMPTS` failures it is dropped and the user is told. A sign-in problem or a stop ends the run.
 */
async function drainBackfills(ctx: RunContext): Promise<void> {
  const answered = await pmStore.listPendingBackfills(ctx.accountId)
  if (answered.length === 0) return
  await loadSources()
  for (const q of answered) {
    const backfill = q.backfill
    if (!backfill) continue
    const target = listSources({ kind: 'gmail', includePending: true }).find((s) => s.id === backfill.sourceId)
    // Pending removal (S11): kept for an Undo; read once the source is back, or dropped once it is gone.
    if (target && isRemovalPending(target)) continue
    try {
      if (target && gmailConfig(target).accountId === ctx.accountId) {
        await readMatcher(target, backfill.matcher, { signal: ctx.signal, progress: ctx.progress })
      }
      await pmStore.clearBackfill(q.id)
    } catch (e) {
      if (isAbort(e, ctx.signal) || e instanceof NeedsUserError || e instanceof GmailAuthError) throw e
      warn('Earlier emails of an answered sender could not be read', e)
      if ((await pmStore.bumpBackfillAttempts(q.id)) >= MAX_BACKFILL_ATTEMPTS) {
        await pmStore.clearBackfill(q.id)
        await backfillGivenUp(ctx, q, target)
      }
    }
  }
}

export function _resetPipelineForTests(): void {
  inflight.clear()
  accountTails.clear()
  attempts.clear()
  health.clear()
}
