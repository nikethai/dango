import {
  ASANA_POLL_MS,
  type ClientQuestion,
  type CopyFormat,
  GMAIL_POLL_MS,
  needsYouEntry,
  type PmSourceKind,
} from '@shared/pm-pilot'
import { v4 as uuidv4 } from 'uuid'
import i18n from '@/i18n'
import {
  AsanaAuthError,
  AsanaForbiddenError,
  AsanaRateLimitedError,
  AsanaRequestError,
  listAsanaProjects,
  syncAsanaProject,
} from './asana-adapter'
import { errorClassName, resolveBackgroundModel } from './background-model'
import {
  addReviewEntry,
  asanaConfig,
  type ConnectedSource,
  getScope,
  JOB_FIX_LABELS,
  listSources,
  loadSources,
  NeedsUserError,
  registerSourceAdapter,
  type SourceItem,
  sourcesStore,
} from './bridge'
import {
  healthMessage,
  isAbort,
  PmRetryError,
  pruneRemovedSources,
  runGmailPipeline,
  SOURCES_UNREADABLE,
  setSourceHealth,
  signInAgain,
  throwIfAborted,
} from './pipeline'
import { pmStore } from './store'
import { getFreshToken } from './tokens'

/*
 * Slice 10's reading side of the Gmail and Asana kinds (slice 7 owns sign-in, polling, retries and job display).
 * Asana is read-only: tasks and comments are stored as records, which the Gmail pipeline uses as evidence. Task names,
 * comments and project names are external text, passed only as values or plain option text.
 */

const format: CopyFormat = (key, values) => i18n.t(key, values) as string
const t = (key: string, values?: Record<string, string | number>): string =>
  values ? i18n.t(key, values) : i18n.t(key)

export const ASANA_ACCESS_LOST = 'access to the Asana project was lost'
export const ASANA_BUSY = 'Asana is busy'
export const ASANA_UNREACHABLE = 'Asana could not be reached'
export const ASANA_FAILED = 'Asana could not be synced'
const WAITING_FOR_PROJECT = 'Waiting for you to pick an Asana project'

/** Items `readSourceItems` returns per call (slice 7's background review). */
export const READ_MAX_ITEMS = 40

function warn(what: string, e?: unknown): void {
  const name = errorClassName(e)
  console.warn(`[pm-pilot] ${what}`, ...(name ? [name] : []))
}

/** 401 needs signing in again; 403 means the project is out of reach (signing in again does not help). */
function mapAsanaError(e: unknown, signal?: AbortSignal): unknown {
  if (e instanceof NeedsUserError || e instanceof PmRetryError || isAbort(e, signal)) return e
  if (e instanceof AsanaAuthError) return signInAgain()
  if (e instanceof AsanaForbiddenError) {
    return new NeedsUserError(ASANA_ACCESS_LOST, { action: 'try-again', label: JOB_FIX_LABELS['try-again'] })
  }
  if (e instanceof AsanaRateLimitedError) return new PmRetryError(t(ASANA_BUSY))
  if (e instanceof AsanaRequestError) return new PmRetryError(t(ASANA_UNREACHABLE))
  warn('Asana sync failed', e)
  return new PmRetryError(t(ASANA_FAILED))
}

/** Every Asana source, pending removal included (S11), so their records are not pruned before an Undo. */
async function asanaSources(): Promise<ConnectedSource[]> {
  if (!sourcesStore.getState().loaded) await loadSources()
  if (!sourcesStore.getState().loaded) throw new PmRetryError(t(SOURCES_UNREADABLE))
  return listSources({ kind: 'asana', includePending: true })
}

async function freshToken(accountId: string): Promise<string> {
  if (!accountId) throw signInAgain()
  const token = await getFreshToken(accountId)
  if (!token.ok) throw signInAgain()
  return token.token
}

