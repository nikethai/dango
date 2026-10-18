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
type KnowledgeStoreState = {
  state: KnowledgeState
  migration: KnowledgeMigrationState
  /** Approved items whose content no longer matches their approval; answers leave them out (set by the health check). */
  unverified: Set<string>
}

export const knowledgeStore = createStore<KnowledgeStoreState>()(() => ({
  state: emptyKnowledgeState(),
  migration: 'unknown',
  unverified: new Set<string>(),
}))

export type CommitResult = {
  touched: { items: string[]; proposals: string[]; conflicts: string[] }
  /** True for the commit a `revert()` makes, so listeners can reopen what it brings back. */
  reverted: boolean
  /** Puts back this commit's pre-images onto a fresh read, as an ordinary commit. */
  revert: () => Promise<void>
}
/** `before` is the document the commit read, so a listener can see what a deleted record pointed at. */
export type KnowledgeCommitListener = (
  r: CommitResult,
  after: KnowledgeState,
  before: KnowledgeState
) => void | Promise<void>

type KnowledgeStorage = {
  /** The stored value or `null`; never writes a default (see `BaseStorage.readItem`). */
  readItem(key: string): Promise<unknown>
  getAllKeys(): Promise<string[]>
  setItemNow(key: string, value: unknown): Promise<void>
}

/** The stored document is there but does not read as one: loads keep the last state and commits refuse to run. */
export class KnowledgeUnreadableError extends Error {
  constructor(detail: string) {
    super(`Stored knowledge is unreadable (${detail}); nothing is written until it reads again`)
    this.name = 'KnowledgeUnreadableError'
  }
}

// Tests mock `@/storage` with `./test-storage` (see there). Lazy so importing this module stays platform-free.
async function getStorage(): Promise<KnowledgeStorage> {
  const mod = await import('@/storage')
  return mod.default as KnowledgeStorage
}

// One commit at a time, across windows (Web Lock) and within this one (queue).
const enqueue = createLockedQueue('dango:knowledge')

/**
 * The stored document, read without a default write. A missing key is an empty document. A value that is not
 * an object, or a listed key that reads `null` (the platform could not parse it), throws
 * `KnowledgeUnreadableError`: a load then keeps the last state, and a commit (which reads first) writes nothing,
 * so a corrupt document is never replaced by an empty one.
 */
