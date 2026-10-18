import { emptyKnowledgeState, type KnowledgeState, KnowledgeStateSchema } from '@shared/types/knowledge'
import { type Draft, produce } from 'immer'
import isEqual from 'lodash/isEqual'
import { createStore } from 'zustand/vanilla'
import { createLockedQueue } from '@/lib/lockedQueue'
import { getLogger } from '@/lib/utils'

const log = getLogger('knowledge')

const KEY = 'knowledge'
const MIGRATION_KEY = 'knowledge-migration'

export type KnowledgeMigrationState = 'unknown' | 'pending' | 'done'
type KnowledgeStoreState = { state: KnowledgeState; migration: KnowledgeMigrationState }

export const knowledgeStore = createStore<KnowledgeStoreState>()(() => ({
  state: emptyKnowledgeState(),
  migration: 'unknown',
}))

export type CommitResult = {
  touched: { items: string[]; proposals: string[]; conflicts: string[] }
  /** Puts back this commit's pre-images onto a fresh read, as an ordinary commit. */
  revert: () => Promise<void>
}
export type KnowledgeCommitListener = (r: CommitResult, after: KnowledgeState) => void | Promise<void>

type KnowledgeStorage = {
  getItem<T>(key: string, fallback: T): Promise<T>
  setItemNow(key: string, value: unknown): Promise<void>
}

// Tests mock `@/storage` with `./test-storage` (see there). Lazy so importing this module stays platform-free.
async function getStorage(): Promise<KnowledgeStorage> {
  const mod = await import('@/storage')
  return mod.default as KnowledgeStorage
}

// One commit at a time, across windows (Web Lock) and within this one (queue).
const enqueue = createLockedQueue('dango:knowledge')

async function readState(storage: KnowledgeStorage): Promise<KnowledgeState> {
  const raw = await storage.getItem<unknown>(KEY, null)
  return raw && typeof raw === 'object' ? KnowledgeStateSchema.parse(raw) : emptyKnowledgeState()
}

async function readMigration(storage: KnowledgeStorage): Promise<KnowledgeMigrationState | undefined> {
  const raw = await storage.getItem<{ state?: unknown } | null>(MIGRATION_KEY, null)
  const s = raw?.state
  return s === 'done' || s === 'pending' ? s : undefined
}

// ---- Record identity per collection (preflight C15) ----

type Collection = Exclude<keyof KnowledgeState, 'version'>
type RecordOf<C extends Collection> = KnowledgeState[C][number]

const RECORD_KEY: { [C in Collection]: (r: RecordOf<C>) => string } = {
  items: (r) => r.id,
  proposals: (r) => r.id,
  conflicts: (r) => r.id,
  uses: (r) => JSON.stringify([r.itemId, r.ref.type, r.ref.id]),
  dontSuggest: (r) => r.id,
  dismissals: (r) => JSON.stringify([r.textKey, r.scopeId, r.at]),
}
const COLLECTIONS = Object.keys(RECORD_KEY) as Collection[]

/** Per collection: key → the record before the commit, or `undefined` when the commit created it. */
type PreImages = { [C in Collection]: Map<string, RecordOf<C> | undefined> }

function byKey<C extends Collection>(c: C, records: RecordOf<C>[]): Map<string, RecordOf<C>> {
  const map = new Map<string, RecordOf<C>>()
  for (const r of records) {
    const k = RECORD_KEY[c](r)
    if (!map.has(k)) map.set(k, r)
  }
  return map
}

function diffCollection<C extends Collection>(c: C, before: KnowledgeState, after: KnowledgeState) {
  const pre = new Map<string, RecordOf<C> | undefined>()
  const b = byKey(c, before[c] as RecordOf<C>[])
  const a = byKey(c, after[c] as RecordOf<C>[])
  for (const k of new Set([...b.keys(), ...a.keys()])) {
    const was = b.get(k)
    const now = a.get(k)
    if (was === now || (was && now && isEqual(was, now))) continue
    pre.set(k, was)
  }
  return pre
}

function diff(before: KnowledgeState, after: KnowledgeState): PreImages {
  const out = {} as Record<Collection, Map<string, unknown>>
  for (const c of COLLECTIONS) out[c] = diffCollection(c, before, after)
  return out as PreImages
}

function restoreCollection<C extends Collection>(
  c: C,
  draft: KnowledgeState,
  pre: Map<string, RecordOf<C> | undefined>
) {
  const key = RECORD_KEY[c]
  let records = draft[c] as RecordOf<C>[]
  for (const [k, was] of pre) {
    if (was === undefined) {
      records = records.filter((r) => key(r) !== k)
      continue
    }
    const i = records.findIndex((r) => key(r) === k)
    if (i >= 0) records = records.map((r, j) => (j === i ? was : r))
    else records = [...records, was]
  }
  ;(draft as Record<C, RecordOf<C>[]>)[c] = records
}

// ---- Load, commit, listen ----

let loaded = false
let loading: Promise<void> | null = null
const listeners = new Set<KnowledgeCommitListener>()

/** Loads the document once per window; `fresh` re-reads it (another window may have written). */
export function ensureKnowledgeLoaded(opts?: { fresh?: boolean }): Promise<void> {
  if (loaded && !opts?.fresh) return Promise.resolve()
  if (loading && !opts?.fresh) return loading
  const run = enqueue(async () => {
    const storage = await getStorage()
    const state = await readState(storage)
    const migration = await readMigration(storage)
    knowledgeStore.setState((s) => ({ state, migration: migration ?? s.migration }))
    loaded = true
  })
  loading = run
  run
    .catch(() => undefined)
    .finally(() => {
      if (loading === run) loading = null
    })
  return run
}

/**
 * Reads the document fresh from storage, applies `mutate` with immer, writes the whole document with
 * `setItemNow`, updates the store, then calls the commit listeners (outside the lock, so a listener may
 * commit again). `revert` restores this commit's records only, so later commits by others survive.
 */
export async function commitKnowledge(mutate: (draft: KnowledgeState) => void): Promise<CommitResult> {
  const { pre, after } = await enqueue(async () => {
    const storage = await getStorage()
    const before = await readState(storage)
    const next = produce(before, mutate as (d: Draft<KnowledgeState>) => void)
    // immer would resolve an async recipe later; the write below must see the finished document.
    if (next instanceof Promise) throw new Error('commitKnowledge: mutate must be synchronous')
    const changes = diff(before, next)
    await storage.setItemNow(KEY, next)
    knowledgeStore.setState({ state: next })
    loaded = true
    return { pre: changes, after: next }
  })

  const result: CommitResult = {
    touched: {
      items: [...pre.items.keys()],
      proposals: [...pre.proposals.keys()],
      conflicts: [...pre.conflicts.keys()],
    },
    revert: async () => {
      await commitKnowledge((draft) => {
        for (const c of COLLECTIONS) restoreCollection(c, draft, pre[c] as Map<string, never>)
      })
    },
  }

  for (const listener of [...listeners]) {
    try {
      await listener(result, after)
    } catch (error) {
      log.error('Knowledge commit listener failed:', error)
    }
  }
  return result
}

export function onKnowledgeCommit(listener: KnowledgeCommitListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function _resetKnowledgeForTests(): void {
  loaded = false
  loading = null
  listeners.clear()
  knowledgeStore.setState({ state: emptyKnowledgeState(), migration: 'unknown' })
}