/** One "Which Asana project is {scope}?" per source while none is picked; the projects are its options. */
async function askWhichProject(source: ConnectedSource, accountId: string, signal: AbortSignal): Promise<boolean> {
  if (await pmStore.findOpenQuestion({ kind: 'which-project', sourceId: source.id })) return false
  const projects = await listAsanaProjects(await freshToken(accountId), undefined, signal)
  throwIfAborted(signal)
  const scope = await getScope(source.scopeId)
  const entryId = uuidv4()
  const question: ClientQuestion = {
    id: uuidv4(),
    kind: 'which-project',
    sourceId: source.id,
    scopeId: source.scopeId,
    accountId,
    threadId: '',
    subject: '',
    from: '',
    summary: '',
    candidates: projects.map((p) => ({ value: p.name, sourceLabel: 'Asana', projectGid: p.id })),
    reviewEntryId: entryId,
    state: 'open',
    createdAt: Date.now(),
  }
  await pmStore.saveQuestion(question)
  await addReviewEntry({ ...needsYouEntry(question, scope?.name ?? '', format), id: entryId })
  return true
}

async function syncAsana(
  given: ConnectedSource,
  ctx: { signal: AbortSignal; progress(text: string): void }
): Promise<{ summary: string; quiet: boolean }> {
  await pruneRemovedSources('asana', await asanaSources())
  let source = given
  if (!asanaConfig(source).projectGid) {
    // The project may have been picked in a chat in another window (Task 11), which this window's copy of the
    // sources does not follow: read them again before asking.
    await loadSources()
    source = listSources({ kind: 'asana' }).find((s) => s.id === given.id) ?? given
  }
  const { accountId, projectGid } = asanaConfig(source)
  if (!projectGid) {
    const asked = await askWhichProject(source, accountId, ctx.signal)
    return { summary: t(WAITING_FOR_PROJECT), quiet: !asked }
  }

  const token = await freshToken(accountId)
  // One cursor per source and project: two scopes may read the same project, and a new pick starts afresh.
  const cursorScope = `${source.id}:${projectGid}`
  const cursor = await pmStore.getCursor(accountId, 'asana', cursorScope)
  ctx.progress(t('Reading Asana…'))
  const result = await syncAsanaProject({
    accountId,
    sourceId: source.id,
    accessToken: token,
    projectGid,
    scopeId: source.scopeId,
    cursor: cursor ?? null,
    signal: ctx.signal,
  })
  throwIfAborted(ctx.signal)

  await pmStore.upsertRecords(result.records)
  const deleted = result.deletedExternalIds
  if (deleted.length > 0) {
    // A deleted task takes its comments with it; a deleted comment goes alone. This source's copies only.
    await pmStore.deleteRecordsByThread(source.id, deleted)
    await pmStore.deleteRecords(source.id, 'asana', deleted)
  }
  if (!cursor) {
    // A first full read for this project: what it did not return (an earlier project's tasks) is gone.
    const kept = new Set(result.records.map((r) => r.id))
    const stale = (await pmStore.getRecords(source.scopeId))
      .filter((r) => r.sourceId === source.id && r.sourceKind === 'asana' && !kept.has(r.id))
      .map((r) => r.externalId)
    if (stale.length > 0) await pmStore.deleteRecords(source.id, 'asana', stale)
  }
  // Saved last: `setCursor` flushes the records first, and a throw above keeps the old cursor.
  await pmStore.setCursor({ ...result.cursor, scope: cursorScope })
  const count = result.records.length
  return {
    summary: t('Synced {{count}} tasks and comments', { count }),
    quiet: count === 0 && deleted.length === 0,
  }
}

/**
 * Slice 7's sync for one Asana source. No project yet: one `which-project` question and `Waiting for you to pick an
 * Asana project`. Else the project's tasks and comments are stored: `Synced {n} tasks and comments`, quiet when
 * nothing changed. 401 → sign in again; 403 → access lost (try again once access is back); the rest is retried.
 */
export async function syncAsanaSource(
  source: ConnectedSource,
  ctx: { signal: AbortSignal; progress(text: string): void }
): Promise<{ summary: string; quiet: boolean }> {
  try {
    const out = await syncAsana(source, ctx)
    setSourceHealth(source.id, { ok: true, lastSyncAt: Date.now() })
    return out
  } catch (e) {
    const mapped = mapAsanaError(e, ctx.signal)
    if (!isAbort(mapped, ctx.signal)) setSourceHealth(source.id, { ok: false, message: healthMessage(mapped) })
    throw mapped
  }
}

