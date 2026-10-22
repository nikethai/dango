import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { type ConnectedSource, parseSources, type SourceKind } from '@shared/types/sources'
import { useEffect, useMemo } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import i18n from '@/i18n'
import { createLockedQueue } from '@/lib/lockedQueue'
import { listJobs, setJobSourceResolver, stopJob } from '@/packages/background'
import { markSourceRemoved } from '@/packages/knowledge'
import { loadReviewEntries, reviewStore, setReviewEntryState } from '@/packages/review'
import platform from '@/platform'
import { getSourceKind } from './kinds'
import { lastPathSegment } from './kinds/common'
import { forgetReviewState } from './review-state'

/*
 * Connected sources, stored under `StorageKey.Sources` (immediate write, IndexedDB on desktop).
 * Multi-window: in practice only the main window writes sources (sheet, revoke, launch adoption). Every write still
 * re-reads storage under a Web Lock, so it never drops another window's rows. A window that only reads loads once
 * and does not follow later changes made elsewhere.
 */

type SourcesState = { sources: ConnectedSource[]; loaded: boolean }

export const sourcesStore = createStore<SourcesState>()(() => ({ sources: [], loaded: false }))

export type SourceRuleCode = 'folder-everywhere' | 'folder-taken' | 'documents-taken'

// English keys; translated where shown (`sourceRuleErrorText`).
const RULE_MESSAGES: Record<SourceRuleCode, string> = {
  'folder-everywhere': 'Folders belong to a project or client.',
  'folder-taken': 'This scope already has a folder.',
  'documents-taken': 'These documents already belong to {{scope}}.',
}

export class SourceRuleError extends Error {
  code: SourceRuleCode
  /** For `documents-taken`: the scope the collection already belongs to. */
  scopeId?: string
  /** That scope's name (user text), filled in when it could be read. */
  scopeName?: string

  constructor(code: SourceRuleCode, opts?: { scopeId?: string; scopeName?: string }) {
    super(RULE_MESSAGES[code])
    this.name = 'SourceRuleError'
    this.code = code
    this.scopeId = opts?.scopeId
    this.scopeName = opts?.scopeName
  }
}

/** The error's sentence in the current language. */
export function sourceRuleErrorText(error: SourceRuleError): string {
  const scope =
    error.scopeName ?? (error.scopeId === EVERYWHERE_SCOPE_ID ? i18n.t('Everywhere') : (error.scopeId ?? ''))
  return i18n.t(RULE_MESSAGES[error.code], { scope })
}

type SourcesStorage = {
  key: string
  cursorKey(id: string): string
  getItem<T>(key: string, fallback: T): Promise<T>
  setItemNow(key: string, value: unknown): Promise<void>
  removeItem(key: string): Promise<void>
}

// Lazy: `@/storage` reaches the platform when it loads, and tests mock it.
async function getStorage(): Promise<SourcesStorage> {
  const [mod, { StorageKeyGenerator }] = await Promise.all([import('@/storage'), import('@/storage/StoreStorage')])
  const storage = mod.default
  return {
    key: mod.StorageKey.Sources,
    cursorKey: (id) => StorageKeyGenerator.sourceCursor(id),
    getItem: (key, fallback) => storage.getItem(key, fallback),
    setItemNow: (key, value) => storage.setItemNow(key, value),
    removeItem: (key) => storage.removeItem(key),
  }
}

// One read-modify-write at a time, across windows (Web Lock) and within this one.
const enqueue = createLockedQueue('dango:sources')

/** The stored rows (invalid ones dropped one by one), or null when storage could not be read. */
async function readStored(): Promise<ConnectedSource[] | null> {
  try {
    const storage = await getStorage()
    return parseSources(await storage.getItem<unknown>(storage.key, []))
  } catch (error) {
    console.warn('[sources] Could not read sources', error)
    return null
  }
}

export function loadSources(): Promise<void> {
  return enqueue(async () => {
    const stored = await readStored()
    // An unreadable store stays not loaded, so a count of 0 is never shown before it is known (R4).
    if (stored) sourcesStore.setState({ sources: stored, loaded: true })
  })
}

