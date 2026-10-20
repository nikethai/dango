import type { Session } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory storage: the raw chat list and one key per chat.
const disk = vi.hoisted(() => new Map<string, unknown>())
vi.mock('@/storage', () => {
  const storage = {
    getItem: vi.fn((key: string, fallback: unknown) =>
      Promise.resolve(disk.has(key) ? structuredClone(disk.get(key)) : fallback)
    ),
    setItemNow: vi.fn(async (key: string, value: unknown) => {
      await Promise.resolve()
      disk.set(key, structuredClone(value))
    }),
    removeItem: vi.fn(async (key: string) => {
      await Promise.resolve()
      disk.delete(key)
    }),
  }
  return { default: storage, StorageKey: { ChatSessionsList: 'chat-sessions-list' } }
})
vi.mock('@/storage/StoreStorage', () => ({ StorageKeyGenerator: { session: (id: string) => `session:${id}` } }))
vi.mock('@/components/chat/MessageList', () => ({ clearScrollPositionCache: vi.fn() }))
vi.mock('./atoms/throttleWriteSessionAtom', () => ({ cleanupSessionAtomCache: vi.fn() }))
vi.mock('./sessionHelpers', () => ({
  getSessionMeta: (s: Session) => ({ id: s.id, name: s.name, type: s.type }),
}))
vi.mock('./settingsStore', () => ({ settingsStore: { getState: () => ({}) }, useSettingsStore: vi.fn() }))
vi.mock('./lastUsedModelStore', () => ({ lastUsedModelStore: { getState: () => ({}) } }))
vi.mock('./uiStore', () => ({
  uiStore: { getState: () => ({ clearSessionWebBrowsing: vi.fn(), removeSessionKnowledgeBase: vi.fn() }) },
}))
vi.mock('@/stores/taskStore', () => ({ taskStore: { getState: () => ({ clearSessionTasks: vi.fn() }) } }))
vi.mock('../utils/session-utils', () => ({
  migrateSession: (s: Session) => s,
  sortSessions: (list: unknown[]) => list,
}))

import { ChatQueryKeys, deleteSession, getSession, restoreSession } from './chatStore'
import queryClient from './queryClient'

const chat = (id: string): Session =>
  ({
    id,
    name: id.toUpperCase(),
    type: 'chat',
    messages: [{ id: `${id}-m1`, role: 'user', contentParts: [{ type: 'text', text: id }] }],
  }) as unknown as Session

const listIds = () => (disk.get('chat-sessions-list') as { id: string }[]).map((s) => s.id)

beforeEach(() => {
  disk.clear()
  for (const s of [chat('a'), chat('b'), chat('c')]) disk.set(`session:${s.id}`, s)
  disk.set(
    'chat-sessions-list',
    [chat('a'), chat('b'), chat('c')].map((s) => ({ id: s.id, name: s.name }))
  )
})

describe('restoreSession', () => {
  it('puts a deleted chat back with the same id, messages and list position', async () => {
    const b = chat('b')
    const index = await deleteSession('b')
    expect(index).toBe(1)
    expect(listIds()).toEqual(['a', 'c'])
    expect(disk.has('session:b')).toBe(false)

    await restoreSession(b, index)
    expect(listIds()).toEqual(['a', 'b', 'c'])
    // The React Query cache is primed, so the chat paints without a storage read.
    expect(queryClient.getQueryData(ChatQueryKeys.ChatSession('b'))).toEqual(b)
    expect(disk.get('session:b')).toEqual(b)
    expect((await getSession('b'))?.messages).toEqual(b.messages)
  })

  it('clamps the index and appends for -1', async () => {
    await deleteSession('c')
    await restoreSession(chat('c'), 99)
    expect(listIds()).toEqual(['a', 'b', 'c'])
    await deleteSession('a')
    await restoreSession(chat('a'), -1)
    expect(listIds()).toEqual(['b', 'c', 'a'])
  })

  it('deleteSession reports -1 for a chat that is not listed', async () => {
    expect(await deleteSession('zz')).toBe(-1)
  })
})
