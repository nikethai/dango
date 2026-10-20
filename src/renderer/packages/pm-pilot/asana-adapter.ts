import { recordId, type SourceRecord, type SyncCursor } from '@shared/pm-pilot'
import { FetchError, ofetch } from 'ofetch'

// Slice 10: read-only Asana source adapter. Reads tasks and comment stories of one project; writes nothing.
// Task names, notes, comments and author names are untrusted text, carried as plain data.

export const ASANA_API = 'https://app.asana.com/api/1.0'

/** Tasks read by one full read; the rest of a huge project is left out. */
export const ASANA_MAX_TASKS = 2000
/** Event pages read per poll; the next poll carries on from the last sync token. */
export const ASANA_EVENT_MAX_PAGES = 20
/** More changed tasks than this in one poll is handled as a full read. */
export const ASANA_MAX_CHANGED_TASKS = 200
export const ASANA_MAX_PROJECTS = 1000
const STORY_MAX_PAGES = 5
const WORKSPACE_MAX_PAGES = 10
const PAGE_SIZE = 100
const CONCURRENCY = 3
const MAX_TEXT_CHARS = 20_000
/** Comments are read only for tasks modified this recently (a new comment updates `modified_at`). */
const COMMENT_WINDOW_MS = 90 * 86_400_000
const RETRY_AFTER_MAX_S = 60
const RETRY_AFTER_DEFAULT_S = 10

const TASK_FIELDS = [
  'name',
  'notes',
  'completed',
  'permalink_url',
  'created_at',
  'modified_at',
  'created_by.name',
  'memberships.project.gid',
  'memberships.section.name',
].join(',')
const STORY_FIELDS = 'resource_subtype,text,created_at,created_by.name'

/** Asana refused the token (401, or a 403 that is not a usage limit): the account needs signing in again. */
export class AsanaAuthError extends Error {
  constructor(readonly status: number) {
    super(`Asana refused the sign-in (${status})`)
    this.name = 'AsanaAuthError'
  }
}

/** Asana is rate-limiting (429 twice, or a 403 usage limit). Retry later; not a sign-in problem. */
export class AsanaRateLimitedError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter?: number
  ) {
    super(`Asana is busy, try again later (${status})`)
    this.name = 'AsanaRateLimitedError'
  }
}

/** Any other failed Asana request. Carries only the status: never the URL, the token or a `cause`. */
export class AsanaRequestError extends Error {
  constructor(readonly status: number | undefined) {
    super(`Asana request failed (${status ?? 'network'})`)
    this.name = 'AsanaRequestError'
  }
}

/** 412 from `/events`: the sync token is missing or expired; `sync` is the fresh one Asana returned. */
class AsanaSyncTokenError extends Error {
  constructor(readonly sync: string | undefined) {
    super('Asana sync token expired')
    this.name = 'AsanaSyncTokenError'
  }
}

type Query = Record<string, string | number | undefined>
type Page<T> = { data?: T[]; next_page?: { offset?: string } | null }

type AsanaTask = {
  gid: string
  name?: string
  notes?: string
  completed?: boolean
  permalink_url?: string
  created_at?: string
  modified_at?: string
  created_by?: { name?: string } | null
  memberships?: Array<{ project?: { gid?: string } | null; section?: { name?: string } | null }>
}
type AsanaStory = {
  gid: string
  resource_subtype?: string
  text?: string
  created_at?: string
  created_by?: { name?: string } | null
}
type AsanaEvent = {
  action?: string
  resource?: { gid?: string; resource_type?: string; resource_subtype?: string } | null
  parent?: { gid?: string; resource_type?: string } | null
}
type EventsPage = { data?: AsanaEvent[]; sync?: string; has_more?: boolean }

function statusOf(error: FetchError): number | undefined {
  return error.status ?? error.response?.status
}

/** `Retry-After` in seconds, clamped to 0..60; anything unreadable waits the default. */
function retryAfterSeconds(error: FetchError): number {
  const raw = error.response?.headers.get('retry-after')
  const value = raw == null || raw.trim() === '' ? Number.NaN : Number(raw)
  if (!Number.isFinite(value)) return RETRY_AFTER_DEFAULT_S
  return Math.min(RETRY_AFTER_MAX_S, Math.max(0, value))
}

function errorMessages(error: FetchError): string[] {
  const errors = (error.data as { errors?: Array<{ message?: unknown }> } | undefined)?.errors
  return Array.isArray(errors) ? errors.map((e) => String(e?.message ?? '')) : []
}