function ensureLoaded(): Promise<void> {
  return sourcesStore.getState().loaded ? Promise.resolve() : loadSources()
}

/** Storage could not be read and this window never loaded its sources: nothing is written then. */
export class SourcesUnreadableError extends Error {
  constructor() {
    super('Sources could not be read')
    this.name = 'SourcesUnreadableError'
  }
}

/**
 * Applies `fn` to the latest list (storage, or this window's loaded list when storage cannot be read), updates this
 * window at once and writes the result. `fn` returns the list it was given to change nothing; nothing is written then.
 * When storage cannot be read and this window never loaded, it rejects with `SourcesUnreadableError` and writes
 * nothing, so an empty list never overwrites the stored sources. A failed write is logged; it never rejects. Errors
 * thrown by `fn` reject and change nothing.
 */
function mutate<T>(fn: (sources: ConnectedSource[]) => { sources: ConnectedSource[]; result: T }): Promise<T> {
  return enqueue(async () => {
    const stored = await readStored()
    if (!stored && !sourcesStore.getState().loaded) throw new SourcesUnreadableError()
    const current = stored ?? sourcesStore.getState().sources
    const { sources, result } = fn(current)
    sourcesStore.setState({ sources, loaded: true })
    if (sources === current) return result
    try {
      const storage = await getStorage()
      await storage.setItemNow(storage.key, sources)
    } catch (error) {
      console.warn('[sources] Could not save sources', error)
    }
    return result
  })
}

/** `mutate` for changes that may be skipped: unreadable storage is logged, not thrown. */
async function mutateOrSkip(
  what: string,
  fn: (sources: ConnectedSource[]) => { sources: ConnectedSource[]; result: undefined }
): Promise<void> {
  try {
    await mutate(fn)
  } catch (error) {
    if (!(error instanceof SourcesUnreadableError)) throw error
    console.warn(`[sources] Skipped ${what}: sources could not be read`, error)
  }
}

/**
 * The source was removed and its removal waits out the undo window, or the next launch (S11, `pending-removal.ts`).
 * It is left out of every list and lookup unless `includePending` asks for it, so nothing shows it or works on it.
 * Callers that decide what may leave the device (local-only sets) or what is pruned include it: an Undo brings it back.
 */
export function isRemovalPending(source: ConnectedSource): boolean {
  return source.removalPendingAt !== undefined
}

type SourceFilter = { scopeId?: string; kind?: SourceKind; includePending?: boolean }

function filterSources(sources: ConnectedSource[], filter?: SourceFilter): ConnectedSource[] {
  return sources.filter(
    (s) =>
      (filter?.scopeId === undefined || s.scopeId === filter.scopeId) &&
      (filter?.kind === undefined || s.kind === filter.kind) &&
      (filter?.includePending === true || !isRemovalPending(s))
  )
}

/** This window's sources matching `filter`, in connection order; sources pending removal only with `includePending`. */
export function listSources(filter?: SourceFilter): ConnectedSource[] {
  return filterSources(sourcesStore.getState().sources, filter)
}

/** The source, unless it is gone or (without `includePending`) pending removal. */
export function getSource(id: string, opts?: { includePending?: boolean }): ConnectedSource | undefined {
  const source = sourcesStore.getState().sources.find((s) => s.id === id)
  return source && (opts?.includePending === true || !isRemovalPending(source)) ? source : undefined
}

function useLoadSources(): boolean {
  const loaded = useStore(sourcesStore, (s) => s.loaded)
  useEffect(() => {
    if (!loaded) void loadSources().catch(() => undefined)
  }, [loaded])
  return loaded
}

export function useSources(filter?: SourceFilter): ConnectedSource[] {
  useLoadSources()
  const sources = useStore(sourcesStore, (s) => s.sources)
  const { scopeId, kind, includePending } = filter ?? {}
  return useMemo(
    () => filterSources(sources, { scopeId, kind, includePending }),
    [sources, scopeId, kind, includePending]
  )
}