async function readState(storage: KnowledgeStorage): Promise<KnowledgeState> {
  const raw = await storage.readItem(KEY)
  if (raw === null || raw === undefined) {
    if ((await storage.getAllKeys()).includes(KEY)) throw new KnowledgeUnreadableError('stored value does not parse')
    return emptyKnowledgeState()
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new KnowledgeUnreadableError('not an object')
  return KnowledgeStateSchema.parse(raw)
}

async function readMigration(storage: KnowledgeStorage): Promise<'pending' | 'done' | undefined> {
  const raw = (await storage.readItem(MIGRATION_KEY)) as { state?: unknown } | null | undefined
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

/**
 * Loads the document once per window; `fresh` re-reads it (another window may have written). Each load
 * also reads the migration state (preflight C10) and then runs the health check (preflight C9).
 */
export function ensureKnowledgeLoaded(opts?: { fresh?: boolean }): Promise<void> {
  if (loaded && !opts?.fresh) return Promise.resolve()
  if (loading && !opts?.fresh) return loading
  const load = enqueue(async () => {
    const storage = await getStorage()
    const state = await readState(storage)
    const migration = await readMigration(storage)
    knowledgeStore.setState((s) => ({ state, migration: migration ?? s.migration }))
    loaded = true
  })
  // The scope snapshot that `getScopeReads` and `scopeName` read (preflight C2). Lazy: it pulls in jotai
  // and the scope atoms. A failed scope read keeps the last snapshot and never fails the load.
  const scopes = import('./scopes')
    .then((m) => m.refreshScopes())
    .catch((error) => log.error('Knowledge scope refresh failed:', error))
  // Lazy: `for-turn` imports this module. A failed check is logged and never fails the load, but it fails
  // closed: every approved item counts as unverified, so nothing unchecked reaches an answer.
  const health = load.then(() =>
    import('./for-turn')
      .then((m) => m.checkKnowledgeHealth())
      .catch((error) => {
        log.error('Knowledge health check failed:', error)
        knowledgeStore.setState((s) => ({
          unverified: new Set(s.state.items.filter((i) => i.status === 'approved').map((i) => i.id)),
        }))
      })
  )
  const run = Promise.all([health, scopes]).then(() => undefined)
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
export function commitKnowledge(mutate: (draft: KnowledgeState) => void): Promise<CommitResult> {
  return runCommit(mutate, false)
}

/** Each commit's pre-images, by its `revert`, so `revertCommits` can undo several commits as one. */
const preImagesOf = new WeakMap<() => Promise<void>, PreImages>()

/**
 * Reverts several commits in one commit: pass their `revert`s in the order the commits ran. The newest is
 * restored first, so an older commit's pre-image wins for a record both touched. The commit reports every
 * record the reverted commits touched, so listeners settle records that came and went between them too.
 */
export async function revertCommits(reverts: Array<() => Promise<void>>): Promise<void> {
  const pres = reverts.map((r) => {
    const pre = preImagesOf.get(r)
    if (!pre) throw new Error('revertCommits: not a commit revert')
    return pre
  })
  await runCommit(
    (draft) => {
      for (const pre of [...pres].reverse()) {
        for (const c of COLLECTIONS) restoreCollection(c, draft, pre[c] as Map<string, never>)
      }
    },
    true,
    pres
  )
}

async function runCommit(
  mutate: (draft: KnowledgeState) => void,
  reverted: boolean,
  alsoTouched: PreImages[] = []
): Promise<CommitResult> {
  const { pre, after, before } = await enqueue(async () => {
    const storage = await getStorage()
    const before = await readState(storage)
    // The recipe's return value never reaches immer: `(d) => d.items.push(x)` returns a number, and an
    // async recipe returns a Promise; immer would treat either as a replacement document.
    let returned: unknown
    const next = produce(before, (d: Draft<KnowledgeState>) => {
      returned = mutate(d as KnowledgeState)
    })
    if (returned instanceof Promise) throw new Error('commitKnowledge: mutate must be synchronous')
    const changes = diff(before, next)
    await storage.setItemNow(KEY, next)
    knowledgeStore.setState({ state: next })
    loaded = true
    return { pre: changes, after: next, before }
  })

  const keysOf = (c: 'items' | 'proposals' | 'conflicts') => [
    ...new Set([...pre[c].keys(), ...alsoTouched.flatMap((p) => [...p[c].keys()])]),
  ]
  const result: CommitResult = {
    touched: { items: keysOf('items'), proposals: keysOf('proposals'), conflicts: keysOf('conflicts') },
    reverted,
    revert: async () => {
      await runCommit((draft) => {
        for (const c of COLLECTIONS) restoreCollection(c, draft, pre[c] as Map<string, never>)
      }, true)
    },
  }
  preImagesOf.set(result.revert, pre)

  for (const listener of [...listeners]) {
    try {
      await listener(result, after, before)
    } catch (error) {
      log.error('Knowledge commit listener failed:', error)
    }
  }
  return result
}

/** What the one-time move of old memory stores under `knowledge-migration` when it finishes. */
export type KnowledgeMigrationRecord = {
  state: 'done'
  at: number
  counts: { everywhere: number; prompts: number; leftOut: number }
}

/** The stored migration state, or `undefined` when nothing is stored yet. A stored state also sets the store's `migration`. */
export function readKnowledgeMigration(): Promise<'pending' | 'done' | undefined> {
  return enqueue(async () => {
    const migration = await readMigration(await getStorage())
    if (migration) knowledgeStore.setState({ migration })
    return migration
  })
}

/** Marks the move done: writes the record on the knowledge lock (preflight C4), then the store's `migration`. */
export function writeKnowledgeMigrationDone(record: KnowledgeMigrationRecord): Promise<void> {
  return enqueue(async () => {
    await (await getStorage()).setItemNow(MIGRATION_KEY, record)
    knowledgeStore.setState({ migration: 'done' })
  })
}

/** Records in the store (not storage) that a move is waiting for the user. A stored `done` wins. */
export function markKnowledgeMigrationPending(): void {
  knowledgeStore.setState((s) => (s.migration === 'done' ? s : { migration: 'pending' }))
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
  knowledgeStore.setState({ state: emptyKnowledgeState(), migration: 'unknown', unverified: new Set() })
}
