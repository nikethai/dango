import type { Message, Session } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({ list: [] as Session[], nextId: 0 }))

vi.mock('../chatStore', () => ({
  getSession: vi.fn((id: string) => Promise.resolve(structuredClone(store.list.find((s) => s.id === id) ?? null))),
  createSession: vi.fn((session: Omit<Session, 'id'>) => {
    const created = { ...structuredClone(session), id: `new-${++store.nextId}` } as Session
    store.list.push(created)
    return Promise.resolve(created)
  }),
}))

const switchCurrentSession = vi.hoisted(() => vi.fn())
vi.mock('./crud', () => ({ switchCurrentSession }))
vi.mock('../sessionHelpers', () => ({
  initEmptyChatSession: () => ({
    name: 'Untitled',
    type: 'chat',
    messages: [],
    settings: { provider: 'default-provider', modelId: 'default-model' },
  }),
}))

const summary = vi.hoisted(() => ({
  result: { success: true, summary: 'S' } as { success: boolean; summary?: string },
}))
const generateSummary = vi.hoisted(() => vi.fn(async () => summary.result))
vi.mock('@/packages/context-management/summary-generator', () => ({ generateSummary }))

const toast = vi.hoisted(() => vi.fn())
vi.mock('../toastActions', () => ({ add: toast }))
vi.mock('i18next', () => ({
  t: (key: string, vars?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars?.[name] ?? '')),
}))

import { startNewChatWithSummary } from './new-chat-with-summary'

const msg = (id: string, role: Message['role'], text: string, extra: Partial<Message> = {}): Message => ({
  id,
  role,
  contentParts: [{ type: 'text', text }],
  ...extra,
})

const textOf = (m: Message) => m.contentParts.map((p) => (p.type === 'text' ? p.text : '')).join('')

beforeEach(() => {
  store.list = [
    {
      id: 's1',
      name: 'Trip plan',
      type: 'chat',
      projectId: 'p1',
      folderId: 'p1',
      settings: { provider: 'openai', modelId: 'gpt-5' },
      messages: [
        msg('sys', 'system', 'Be brief.'),
        msg('u1', 'user', 'Plan a trip'),
        msg('a1', 'assistant', 'Sure'),
        msg('u2', 'user', 'More'),
        msg('a2', 'assistant', '', { error: 'API Error: prompt is too long', errorCode: 10001 }),
      ],
    } as Session,
  ]
  store.nextId = 0
  summary.result = { success: true, summary: 'S' }
  switchCurrentSession.mockClear()
  generateSummary.mockClear()
  toast.mockClear()
})

describe('startNewChatWithSummary', () => {
  it('creates "{{name}} (continued)" in the same scope with the summary and opens it', async () => {
    const id = await startNewChatWithSummary('s1')

    expect(id).toBe('new-1')
    const created = store.list.find((s) => s.id === 'new-1') as Session
    expect(created.name).toBe('Trip plan (continued)')
    expect(created.projectId).toBe('p1')
    expect(created.messages.map((m) => m.role)).toEqual(['system', 'user'])
    expect(textOf(created.messages[0])).toBe('Be brief.')
    expect(created.messages[0].id).not.toBe('sys')
    expect(textOf(created.messages[1])).toBe('Previous conversation summary:\n\nS')
    expect(switchCurrentSession).toHaveBeenCalledWith('new-1')
  })

  it('keeps the chat model: never switches models', async () => {
    await startNewChatWithSummary('s1')
    const created = store.list.find((s) => s.id === 'new-1') as Session
    expect(created.settings?.provider).toBe('openai')
    expect(created.settings?.modelId).toBe('gpt-5')
  })

  it('summarises the conversation without the system prompt or the failed answer', async () => {
    await startNewChatWithSummary('s1')
    const call = generateSummary.mock.calls[0] as unknown as [{ messages: Message[] }]
    expect(call[0].messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2'])
  })

  it('a failed summary creates nothing and says so', async () => {
    summary.result = { success: false }
    const id = await startNewChatWithSummary('s1')

    expect(id).toBeNull()
    expect(store.list).toHaveLength(1)
    expect(switchCurrentSession).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith("Couldn't summarise this chat. Try again.")
  })
})