function isUsageLimit(error: FetchError): boolean {
  return errorMessages(error).some((m) => /rate limit|usage limit|quota|too many requests/i.test(m))
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * One GET on the Asana API. A 429 waits `Retry-After` (at most 60 s) and retries once; a second 429 throws
 * `AsanaRateLimitedError`. 401/403 throw `AsanaAuthError` (a 403 usage limit is rate-limited instead), 412 throws
 * the internal sync-token error, anything else `AsanaRequestError`. No error holds the URL, the token or a cause.
 */
async function asanaGet<T>(token: string, path: string, query: Query, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await ofetch<T>(`${ASANA_API}/${path}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        query,
        signal,
        retry: 0,
      })
    } catch (error) {
      if (!(error instanceof FetchError)) throw error
      if (signal?.aborted) throw signal.reason ?? new AsanaRequestError(undefined)
      const status = statusOf(error)
      if (status === 429) {
        const seconds = retryAfterSeconds(error)
        if (attempt === 0) {
          await wait(seconds * 1000, signal)
          continue
        }
        throw new AsanaRateLimitedError(429, seconds)
      }
      if (status === 403 && isUsageLimit(error)) throw new AsanaRateLimitedError(403, retryAfterSeconds(error))
      if (status === 401 || status === 403) throw new AsanaAuthError(status)
      if (status === 412) {
        const sync = (error.data as { sync?: unknown } | undefined)?.sync
        throw new AsanaSyncTokenError(typeof sync === 'string' && sync ? sync : undefined)
      }
      throw new AsanaRequestError(status)
    }
  }
}

/** Reads `next_page.offset` pages until done, `maxItems` or `maxPages`, stopping on a repeated offset. */
async function readPages<T>(
  token: string,
  path: string,
  query: Query,
  limits: { maxItems: number; maxPages: number },
  signal?: AbortSignal
): Promise<T[]> {
  const items: T[] = []
  const seen = new Set<string>()
  let offset: string | undefined
  for (let pages = 0; pages < limits.maxPages && items.length < limits.maxItems; pages++) {
    const page = await asanaGet<Page<T>>(token, path, { ...query, limit: PAGE_SIZE, offset }, signal)
    items.push(...(page.data ?? []).slice(0, limits.maxItems - items.length))
    offset = page.next_page?.offset ?? undefined
    if (!offset || seen.has(offset)) break
    seen.add(offset)
  }
  return items
}

async function mapLimited<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  let failed = false
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++
      try {
        results[i] = await fn(items[i])
      } catch (error) {
        failed = true
        throw error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker))
  return results
}

/** Projects the token can see: in `workspaceGid`, or in every workspace of the user. Archived projects are left out. */
export async function listAsanaProjects(
  token: string,
  workspaceGid?: string,
  signal?: AbortSignal
): Promise<Array<{ id: string; name: string }>> {
  const workspaces = workspaceGid
    ? [workspaceGid]
    : (
        await readPages<{ gid: string }>(
          token,
          'workspaces',
          { opt_fields: 'name' },
          { maxItems: 100, maxPages: WORKSPACE_MAX_PAGES },
          signal
        )
      ).map((w) => w.gid)
  const projects: Array<{ id: string; name: string }> = []
  for (const workspace of workspaces) {
    if (projects.length >= ASANA_MAX_PROJECTS) break
    const page = await readPages<{ gid: string; name?: string }>(
      token,
      'projects',
      { workspace, archived: 'false', opt_fields: 'name' },
      {
        maxItems: ASANA_MAX_PROJECTS - projects.length,
        maxPages: Math.ceil(ASANA_MAX_PROJECTS / PAGE_SIZE),
      },
      signal
    )
    projects.push(...page.map((p) => ({ id: p.gid, name: p.name ?? '' })))
  }
  return projects
}

export type AsanaSyncInput = {
  accountId: string
  sourceId: string
  accessToken: string
  projectGid: string
  scopeId: string
  cursor: SyncCursor | null
  now?: number
  signal?: AbortSignal
}

export type AsanaSyncResult = { records: SourceRecord[]; cursor: SyncCursor; deletedExternalIds: string[] }

type Ctx = { input: AsanaSyncInput; now: number }

function time(value: string | undefined, fallback: number): number {
  const t = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(t) ? t : fallback
}

function inProject(task: AsanaTask, projectGid: string): boolean {
  return (task.memberships ?? []).some((m) => m.project?.gid === projectGid)
}

function taskLink(task: AsanaTask): { label: string; url: string } {
  return { label: `Asana "${task.name ?? ''}"`, url: task.permalink_url ?? '' }
}

function baseRecord(ctx: Ctx, externalId: string, taskGid: string) {
  const { accountId, sourceId, scopeId } = ctx.input
  return {
    id: recordId('asana', externalId),
    sourceKind: 'asana' as const,
    sourceId,
    accountId,
    externalId,
    threadOrTaskId: taskGid,
    scopeId,
    participants: [],
    sentByMe: false,
    noise: false,
  }
}

function taskRecord(ctx: Ctx, task: AsanaTask): SourceRecord {
  const section = task.memberships?.find((m) => m.project?.gid === ctx.input.projectGid)?.section?.name
  const status = task.completed ? 'done' : section || undefined
  return {
    ...baseRecord(ctx, task.gid, task.gid),
    author: task.created_by?.name ?? '',
    occurredAt: time(task.modified_at ?? task.created_at, ctx.now),
    title: task.name ?? '',
    text: (task.notes ?? '').slice(0, MAX_TEXT_CHARS),
    ...(status ? { status } : {}),
    link: taskLink(task),
  }
}

function commentRecord(ctx: Ctx, task: AsanaTask, story: AsanaStory): SourceRecord {
  return {
    ...baseRecord(ctx, story.gid, task.gid),
    author: story.created_by?.name ?? '',
    occurredAt: time(story.created_at, ctx.now),
    title: `Comment on ${task.name ?? ''}`,
    text: (story.text ?? '').slice(0, MAX_TEXT_CHARS),
    link: taskLink(task),
  }
}

/** Comment stories only; system stories (assignments, moves, field changes) are ignored. */
async function readComments(ctx: Ctx, task: AsanaTask): Promise<SourceRecord[]> {
  const stories = await readPages<AsanaStory>(
    ctx.input.accessToken,
    `tasks/${encodeURIComponent(task.gid)}/stories`,
    { opt_fields: STORY_FIELDS },
    { maxItems: STORY_MAX_PAGES * PAGE_SIZE, maxPages: STORY_MAX_PAGES },
    ctx.input.signal
  )
  return stories.filter((s) => s.resource_subtype === 'comment_added').map((s) => commentRecord(ctx, task, s))
}

async function taskWithComments(ctx: Ctx, task: AsanaTask, readAll: boolean): Promise<SourceRecord[]> {
  const recent = readAll || ctx.now - time(task.modified_at, 0) <= COMMENT_WINDOW_MS
  return [taskRecord(ctx, task), ...(recent ? await readComments(ctx, task) : [])]
}

async function fullRead(ctx: Ctx): Promise<SourceRecord[]> {
  const tasks = await readPages<AsanaTask>(
    ctx.input.accessToken,
    'tasks',
    { project: ctx.input.projectGid, opt_fields: TASK_FIELDS },
    { maxItems: ASANA_MAX_TASKS, maxPages: Math.ceil(ASANA_MAX_TASKS / PAGE_SIZE) },
    ctx.input.signal
  )
  return (await mapLimited(tasks, (task) => taskWithComments(ctx, task, false))).flat()
}

/** A fresh sync token: `/events` without one answers 412 with a token in the body. */
async function freshSyncToken(ctx: Ctx): Promise<string> {
  try {
    const page = await asanaGet<EventsPage>(
      ctx.input.accessToken,
      'events',
      { resource: ctx.input.projectGid },
      ctx.input.signal
    )
    if (page.sync) return page.sync
  } catch (error) {
    if (error instanceof AsanaSyncTokenError && error.sync) return error.sync
    throw error
  }
  throw new AsanaRequestError(412)
}

type EventBatch = { sync: string; changedTasks: Set<string>; deleted: Set<string> }

/**
 * Event pages from `token`, at most `ASANA_EVENT_MAX_PAGES`, stopping when Asana has no more or repeats a token.
 * Throws the internal sync-token error when the stored token has expired.
 */
async function readEvents(ctx: Ctx, token: string): Promise<EventBatch> {
  const batch: EventBatch = { sync: token, changedTasks: new Set(), deleted: new Set() }
  const seen = new Set<string>([token])
  for (let pages = 0; pages < ASANA_EVENT_MAX_PAGES; pages++) {
    const page = await asanaGet<EventsPage>(
      ctx.input.accessToken,
      'events',
      { resource: ctx.input.projectGid, sync: batch.sync },
      ctx.input.signal
    )
    for (const event of page.data ?? []) applyEvent(ctx, batch, event)
    const next = page.sync
    if (next) batch.sync = next
    if (!page.has_more || !next || seen.has(next)) break
    seen.add(next)
  }
  return batch
}

function applyEvent(ctx: Ctx, batch: EventBatch, event: AsanaEvent): void {
  const gid = event.resource?.gid
  if (!gid) return
  const type = event.resource?.resource_type
  const action = event.action
  if (type === 'task') {
    const removedHere = action === 'removed' && event.parent?.gid === ctx.input.projectGid
    if (action === 'deleted' || removedHere) {
      batch.deleted.add(gid)
      batch.changedTasks.delete(gid)
    } else {
      batch.changedTasks.add(gid)
      batch.deleted.delete(gid)
    }
    return
  }
  if (type === 'story') {
    if (action === 'deleted' || action === 'removed') batch.deleted.add(gid)
    const parent = event.parent
    if (parent?.resource_type === 'task' && parent.gid && !batch.deleted.has(parent.gid)) {
      // Re-read the task so an added or edited comment comes back with its text.
      if (action !== 'deleted' && action !== 'removed') batch.changedTasks.add(parent.gid)
    }
  }
}

/** Re-reads one task; null when it is gone (404) or no longer in this project. */
async function readTask(ctx: Ctx, gid: string): Promise<AsanaTask | null> {
  try {
    const { data } = await asanaGet<{ data: AsanaTask }>(
      ctx.input.accessToken,
      `tasks/${encodeURIComponent(gid)}`,
      { opt_fields: TASK_FIELDS },
      ctx.input.signal
    )
    return data && inProject(data, ctx.input.projectGid) ? data : null
  } catch (error) {
    if (error instanceof AsanaRequestError && error.status === 404) return null
    throw error
  }
}

/**
 * One poll of one Asana project. With no cursor: a full read (tasks, and comments on tasks modified in the last 90
 * days), with the sync token taken just before it so nothing changed meanwhile is missed. With a cursor: the events
 * since its token; changed tasks are re-read with their comments, and deleted tasks, tasks removed from the
 * project, tasks gone on re-read and deleted comments go to `deletedExternalIds`. An expired token (412), or more
 * changed tasks than `ASANA_MAX_CHANGED_TASKS`, falls back to a full read. Records carry `sourceId` and `scopeId`.
 * The caller stores the cursor. Throws `AsanaAuthError` (sign in again), `AsanaRateLimitedError` or
 * `AsanaRequestError`; on a throw the caller keeps its old cursor.
 */
export async function syncAsanaProject(input: AsanaSyncInput): Promise<AsanaSyncResult> {
  const now = input.now ?? Date.now()
  const ctx: Ctx = { input, now }
  const cursorFor = (value: string): SyncCursor => ({
    accountId: input.accountId,
    sourceKind: 'asana',
    scope: input.projectGid,
    value,
    updatedAt: now,
  })

  if (input.cursor?.value) {
    let batch: EventBatch | null = null
    let expiredWith: string | undefined
    try {
      batch = await readEvents(ctx, input.cursor.value)
    } catch (error) {
      if (!(error instanceof AsanaSyncTokenError)) throw error
      expiredWith = error.sync
    }
    if (batch && batch.changedTasks.size <= ASANA_MAX_CHANGED_TASKS) {
      const deleted = new Set(batch.deleted)
      const tasks = await mapLimited([...batch.changedTasks], async (gid) => {
        const task = await readTask(ctx, gid)
        if (!task) deleted.add(gid)
        return task ? taskWithComments(ctx, task, true) : []
      })
      return { records: tasks.flat(), cursor: cursorFor(batch.sync), deletedExternalIds: [...deleted] }
    }
    const sync = expiredWith ?? batch?.sync ?? (await freshSyncToken(ctx))
    return { records: await fullRead(ctx), cursor: cursorFor(sync), deletedExternalIds: [] }
  }

  const sync = await freshSyncToken(ctx)
  return { records: await fullRead(ctx), cursor: cursorFor(sync), deletedExternalIds: [] }
}