/**
 * Slice 7's background review reads a Gmail or Asana source's stored records newer than `cursor` (ms as a string),
 * oldest first, at most `READ_MAX_ITEMS`; noise is left out. A local-only source on a cloud model (or with no model)
 * returns none (the review job already refuses that case; this is the defence, preflight R22).
 */
export async function readSourceItems(
  source: ConnectedSource,
  ctx: { signal: AbortSignal; cursor: string | null }
): Promise<{ items: SourceItem[]; cursor: string | null }> {
  if (source.localOnly) {
    const model = await resolveBackgroundModel()
    if (!model || model.cloud) return { items: [], cursor: ctx.cursor }
  }
  throwIfAborted(ctx.signal)
  const after = Number(ctx.cursor ?? 0) || 0
  const records = (await pmStore.getRecords(source.scopeId))
    .filter((r) => r.sourceId === source.id && !r.noise && r.occurredAt > after)
    .sort((a, b) => a.occurredAt - b.occurredAt)
    .slice(0, READ_MAX_ITEMS)
  const items = records.map((r) => ({ ref: r.id, label: r.title, text: r.text, updatedAt: r.occurredAt }))
  const last = records[records.length - 1]
  return { items, cursor: last ? String(last.occurredAt) : ctx.cursor }
}

const PM_KINDS: ReadonlySet<string> = new Set<PmSourceKind>(['gmail', 'asana'])
let unwatchSources: (() => void) | null = null

/**
 * Removes the records and cursors of a Gmail or Asana source as soon as it disappears from the sources store
 * (preflight R15). An Asana cursor belongs to its source; a Gmail cursor belongs to the mailbox, so it goes only when
 * no Gmail source on that account is left.
 */
function watchRemovedSources(): () => void {
  return sourcesStore.subscribe((next, prev) => {
    if (!prev.loaded || !next.loaded) return
    const kept = new Set(next.sources.map((s) => s.id))
    for (const s of prev.sources) {
      if (!PM_KINDS.has(s.kind) || kept.has(s.id)) continue
      void pmStore.removeSourceRecords(s.id).catch((e) => warn('Records of a removed source could not be removed', e))
      void removeCursorsOf(s, next.sources).catch((e) => warn('Cursors of a removed source could not be removed', e))
    }
  })
}

function removeCursorsOf(removed: ConnectedSource, remaining: ConnectedSource[]): Promise<void> {
  if (removed.kind === 'asana') {
    return pmStore.removeCursors((c) => c.sourceKind === 'asana' && c.scope.startsWith(`${removed.id}:`))
  }
  const accountId = typeof removed.config.accountId === 'string' ? removed.config.accountId : ''
  if (!accountId) return Promise.resolve()
  const stillUsed = remaining.some((s) => s.kind === 'gmail' && s.config.accountId === accountId)
  if (stillUsed) return Promise.resolve()
  return pmStore.removeCursors((c) => c.sourceKind === 'gmail' && c.accountId === accountId)
}

/**
 * Registers the Gmail and Asana reading sides with slice 7 and prunes records of removed sources. Jobs window only,
 * desktop only, after slice 7's kinds and before stored jobs resume (preflight R10). The draft applier and openers
 * are registered by `initPmReview` in `__root.tsx`, so every window that shows Review has them.
 */
export function registerPmAdapters(): void {
  registerSourceAdapter('gmail', { pollMs: GMAIL_POLL_MS, sync: runGmailPipeline, read: readSourceItems })
  registerSourceAdapter('asana', { pollMs: ASANA_POLL_MS, sync: syncAsanaSource, read: readSourceItems })
  unwatchSources?.()
  unwatchSources = watchRemovedSources()
}

export function _resetAdaptersForTests(): void {
  unwatchSources?.()
  unwatchSources = null
}