/** False until the stored sources have been read once, so a count of 0 is never shown before it is known. */
export function useSourcesLoaded(): boolean {
  return useLoadSources()
}

async function scopeNameOf(scopeId: string): Promise<string | undefined> {
  if (scopeId === EVERYWHERE_SCOPE_ID) return i18n.t('Everywhere')
  try {
    const { readScopes } = await import('@/hooks/useScopes')
    return (await readScopes()).find((s) => s.id === scopeId)?.name
  } catch {
    return undefined
  }
}

function ruleBroken(sources: ConnectedSource[], input: Omit<ConnectedSource, 'id' | 'connectedAt'>) {
  if (input.kind === 'folder') {
    if (input.scopeId === EVERYWHERE_SCOPE_ID) return new SourceRuleError('folder-everywhere')
    if (sources.some((s) => s.kind === 'folder' && s.scopeId === input.scopeId)) {
      return new SourceRuleError('folder-taken')
    }
  }
  const kbId = input.config.kbId
  if (input.kind === 'documents' && kbId !== undefined) {
    const owner = sources.find((s) => s.kind === 'documents' && s.config.kbId === kbId && s.scopeId !== input.scopeId)
    if (owner) return new SourceRuleError('documents-taken', { scopeId: owner.scopeId })
  }
  return null
}

/** Stores a new source. Rejects with `SourceRuleError` when it breaks a rule; nothing is stored then. */
export async function addSource(input: Omit<ConnectedSource, 'id' | 'connectedAt'>): Promise<ConnectedSource> {
  const outcome = await mutate<ConnectedSource | SourceRuleError>((sources) => {
    const broken = ruleBroken(sources, input)
    if (broken) return { sources, result: broken }
    const source: ConnectedSource = { ...input, id: uuidv4(), connectedAt: Date.now() }
    return { sources: [...sources, source], result: source }
  })
  if (!(outcome instanceof SourceRuleError)) return outcome
  if (outcome.scopeId) outcome.scopeName = await scopeNameOf(outcome.scopeId)
  throw outcome
}

/** The source with `patch` applied; a field patched to `undefined` is removed from the row. */
function patched(
  source: ConnectedSource,
  patch: Partial<Omit<ConnectedSource, 'id' | 'kind' | 'connectedAt'>>
): ConnectedSource {
  const next: Record<string, unknown> = { ...source, ...patch, id: source.id, kind: source.kind }
  next.connectedAt = source.connectedAt
  // Background review turned from off to on (D4): it acts only on mail newer than now. Judged against the stored row,
  // so every caller (Settings › Sources, the which-client answer, a stale UI row) gets the same rule; on → off keeps it.
  if (patch.backgroundReview === true && !source.backgroundReview && patch.reviewEnabledAt === undefined) {
    next.reviewEnabledAt = Date.now()
  }
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key]
  return next as ConnectedSource
}

export async function updateSource(
  id: string,
  patch: Partial<Omit<ConnectedSource, 'id' | 'kind' | 'connectedAt'>>
): Promise<void> {
  await mutateOrSkip('a source update', (sources) => ({
    sources: sources.some((s) => s.id === id) ? sources.map((s) => (s.id === id ? patched(s, patch) : s)) : sources,
    result: undefined,
  }))
}

/** Closes the open Review entries (Needs you, Done) of these jobs. */
async function dismissJobEntries(jobIds: Set<string>): Promise<void> {
  if (jobIds.size === 0) return
  try {
    await loadReviewEntries()
    const open = reviewStore
      .getState()
      .entries.filter((e) => e.state === 'open' && e.ref.type === 'job' && jobIds.has(e.ref.id))
    for (const entry of open) {
      await setReviewEntryState({ ref: { type: 'job', id: entry.ref.id } }, 'dismissed')
    }
  } catch (error) {
    console.warn('[sources] Could not close the Review entries of a removed source', error)
  }
}

// Revokes in flight per source id.
const revoking = new Map<string, Promise<void>>()

