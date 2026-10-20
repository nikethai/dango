import type { Message, Session } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({ session: null as Session | null }))
const chat = vi.hoisted(() => ({
  getSession: vi.fn(async () => structuredClone(store.session)),
  updateMessage: vi.fn(async () => undefined),
}))
vi.mock('../chatStore', () => chat)
const modifyMessage = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('./messages', () => ({ modifyMessage }))
const cancelRateLimitRetry = vi.hoisted(() => vi.fn())
vi.mock('./rate-limit-retry', () => ({ cancelRateLimitRetry }))

import { clearGenerationCancel, consumeGenerationStoppedByUser, registerGenerationCancel } from './generation-cancel'
import { stopChatIfRunning } from './stop-generation'

const answer = (extra: Partial<Message> = {}): Message =>
  ({ id: 'a1', role: 'assistant', contentParts: [{ type: 'text', text: 'partial' }], ...extra }) as Message

beforeEach(() => {
  store.session = { id: 's1', name: 'Chat', type: 'chat', messages: [answer()] } as Session
  chat.getSession.mockClear()
  chat.updateMessage.mockClear()
  modifyMessage.mockClear()
  cancelRateLimitRetry.mockClear()
})

describe('stopChatIfRunning', () => {
  it('an idle chat: nothing to stop, but a waiting rate-limit retry is dropped', async () => {
    expect(await stopChatIfRunning('s1')).toBe(false)
    expect(cancelRateLimitRetry).toHaveBeenCalledWith('s1')
    expect(modifyMessage).not.toHaveBeenCalled()
    expect(chat.updateMessage).not.toHaveBeenCalled()
  })

  it('stops the message marked generating and keeps its text', async () => {
    store.session = { ...(store.session as Session), messages: [answer({ generating: true })] }
    expect(await stopChatIfRunning('s1')).toBe(true)
    expect(modifyMessage).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ id: 'a1', generating: false, contentParts: [{ type: 'text', text: 'partial' }] }),
      true
    )
  })

  it('stops a run the cancel registry knows about before its message is marked generating', async () => {
    const abort = vi.fn()
    registerGenerationCancel('s1', 'a1', abort)
    try {
      expect(await stopChatIfRunning('s1')).toBe(true)
      expect(abort).toHaveBeenCalledTimes(1)
      expect(chat.updateMessage).toHaveBeenCalledWith('s1', 'a1', expect.any(Function))
    } finally {
      clearGenerationCancel('s1', 'a1')
    }
  })

  it('uses the chat it is given instead of reading it again', async () => {
    const given = { ...(store.session as Session), messages: [answer({ generating: true })] }
    expect(await stopChatIfRunning('s1', given)).toBe(true)
    expect(chat.getSession).not.toHaveBeenCalled()
  })

  it('marks the stopped message once, so a room turn does not retry it as an empty answer', async () => {
    store.session = { ...(store.session as Session), messages: [answer({ generating: true })] }
    await stopChatIfRunning('s1')
    expect(consumeGenerationStoppedByUser('s1', 'other')).toBe(false)
    expect(consumeGenerationStoppedByUser('s1', 'a1')).toBe(true)
    expect(consumeGenerationStoppedByUser('s1', 'a1')).toBe(false)
  })
})
