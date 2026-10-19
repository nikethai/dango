import type { Message, Session } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory chat store: the real fork and copy code runs over it.
const store = vi.hoisted(() => ({ list: [] as Session[], nextId: 0 }))

vi.mock('@/stores/chatStore', () => {
  const find = (id: string) => store.list.find((s) => s.id === id) ?? null
  return {
    getSession: vi.fn(async (id: string) => structuredClone(find(id))),
    updateSessionWithMessages: vi.fn(
      async (id: string, updater: Partial<Session> | ((s: Session | null) => Session)) => {
        await Promise.resolve()
        const index = store.list.findIndex((s) => s.id === id)
        const current = index >= 0 ? structuredClone(store.list[index]) : null
        const next = typeof updater === 'function' ? updater(current) : { ...(current as Session), ...updater }
        if (index >= 0) store.list[index] = next
        return next
      }
    ),
    createSession: vi.fn(async (session: Omit<Session, 'id'>) => {
      await Promise.resolve()
      const created = { ...structuredClone(session), id: `copy-${++store.nextId}` } as Session
      store.list.push(created)
      return created
    }),
  }
})

// Sending and generating are recorded, not run: the user turn lands at the end of the list as the real send does.
const calls = vi.hoisted(() => ({
  submitted: [] as Message[],
  generated: [] as string[],
  generatedAfter: [] as string[],
  stopped: [] as string[],
}))
vi.mock('./messages', () => ({
  submitNewUserMessage: vi.fn(async (sessionId: string, params: { newUserMsg: Message; needGenerating: boolean }) => {
    await Promise.resolve()
    const session = store.list.find((s) => s.id === sessionId)
    session?.messages.push(params.newUserMsg)
    calls.submitted.push(params.newUserMsg)
    if (params.needGenerating) calls.generated.push(sessionId)
  }),
  // As the real insertMessageAfter: into whichever list (current or an older thread) holds the previous message.
  insertMessageAfter: vi.fn(async (sessionId: string, inserted: Message, afterId: string) => {
    await Promise.resolve()
    const session = store.list.find((s) => s.id === sessionId)
    if (!session) return
    for (const list of [session.messages, ...(session.threads ?? []).map((t) => t.messages)]) {
      const at = list.findIndex((m) => m.id === afterId)
      if (at >= 0) {
        list.splice(at + 1, 0, inserted)
        return
      }
    }
  }),
  modifyMessage: vi.fn(async (sessionId: string, updated: Message) => {
    await Promise.resolve()
    const session = store.list.find((s) => s.id === sessionId)
    if (!session) return
    session.messages = session.messages.map((m) => (m.id === updated.id ? updated : m))
  }),
}))
vi.mock('./generation', async () => {
  const { createNewFork } = await import('./forks')
  return {
    // Same shape as the real generateMoreInNewFork: fork at the message, then answer below it.
    generateMoreInNewFork: vi.fn(async (sessionId: string, msgId: string) => {
      await createNewFork(sessionId, msgId)
      calls.generated.push(sessionId)
    }),
    generateMore: vi.fn(async (sessionId: string, msgId: string) => {
      await Promise.resolve()
      calls.generated.push(sessionId)
      calls.generatedAfter.push(msgId)
    }),
  }
})
vi.mock('./stop-generation', () => ({
  stopChatIfRunning: vi.fn(async (sessionId: string) => {
    await Promise.resolve()
    calls.stopped.push(sessionId)
    return false
  }),
}))

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@/router', () => ({ router: { navigate } }))
vi.mock('../scrollActions', () => ({ clearAutoScroll: vi.fn() }))
vi.mock('../sessionHelpers', () => ({ initEmptyChatSession: vi.fn(), initEmptyPictureSession: vi.fn() }))
vi.mock('i18next', () => ({
  t: (key: string, vars?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars?.[name] ?? '')),
}))

import { branchChatFromMessage } from './branch'
import { editAndResend } from './edit-resend'

const msg = (id: string, role: Message['role'], text: string, extra: Partial<Message> = {}): Message =>
  ({ id, role, contentParts: [{ type: 'text', text }], ...extra }) as Message

const textOf = (m: Message | undefined) => m?.contentParts.map((p) => (p.type === 'text' ? p.text : '')).join('') ?? ''

const chat = (messages: Message[]): Session => ({ id: 's', name: 'Chat', type: 'chat', messages }) as Session

const live = () => store.list.find((s) => s.id === 's') as Session

beforeEach(() => {
  store.list = []
  store.nextId = 0
  calls.submitted = []
  calls.generated = []
  calls.generatedAfter = []
  calls.stopped = []
  navigate.mockClear()
})