/**
 * Removes a source: stops its running jobs, runs the kind's `revoke` (a folder is unbound; Integrations accounts and
 * Documents collections are kept), marks its knowledge sources removed (approved knowledge stays), deletes the record
 * and its read cursor, and only then retires its jobs (a job started meanwhile is stopped, a needs-you job becomes
 * stopped) and closes the open Review entries of all of them.
 *
 * If `revoke` or `markSourceRemoved` throws, the call rejects with the record kept and the entries open, so the user
 * can try again; a retry repeats every step (each is idempotent, see `SourceKindDefinition.revoke`).
 */
export function revokeSource(id: string): Promise<void> {
  // One revoke per source at a time: the undo timer and a launch or due check may both finish the same removal.
  const running = revoking.get(id)
  if (running) return running
  const run = revokeNow(id).finally(() => revoking.delete(id))
  revoking.set(id, run)
  return run
}

async function revokeNow(id: string): Promise<void> {
  await ensureLoaded()
  const source = getSource(id, { includePending: true })
  if (!source) return
  // Jobs (and so their Review entries) are matched through this window's job store. Main is the only window that
  // runs jobs and revokes sources, and it has loaded its jobs by then.
  const jobs = listJobs({ sourceId: id })
  const stopped = new Set<string>()
  for (const job of jobs) {
    if (job.status !== 'running') continue
    await stopJob(job.id)
    stopped.add(job.id)
  }
  await getSourceKind(source.kind)?.revoke?.(source)
  await markSourceRemoved(id)
  await mutateOrSkip('removing a source', (sources) => {
    const next = sources.filter((s) => s.id !== id)
    return { sources: next.length === sources.length ? sources : next, result: undefined }
  })
  forgetReviewState(id)
  try {
    const storage = await getStorage()
    await storage.removeItem(storage.cursorKey(id))
  } catch (error) {
    console.warn('[sources] Could not remove the read cursor', error)
  }
  // Read again: a check or a fix may have started a job of this source while `revoke` ran. With the record gone,
  // nothing starts one any more.
  const after = listJobs({ sourceId: id })
  for (const job of after) {
    if (stopped.has(job.id) || (job.status !== 'running' && job.status !== 'needs-you')) continue
    await stopJob(job.id)
  }
  await dismissJobEntries(new Set([...jobs, ...after].map((j) => j.id)))
}

/**
 * For scopes without a folder source, turns a folder binding made before sources existed into a folder source
 * (no background review, no job). Returns how many were added.
 */
export async function adoptExistingFolderBindings(scopeIds: string[]): Promise<number> {
  const restore = platform.restoreProjectBinding?.bind(platform)
  if (!restore) return 0
  await ensureLoaded()
  let added = 0
  for (const scopeId of scopeIds) {
    // A folder source pending removal still owns its binding until the removal finishes (or is undone).
    if (scopeId === EVERYWHERE_SCOPE_ID || listSources({ scopeId, kind: 'folder', includePending: true }).length > 0) {
      continue
    }
    let displayPath: string
    try {
      const descriptor = await restore(scopeId)
      if (descriptor.status === 'chat-only' || descriptor.status === 'unsupported') continue
      displayPath = descriptor.displayPath
    } catch {
      continue
    }
    try {
      await addSource({
        kind: 'folder',
        scopeId,
        label: lastPathSegment(displayPath),
        backgroundReview: false,
        localOnly: false,
        config: { displayPath },
      })
      added += 1
    } catch (error) {
      if (!(error instanceof SourceRuleError)) throw error
    }
  }
  return added
}

/**
 * Tells the background runner about sources: jobs of removed sources cannot be opened from Review, and resumed jobs
 * take their source's label. `initBackgroundJobs` (Task 6) calls this before registering the job opener.
 */
export function registerSourcesResolver(): void {
  setJobSourceResolver({
    exists: (id) => {
      if (!sourcesStore.getState().loaded) {
        void loadSources().catch(() => undefined)
        return true
      }
      return getSource(id) !== undefined
    },
    // A source pending removal cannot be opened, but its jobs keep its name.
    label: (id) => getSource(id, { includePending: true })?.label,
  })
}

export function _resetSourcesForTests(): void {
  sourcesStore.setState({ sources: [], loaded: false })
}
