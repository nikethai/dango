import type { Message, Session } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory chat store over a raw list [a, b, c] (the storage order restoreSession inserts into).
const store = vi.hoisted(() => ({ list: [] as Session[] }))

vi.mock('@/stores/chatStore', () => ({
  getSession: vi.fn((id: string) => Promise.resolve(structuredClone(store.list.find((s) => s.id === id) ?? null))),
  updateSession: vi.fn(async (id: string, patch: Partial<Session> | ((s: Session) => Partial<Session>)) => {
    await Promise.resolve()
    const index = store.list.findIndex((s) => s.id === id)
    if (index < 0) throw new Error(`Session ${id} not found`)
    const current = store.list[index]
    const next = { ...current, ...(typeof patch === 'function' ? patch(current) : patch) }
    store.list[index] = next
    return next
  }),
  deleteSession: vi.fn(async (id: string) => {
    await Promise.resolve()
    const index = store.list.findIndex((s) => s.id === id)
    if (index >= 0) store.list.splice(index, 1)
    return index
  }),
  restoreSession: vi.fn(async (session: Session, index: number) => {
    await Promise.resolve()
    const rest = store.list.filter((s) => s.id !== session.id)
    const at = Math.max(0, Math.min(index, rest.length))
    store.list = [...rest.slice(0, at), structuredClone(session), ...rest.slice(at)]
  }),
}))

const moveSessionToScope = vi.hoisted(() =>
  vi.fn(async (id: string, scopeId: string | undefined) => {
    await Promise.resolve()
    const session = store.list.find((s) => s.id === id)
    if (!session) return false
    session.projectId = scopeId
    session.folderId = scopeId
    return true
  })
)
vi.mock('@/projects/scope-sessions', () => ({ moveSessionToScope }))

vi.mock('@/hooks/useScopes', () => ({
  readScopes: async () => [
    { id: 'p1', name: 'Alpha', kind: 'project' },
    { id: 'p2', name: 'Beta', kind: 'client' },
  ],
}))

const tasks = vi.hoisted(() => ({
  hydrateSessionTasks: vi.fn(async () => undefined),
  getSessionTasks: vi.fn((_id: string) => [{ id: 't1', sessionId: 'b', content: 'x', status: 'pending' }]),
  replaceSessionTasks: vi.fn(),
  flushSessionTasks: vi.fn(async () => undefined),
}))
vi.mock('@/stores/taskStore', () => ({
  taskStore: {
    getState: () => ({
      hydrateSessionTasks: tasks.hydrateSessionTasks,
      getSessionTasks: tasks.getSessionTasks,
      replaceSessionTasks: tasks.replaceSessionTasks,
    }),
  },
  flushSessionTasks: tasks.flushSessionTasks,
}))

// The real 1b undo store, with pushUndo spied so tests can read the entry it was given.
vi.mock('@/packages/undo', async () => {
  const real = await vi.importActual<typeof import('@/packages/undo/undo')>('@/packages/undo/undo')
  return { ...real, pushUndo: vi.fn(real.pushUndo) }
})
// Stop marks the generating message done (partial text kept), as the real stopChatIfRunning does; which runs count
// (a marked message or a registered run) is covered in stop-generation.test.ts.
const stopChatIfRunning = vi.hoisted(() =>
  vi.fn(async (sessionId: string, _given?: Session | null) => {
    await Promise.resolve()
    const session = store.list.find((s) => s.id === sessionId)
    if (!session?.messages.some((m) => m.generating)) return false
    session.messages = session.messages.map((m) => (m.generating ? { ...m, generating: false } : m))
    return true
  })
)
vi.mock('./stop-generation', () => ({ stopChatIfRunning }))

const toastAdd = vi.hoisted(() => vi.fn())
vi.mock('@/stores/toastActions', () => ({ add: toastAdd }))
vi.mock('@/lib/utils', () => ({ getLogger: () => ({ error: vi.fn(), info: vi.fn(), debug: vi.fn() }) }))
vi.mock('i18next', () => ({
  t: (key: string, vars?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars?.[name] ?? '')),
}))

import { pushUndo, resetUndoForTests, undoLatest } from '@/packages/undo'
import { archiveChatWithUndo, deleteChatWithUndo, moveChatWithUndo, moveChatWithUndoOrToast } from './chat-menu-actions'

const msg = (id: string, text: string): Message =>
  ({ id, role: 'user', contentParts: [{ type: 'text', text }] }) as unknown as Message

const chat = (id: string, name: string, extra: Partial<Session> = {}): Session =>
  ({ id, name, type: 'chat', messages: [msg(`${id}-m1`, `hello ${name}`)], ...extra }) as Session

const lastUndo = () => vi.mocked(pushUndo).mock.calls.at(-1)?.[0]

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  resetUndoForTests()
  vi.mocked(pushUndo).mockClear()
  moveSessionToScope.mockClear()
  stopChatIfRunning.mockClear()
  for (const fn of Object.values(tasks)) fn.mockClear()
  store.list = [chat('a', 'A', { projectId: 'p1', folderId: 'p1' }), chat('b', 'B'), chat('c', 'C')]
})

afterEach(() => {
  vi.useRealTimers()
})