describe('editAndResend', () => {
  it('forks before the question and sends the edited copy', async () => {
    const quote = { text: 'quoted', isPartial: false }
    store.list = [
      chat([
        msg('sys', 'system', 'Be brief'),
        msg('u1', 'user', 'first'),
        msg('a1', 'assistant', 'answer one'),
        msg('u2', 'user', 'second', {
          files: [{ id: 'f1', name: 'a.txt' } as NonNullable<Message['files']>[number]],
          quoteAttachment: quote,
          skillIds: ['k1'],
          toolsOff: true,
          contentParts: [
            { type: 'text', text: 'second' },
            { type: 'image', storageKey: 'img-1' },
          ],
        }),
        msg('a2', 'assistant', 'answer two'),
      ]),
    ]

    await editAndResend('s', 'u2', 'new')

    const session = live()
    const fork = session.messageForksHash?.a1
    expect(fork?.lists).toHaveLength(2)
    expect(fork?.lists.some((l) => l.messages.map((m) => m.id).join() === 'u2,a2')).toBe(true)

    const ids = session.messages.map((m) => m.id)
    expect(ids.slice(0, 3)).toEqual(['sys', 'u1', 'a1'])
    expect(session.messages).toHaveLength(4)
    const sent = session.messages[3]
    expect(sent.role).toBe('user')
    expect(sent.id).not.toBe('u2')
    expect(textOf(sent)).toBe('new')
    expect(sent.contentParts).toContainEqual({ type: 'image', storageKey: 'img-1' })
    expect(sent.files).toEqual([{ id: 'f1', name: 'a.txt' }])
    expect(sent.quoteAttachment).toEqual(quote)
    expect(sent.skillIds).toEqual(['k1'])
    expect(sent.toolsOff).toBe(true)
    expect(calls.generated).toEqual(['s'])
  })

  it('stops whatever the chat is running first (a marked message or a registered run)', async () => {
    store.list = [chat([msg('u1', 'user', 'first'), msg('a1', 'assistant', 'answer one')])]
    await editAndResend('s', 'u1', 'new')
    expect(calls.stopped).toEqual(['s'])
  })

  it('an older-thread edit keeps the old question too: the edited copy goes in a new branch', async () => {
    store.list = [chat([msg('u9', 'user', 'current'), msg('a9', 'assistant', 'current answer')])]
    store.list[0].threads = [
      {
        id: 't1',
        name: 'Old',
        createdAt: 1,
        messages: [
          msg('u1', 'user', 'first'),
          msg('a1', 'assistant', 'answer one'),
          msg('u2', 'user', 'second'),
          msg('a2', 'assistant', 'answer two'),
        ],
      },
    ]

    await editAndResend('s', 'u2', 'new')

    const session = live()
    const thread = session.threads?.[0]
    // The old question and answer are the other branch, untouched.
    const fork = session.messageForksHash?.a1
    expect(fork?.lists.some((l) => l.messages.map((m) => m.id).join() === 'u2,a2')).toBe(true)
    expect(textOf(fork?.lists.flatMap((l) => l.messages).find((m) => m.id === 'u2'))).toBe('second')
    // The thread now ends with an edited copy, answered below it.
    const ids = thread?.messages.map((m) => m.id) ?? []
    expect(ids.slice(0, 2)).toEqual(['u1', 'a1'])
    expect(ids).toHaveLength(3)
    const copy = thread?.messages[2] as Message
    expect(copy.id).not.toBe('u2')
    expect(textOf(copy)).toBe('new')
    expect(calls.generatedAfter).toEqual([copy.id])
    // The current list is not touched.
    expect(session.messages.map((m) => m.id)).toEqual(['u9', 'a9'])
  })

  it('first message edit keeps a branch', async () => {
    store.list = [chat([msg('u1', 'user', 'first'), msg('a1', 'assistant', 'answer one')])]

    await editAndResend('s', 'u1', 'new')

    const session = live()
    const fork = session.messageForksHash?.u1
    expect(fork).toBeDefined()
    expect(fork?.lists.some((l) => l.messages.map((m) => m.id).join() === 'a1')).toBe(true)
    expect(textOf(session.messages.find((m) => m.id === 'u1'))).toBe('new')
    expect(session.messages.map((m) => m.id)).toEqual(['u1'])
    expect(calls.generated).toEqual(['s'])
  })
})

describe('branchChatFromMessage', () => {
  it('copies messages up to the message into a new chat and opens it', async () => {
    store.list = [
      chat([
        msg('sys', 'system', 'Be brief'),
        msg('u1', 'user', 'first'),
        msg('a1', 'assistant', 'answer one'),
        msg('u2', 'user', 'second'),
        msg('a2', 'assistant', 'answer two'),
      ]),
    ]
    store.list[0].threads = [{ id: 't1', name: 'Old', messages: [msg('x', 'user', 'old')], createdAt: 1 }]
    store.list[0].messageForksHash = { u1: { position: 0, lists: [{ id: 'l', messages: [] }], createdAt: 1 } }

    const id = await branchChatFromMessage('s', 'a1')

    const copy = store.list.find((s) => s.id === id) as Session
    expect(copy.name).toBe('Chat (branch)')
    expect(copy.messages.map((m) => [m.role, textOf(m)])).toEqual([
      ['system', 'Be brief'],
      ['user', 'first'],
      ['assistant', 'answer one'],
    ])
    expect(copy.messages.some((m) => ['sys', 'u1', 'a1'].includes(m.id))).toBe(false)
    expect(copy.threads ?? []).toEqual([])
    expect(copy.messageForksHash).toBeUndefined()
    expect(navigate).toHaveBeenCalledWith({ to: `/session/${id}` })
  })
})
