import {
  type ClientQuestion,
  type CopyFormat,
  needsYouEntry,
  PIPELINE_MAX_THREADS_PER_TICK,
  type RouteResult,
  type RouteSource,
  routeThread,
  type SourceRecord,
} from '@shared/pm-pilot'
import { v4 as uuidv4 } from 'uuid'
import i18n from '@/i18n'
import { actOnThread } from './act-call'
import { type BackgroundModel, errorClassName, resolveBackgroundModel } from './background-model'
import {
  addReviewEntry,
  type ConnectedSource,
  EVERYWHERE_SCOPE_ID,
  ensureKnowledgeLoaded,
  getScope,
  gmailConfig,
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

/** Every Gmail source, read from the loaded sources store; unreadable sources are retried, never treated as none. */
async function gmailSources(): Promise<ConnectedSource[]> {
  if (!sourcesStore.getState().loaded) await loadSources()
  if (!sourcesStore.getState().loaded) throw new PmRetryError(t(SOURCES_UNREADABLE))
  return listSources({ kind: 'gmail' })
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
  // The whole cursor, own address included, only now: `setCursor` flushes the records above first.
  await pmStore.setCursor(result.cursor)

  await readBack(stored)
  await askWhichClient(ctx, sources, unknown)
  await actOnNewMail(ctx, sources)
}

/** The sent-reply read-back (flow 10 step 5), with Review and knowledge loaded so its notes land. Never fails a run. */
async function readBack(records: SourceRecord[]): Promise<void> {
  if (!records.some((r) => r.sentByMe)) return
  try {
    if (!reviewStore.getState().loaded) await loadReviewEntries()
    await ensureKnowledgeLoaded()
    await readBackSent(records)
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
    if (await pmStore.isProcessed(ctx.accountId, inbound.externalId)) continue
    if (await pmStore.findOpenQuestion({ domain: route.domain })) continue
    const scopes = (await Promise.all(route.candidateScopeIds.map((id) => scopeOf(ctx, id)))).filter(
      (s): s is Scope => !!s
    )
    if (scopes.length === 0) continue
    const entryId = uuidv4()
    const question: ClientQuestion = {
      id: uuidv4(),
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
      createdAt: ctx.now,
    }
    await pmStore.saveQuestion(question)
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

/**
 * Threads of the account's client sources whose newest inbound message may be acted on: not noise, not answered by the
 * PM since, and newer than the source's connection. Newest first. Read from the stored records, so threads left over
 * from an earlier tick (the per-tick cap, a failure) are picked up again.
 */
async function newMailCandidates(sources: ConnectedSource[]): Promise<Candidate[]> {
  const out: Candidate[] = []
  for (const source of sources) {
    if (source.scopeId === EVERYWHERE_SCOPE_ID) continue
    const records = (await pmStore.getRecords(source.scopeId)).filter(
      (r) => r.sourceId === source.id && r.sourceKind === 'gmail'
    )
    const byThread = new Map<string, SourceRecord[]>()
    for (const r of records) byThread.set(r.threadOrTaskId, [...(byThread.get(r.threadOrTaskId) ?? []), r])
    for (const thread of byThread.values()) {
      if (newestFirst(thread)[0]?.sentByMe) continue
      const inbound = newestInbound(thread)
      if (!inbound || inbound.noise || inbound.occurredAt <= source.connectedAt) continue
      out.push({ source, inbound })
    }
  }
  return out.sort((a, b) => b.inbound.occurredAt - a.inbound.occurredAt)
}

class NoModelError extends Error {}

/** Retrieve, judge and act on one message with the run's model; marks it processed once `actOnThread` resolved. */
async function judgeAndAct(
  ctx: RunContext,
  c: Candidate,
  model: BackgroundModel,
  localOnly: Set<string>
): Promise<void> {
  const scope = await scopeOf(ctx, c.source.scopeId)
  if (!scope) return
  const evidence = await retrieveEvidence({
    scopeId: scope.id,
    inbound: c.inbound,
    localOnlySourceIds: localOnly,
    cloudModel: model.cloud,
  })
  throwIfAborted(ctx.signal)
  const { judgement, error } = await judgeThread({
    scopeName: scope.name,
    inbound: c.inbound,
    evidence,
    localOnlySourceIds: localOnly,
    model,
  })
  throwIfAborted(ctx.signal)
  if (!judgement) {
    if (error === JUDGE_LOCAL_ONLY) throw new LocalOnlyModelError()
    if (error === JUDGE_NO_MODEL) throw new NoModelError()
    throw new PmRetryError(t(error === JUDGE_UNREADABLE ? MODEL_UNREADABLE : MODEL_FAILED))
  }
  const outcome = await actOnThread({
    scope,
    inbound: c.inbound,
    judgement,
    evidence,
    localOnlyBlocked: false,
    model,
    localOnlySourceIds: localOnly,
  })
  await pmStore.markProcessed(ctx.accountId, c.inbound.externalId)
  attempts.delete(`${ctx.accountId}:${c.inbound.externalId}`)
  const stats = statsFor(ctx, c.source.id)
  stats.threads.add(c.inbound.threadOrTaskId)
  if (outcome !== 'ignored') stats.notable = true
}

async function actOnNewMail(ctx: RunContext, sources: ConnectedSource[]): Promise<void> {
  const candidates = await newMailCandidates(sources)
  // Decided once per run: the model, whether it is cloud, and which sources stay on this device.
  const model = await resolveBackgroundModel()
  const localOnly = new Set(
    listSources()
      .filter((s) => s.localOnly)
      .map((s) => s.id)
  )
  if (model) {
    for (const s of sources) if (!model.cloud || !localOnly.has(s.id)) await closeLocalModelQuestion(s)
  }

  let acted = 0
  let failure: unknown
  let modelMissing = false
  for (const c of candidates) {
    if (acted >= PIPELINE_MAX_THREADS_PER_TICK) break
    throwIfAborted(ctx.signal)
    if (await pmStore.isProcessed(ctx.accountId, c.inbound.externalId)) continue
    if (!model) {
      modelMissing = true
      break
    }
    if (model.cloud && localOnly.has(c.source.id)) {
      // No model call for a source that stays on this device (ADR 0003).
      await askForLocalModel(ctx, c.source)
      continue
    }
    acted += 1
    ctx.progress(t('Checking new client emails…'))
    try {
      await judgeAndAct(ctx, c, model, localOnly)
    } catch (e) {
      if (isAbort(e, ctx.signal)) throw e
      if (e instanceof LocalOnlyModelError) {
        await askForLocalModel(ctx, c.source)
        continue
      }
      if (e instanceof NoModelError) {
        modelMissing = true
        break
      }
      failure ??= e
      const key = `${ctx.accountId}:${c.inbound.externalId}`
      const tries = (attempts.get(key) ?? 0) + 1
      attempts.set(key, tries)
      if (tries >= MAX_ATTEMPTS_PER_MESSAGE) {
        // Given up, so one message cannot stop the mailbox: logged without its text.
        warn('A client email was skipped after repeated failures', e)
        attempts.delete(key)
        await pmStore.markProcessed(ctx.accountId, c.inbound.externalId)
      }
    }
  }
  if (modelMissing) throw noModel()
  if (failure !== undefined) {
    if (failure instanceof PmRetryError || failure instanceof NeedsUserError) throw failure
    warn('A client email could not be drafted', failure)
    throw new PmRetryError(t(MODEL_FAILED))
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The shared run per account

type Joiner = { signal: AbortSignal; progress(text: string): void }
type SharedRun = { promise: Promise<RunStats>; joiners: Set<Joiner>; controller: AbortController }

/** The account's run in flight; cleared when it settles (preflight R14). */
const inflight = new Map<string, SharedRun>()

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
  }
  run.promise = (async () => {
    try {
      await runAccount(ctx)
      return ctx.stats
    } catch (e) {
      throw mapGmailError(e, controller.signal)
    }
  })().finally(() => {
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

/**
 * After "Which client is this?" adds `matcher` to `source`: reads `GMAIL_BACKFILL_DAYS` of the account's mail
 * matching it and stores the threads that now route to a client scope. Leaves the account cursor alone and acts on
 * nothing. Waits for the account's run in flight first. Returns how many records it stored.
 */
export async function backfillMatcher(source: ConnectedSource, matcher: string): Promise<number> {
  const { accountId } = gmailConfig(source)
  if (!accountId) throw signInAgain()
  await inflight.get(accountId)?.promise.catch(() => undefined)
  try {
    const token = await getFreshToken(accountId)
    if (!token.ok) throw signInAgain()
    const cursor = await pmStore.getCursor(accountId, 'gmail', 'mailbox')
    const result = await syncGmailMailbox({
      accountId,
      accessToken: token.token,
      cursor: null,
      backfillQuery: buildMatcherQuery([matcher]),
    })
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
  } catch (e) {
    throw mapGmailError(e)
  }
}

export function _resetPipelineForTests(): void {
  inflight.clear()
  attempts.clear()
  health.clear()
}