describe('deleteChatWithUndo', () => {
  it('undo restores position and messages', async () => {
    const before = structuredClone(store.list[1])
    const result = await deleteChatWithUndo('b')
    expect(result).toEqual({ name: 'B' })
    expect(store.list.map((s) => s.id)).toEqual(['a', 'c'])
    expect(lastUndo()?.message).toBe('Deleted "B"')

    await lastUndo()?.undo()
    expect(store.list.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(store.list[1].id).toBe('b')
    expect(store.list[1].messages).toEqual(before.messages)
  })

  it('undo brings back the chat’s task checklist', async () => {
    await deleteChatWithUndo('b')
    expect(tasks.hydrateSessionTasks).toHaveBeenCalledWith('b')
    await lastUndo()?.undo()
    expect(tasks.replaceSessionTasks).toHaveBeenCalledWith('b', [
      { id: 't1', sessionId: 'b', content: 'x', status: 'pending' },
    ])
    expect(tasks.flushSessionTasks).toHaveBeenCalledWith('b')
  })

  it('undo expires', async () => {
    await deleteChatWithUndo('b')
    vi.advanceTimersByTime(5_001)
    expect(await undoLatest()).toBe(false)
    expect(store.list.map((s) => s.id)).toEqual(['a', 'c'])
  })

  it('deleting a generating chat stops it first and undo restores it stopped', async () => {
    const answer = { ...msg('b-a1', 'partial answer'), role: 'assistant', generating: true } as Message
    store.list[1].messages.push(answer)
    await deleteChatWithUndo('b')
    expect(stopChatIfRunning).toHaveBeenCalledTimes(1)
    expect(stopChatIfRunning.mock.calls[0][0]).toBe('b')
    expect(stopChatIfRunning.mock.calls[0][1]?.id).toBe('b')
    expect(store.list.map((s) => s.id)).toEqual(['a', 'c'])

    await lastUndo()?.undo()
    const restored = store.list[1]
    expect(restored.id).toBe('b')
    const restoredAnswer = restored.messages.find((m) => m.id === 'b-a1')
    expect(restoredAnswer?.generating).toBe(false)
    expect(restoredAnswer?.contentParts).toEqual(answer.contentParts)
  })

  it('always asks the shared Stop, which also covers a run only the cancel registry knows about', async () => {
    await deleteChatWithUndo('b')
    expect(stopChatIfRunning).toHaveBeenCalledTimes(1)
    expect(stopChatIfRunning.mock.calls[0][0]).toBe('b')
    expect(store.list.map((s) => s.id)).toEqual(['a', 'c'])
  })

  it('returns null and offers no undo for a chat that is gone', async () => {
    expect(await deleteChatWithUndo('zz')).toBeNull()
    expect(pushUndo).not.toHaveBeenCalled()
  })
})

describe('archiveChatWithUndo', () => {
  it('flips archived and its undo flips it back', async () => {
    expect(await archiveChatWithUndo('a')).toEqual({ name: 'A', archived: true })
    expect(store.list[0].archived).toBe(true)
    expect(lastUndo()?.message).toBe('Archived "A"')
    await lastUndo()?.undo()
    expect(store.list[0].archived).toBe(false)
  })

  it('unarchives an archived chat', async () => {
    store.list[2].archived = true
    expect(await archiveChatWithUndo('c')).toEqual({ name: 'C', archived: false })
    expect(lastUndo()?.message).toBe('Unarchived "C"')
    await lastUndo()?.undo()
    expect(store.list[2].archived).toBe(true)
  })
})

describe('moveChatWithUndo', () => {
  it('moves to the scope and undo moves it back to the previous one', async () => {
    expect(await moveChatWithUndo('a', 'p2')).toEqual({ name: 'A', scopeName: 'Beta' })
    expect(moveSessionToScope).toHaveBeenCalledWith('a', 'p2')
    expect(lastUndo()?.message).toBe('Moved to Beta')
    await lastUndo()?.undo()
    expect(moveSessionToScope).toHaveBeenLastCalledWith('a', 'p1')
  })

  it('undo of a chat that had no scope moves it back to none', async () => {
    await moveChatWithUndo('b', 'p2')
    await lastUndo()?.undo()
    expect(moveSessionToScope).toHaveBeenLastCalledWith('b', undefined)
  })

  it('moving to None says which scope it left', async () => {
    await moveChatWithUndo('a', undefined)
    expect(moveSessionToScope).toHaveBeenCalledWith('a', undefined)
    expect(lastUndo()?.message).toBe('Moved out of Alpha')
  })

  it('a scope missing from the list (removed meanwhile) never reads "Moved to No scope"', async () => {
    expect(await moveChatWithUndo('b', 'gone')).not.toBeNull()
    const message = lastUndo()?.message
    expect(message).not.toContain('No scope')
    expect(message).toBe('Moved "B"')
  })

  it('a refused move (Everywhere) pushes no undo', async () => {
    moveSessionToScope.mockResolvedValueOnce(false)
    expect(await moveChatWithUndo('a', 'everywhere')).toBeNull()
    expect(pushUndo).not.toHaveBeenCalled()
  })

  it('moving to the scope it is already in does nothing', async () => {
    expect(await moveChatWithUndo('a', 'p1')).toBeNull()
    expect(moveSessionToScope).not.toHaveBeenCalled()
    expect(pushUndo).not.toHaveBeenCalled()
  })
})

describe('moveChatWithUndoOrToast', () => {
  it('moves with undo and reports success', async () => {
    expect(await moveChatWithUndoOrToast('b', 'p1')).toBe(true)
    expect(lastUndo()?.message).toBe('Moved to Alpha')
  })

  it('toasts instead of throwing when the move fails', async () => {
    toastAdd.mockClear()
    moveSessionToScope.mockRejectedValueOnce(new Error('disk'))
    expect(await moveChatWithUndoOrToast('b', 'p1')).toBe(false)
    expect(toastAdd).toHaveBeenCalledWith("Couldn't move this chat. Try again.")
    expect(pushUndo).not.toHaveBeenCalled()
  })
})
