import {
  REVIEW_RETENTION_MS,
  type ReviewEntry,
  type ReviewEntryInput,
  ReviewEntrySchema,
  type ReviewRef,
  type ReviewState,
  WAITING_KINDS,
} from '@shared/types/review'
import { v4 as uuidv4 } from 'uuid'
import { createStore } from 'zustand/vanilla'
import { createLockedQueue } from '@/lib/lockedQueue'

const KEY = 'review-entries'

type ReviewStorage = {
  getItem<T>(key: string, fallback: T): Promise<T>
  setItemNow(key: string, value: unknown): Promise<void>
}
type Doc = { entries: ReviewEntry[]; lastCheckedAt?: number }
type State = { entries: ReviewEntry[]; lastCheckedAt?: number; loaded: boolean }

export const reviewStore = createStore<State>()(() => ({ entries: [], lastCheckedAt: undefined, loaded: false }))

let override: ReviewStorage | null = null
export function setReviewStorageForTests(api: ReviewStorage | null) {
  override = api
}

async function getStorage(): Promise<ReviewStorage> {
  if (override) return override
  // Lazy so importing this module stays cheap and platform-free until first use.
  const mod = await import('@/storage')
  return mod.default as ReviewStorage
}

// Every mutation runs here, one at a time and across windows, and re-reads storage first so rows
// written by another window or before load are never overwritten.
const enqueue = createLockedQueue('dango:review-entries')

async function readDoc(storage: ReviewStorage): Promise<Doc> {
  const raw = await storage.getItem<Partial<Doc> | null>(KEY, null)
  const now = Date.now()
  const entries: ReviewEntry[] = []
  for (const r of Array.isArray(raw?.entries) ? raw.entries : []) {
    const parsed = ReviewEntrySchema.safeParse(r)
    if (!parsed.success) continue
    const e = parsed.data
    if (e.state !== 'open' && now - (e.resolvedAt ?? e.createdAt) > REVIEW_RETENTION_MS) continue
    entries.push(e)
  }
  return { entries, lastCheckedAt: typeof raw?.lastCheckedAt === 'number' ? raw.lastCheckedAt : undefined }
}

function mutate<T>(fn: (doc: Doc) => T): Promise<T> {
  return enqueue(async () => {
    const storage = await getStorage()
    const doc = await readDoc(storage)
    const result = fn(doc)
    await storage.setItemNow(KEY, doc)
    reviewStore.setState({ entries: doc.entries, lastCheckedAt: doc.lastCheckedAt, loaded: true })
    return result
  })
}

export function loadReviewEntries(): Promise<void> {
  return enqueue(async () => {
    const doc = await readDoc(await getStorage())
    reviewStore.setState({ entries: doc.entries, lastCheckedAt: doc.lastCheckedAt, loaded: true })
  })
}

const NEVER_AUTO_REFS: readonly ReviewRef['type'][] = ['proposal', 'conflict', 'knowledge']

/** Cheap, dependency-free check for whether a new row could arrive done; applier and Trust are checked later. */
export function isArrivalCandidate(e: Pick<ReviewEntry, 'kind' | 'risk' | 'ref'>): boolean {
  return e.kind === 'proposal' && e.risk === 'safe' && !NEVER_AUTO_REFS.includes(e.ref.type)
}

export async function addReviewEntry(input: ReviewEntryInput): Promise<ReviewEntry> {
  const { entry, created } = await mutate((doc) => {
    const open = doc.entries.find(
      (e) => e.state === 'open' && e.ref.type === input.ref.type && e.ref.id === input.ref.id
    )
    if (open) {
      const merged: ReviewEntry = {
        ...input,
        id: open.id,
        createdAt: open.createdAt,
        state: input.state ?? 'open',
      }
      doc.entries = doc.entries.map((e) => (e === open ? merged : e))
      return { entry: merged, created: false }
    }
    const made: ReviewEntry = {
      ...input,
      id: input.id ?? uuidv4(),
      state: input.state ?? 'open',
      createdAt: input.createdAt ?? Date.now(),
    }
    doc.entries = [...doc.entries, made]
    return { entry: made, created: true }
  })
  // Phase two runs outside the lock: only a row this call created may arrive done, never a merge (flow 13).
  if (!created) return entry
  if (!isArrivalCandidate(entry)) return entry
  const trust = await import('./trust')
  if (!trust.getReviewApplier(entry.ref.type)) return entry
  try {
    return await trust.arrive(entry, await trust.getTrustLevel(), Date.now())
  } catch {
    return entry
  }
}

export function updateReviewEntry(
  id: string,
  patch: Partial<Omit<ReviewEntry, 'id'>>
): Promise<ReviewEntry | undefined> {
  return mutate((doc) => {
    const found = doc.entries.find((e) => e.id === id)
    if (!found) return undefined
    const next: ReviewEntry = { ...found, ...patch, id }
    doc.entries = doc.entries.map((e) => (e === found ? next : e))
    return next
  })
}

export function setReviewEntryState(
  match: { id: string } | { ref: ReviewRef },
  state: ReviewState
): Promise<ReviewEntry | undefined> {
  return mutate((doc) => {
    let found: ReviewEntry | undefined
    if ('id' in match) {
      found = doc.entries.find((e) => e.id === match.id)
    } else {
      for (const e of doc.entries) {
        if (e.ref.type === match.ref.type && e.ref.id === match.ref.id && (!found || e.createdAt >= found.createdAt)) {
          found = e
        }
      }
    }
    if (!found) return undefined
    const { resolvedAt: _r, undoUntil: _u, ...rest } = found
    const next: ReviewEntry = state === 'open' ? { ...rest, state } : { ...found, state, resolvedAt: Date.now() }
    doc.entries = doc.entries.map((e) => (e === found ? next : e))
    return next
  })
}

export function setLastCheckedAt(ts: number): Promise<void> {
  return mutate((doc) => {
    doc.lastCheckedAt = ts
  })
}

export function listReviewEntries(opts?: { scopeId?: string; states?: ReviewState[] }): ReviewEntry[] {
  return reviewStore
    .getState()
    .entries.filter(
      (e) => (!opts?.scopeId || e.scopeId === opts.scopeId) && (!opts?.states || opts.states.includes(e.state))
    )
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function subscribeReviewEntries(cb: (entries: ReviewEntry[]) => void): () => void {
  return reviewStore.subscribe((s, prev) => {
    if (s.entries !== prev.entries) cb(s.entries)
  })
}

export function waitingCount(entries: ReviewEntry[]): number {
  return entries.filter((e) => e.state === 'open' && WAITING_KINDS.includes(e.kind)).length
}
