// Test-only helpers for the knowledge package. Never import this from app code.
//
// Storage injection (one approach for the whole slice): tests mock `@/storage` with
//   vi.mock('@/storage', async () => (await import('./test-storage')).default)
// The default export is shaped like the `@/storage` module ({ default, StorageKey }), so `store.ts`
// (which lazily imports `@/storage`) and any other module reading `StorageKey` work unchanged.
import type { KnowledgeItem, KnowledgeKind, KnowledgeRevision } from '@shared/types/knowledge'
import { vi } from 'vitest'
import { StorageKey } from '@/storage/StoreStorage'
import { contentHash } from './text'

/** The backing map. Values are stored as clones, so tests can inspect or overwrite them directly. */
export const memory = new Map<string, unknown>()

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v))

export const testStorage = {
  getItem: vi.fn(
    <T>(key: string, initialValue: T): Promise<T> =>
      Promise.resolve(memory.has(key) ? (clone(memory.get(key)) as T) : initialValue)
  ),
  /** Like `StoreStorage.readItem`: the stored value or `null`, never a default write. */
  readItem: vi.fn((key: string): Promise<unknown> => Promise.resolve(memory.has(key) ? clone(memory.get(key)) : null)),
  setItem: vi.fn((key: string, value: unknown): Promise<void> => {
    memory.set(key, clone(value))
    return Promise.resolve()
  }),
  setItemNow: vi.fn((key: string, value: unknown): Promise<void> => {
    memory.set(key, clone(value))
    return Promise.resolve()
  }),
  removeItem: vi.fn((key: string): Promise<void> => {
    memory.delete(key)
    return Promise.resolve()
  }),
  getAllKeys: vi.fn((): Promise<string[]> => Promise.resolve([...memory.keys()])),
}

/** Clears the map and the call history of every storage spy. */
export function resetTestStorage() {
  memory.clear()
  for (const fn of Object.values(testStorage)) fn.mockClear()
}

/** Writes a raw value, bypassing the store (another window, or a hand edit). */
export function putRaw(key: string, value: unknown) {
  memory.set(key, clone(value))
}

/** Reads the raw stored value. */
export function getRaw<T = unknown>(key: string): T | undefined {
  return clone(memory.get(key)) as T | undefined
}

export type MakeItemInput = Partial<Omit<KnowledgeItem, 'revisions' | 'approvedRevisionId'>> & {
  kind?: KnowledgeKind
}

/**
 * An approved item with one user-approved revision whose `contentHash` is real, so health checks
 * treat it as verified. Override any field; `text`, `kind` and `condition` feed the hash.
 */
export async function makeItem(over: MakeItemInput = {}): Promise<KnowledgeItem> {
  const kind = over.kind ?? 'fact'
  const text = over.text ?? 'Launch is 6 Nov'
  const condition = over.condition
  const at = over.createdAt ?? 1_000
  const revision: KnowledgeRevision = {
    id: 'r1',
    text,
    ...(condition !== undefined ? { condition } : {}),
    by: 'user',
    createdAt: at,
    approval: { by: 'user', at, contentHash: await contentHash(kind, text, condition) },
  }
  return {
    id: 'k1',
    scopeId: 'p1',
    sources: [],
    status: 'approved',
    history: [{ at, by: 'user', action: 'approved' }],
    createdAt: at,
    updatedAt: at,
    ...over,
    kind,
    text,
    revisions: [revision],
    approvedRevisionId: revision.id,
  }
}

export default { default: testStorage, StorageKey }
