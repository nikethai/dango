import type { Message } from '@shared/types'
import type { KnowledgeConflict } from '@shared/types/knowledge'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as chatStore from '@/stores/chatStore'
import * as toastActions from '@/stores/toastActions'
import { addKnowledge, KnowledgeConflictError } from './approve'
import { saveMessageAsKnowledge } from './save-message'

vi.mock('i18next', () => ({
  t: (key: string, vars?: Record<string, string>) => key.replace(/\{\{(\w+)\}\}/g, (_, k) => vars?.[k] ?? ''),
}))
vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))
const chat = vi.hoisted(() => ({ messages: [] as unknown[] }))
vi.mock('@/stores/chatStore', () => ({
  getSession: vi.fn(async () => ({ id: 's1', projectId: 'acme', messages: chat.messages })),
}))
vi.mock('./approve', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./approve')>()),
  addKnowledge: vi.fn(async () => ({ id: 'k1' })),
}))

const msg = (text: string) =>
  ({ id: 'm1', role: 'assistant', contentParts: [{ type: 'text', text }] }) as unknown as Message

/** Saves the message as shown in its chat (the session holds it). */
function saveIn(m: Message) {
  chat.messages.length = 0
  chat.messages.push(m)
  return saveMessageAsKnowledge(m, 's1')
}

beforeEach(() => {
  vi.clearAllMocks()
  chat.messages.length = 0
})

describe('saveMessageAsKnowledge', () => {
  it("saves the message as a fact in the chat's scope (first 500 characters)", async () => {
    const text = 'x'.repeat(600)
    await saveIn(msg(text))
    expect(addKnowledge).toHaveBeenCalledWith({ scopeId: 'acme', kind: 'fact', text: 'x'.repeat(500) })
    expect(toastActions.add).not.toHaveBeenCalled()
  })

  it('an unscoped chat saves to Everywhere', async () => {
    vi.mocked(chatStore.getSession).mockResolvedValueOnce({ id: 's1', messages: chat.messages } as never)
    await saveIn(msg('Launch is 13 Nov'))
    expect(addKnowledge).toHaveBeenCalledWith(expect.objectContaining({ scopeId: EVERYWHERE_SCOPE_ID }))
  })

  it('a contradiction toasts that it waits in Review', async () => {
    vi.mocked(addKnowledge).mockRejectedValueOnce(
      new KnowledgeConflictError({ id: 'c' } as KnowledgeConflict, 'Launch is 4 Nov')
    )
    await saveIn(msg('Launch is 13 Nov'))
    expect(toastActions.add).toHaveBeenCalledWith('Waiting in Review: it contradicts "Launch is 4 Nov"')
  })

  it('a duplicate toasts Already saved', async () => {
    vi.mocked(addKnowledge).mockRejectedValueOnce(new Error('duplicate'))
    await saveIn(msg('Launch is 13 Nov'))
    expect(toastActions.add).toHaveBeenCalledWith('Already saved')
  })

  it('an empty message saves nothing', async () => {
    await saveIn(msg('   '))
    expect(addKnowledge).not.toHaveBeenCalled()
    expect(toastActions.add).toHaveBeenCalledWith('Nothing to save')
  })

  it('any other failure toasts that it could not save', async () => {
    vi.mocked(addKnowledge).mockRejectedValueOnce(new Error('disk'))
    await saveIn(msg('Launch is 13 Nov'))
    expect(toastActions.add).toHaveBeenCalledWith("Couldn't save that. Try again.")
  })

  describe('an answer built from email or tasks kept on this device', () => {
    const LOCAL_ONLY = "This answer used email or tasks kept on this device, so it can't be saved as knowledge."
    const recallAnswer = (result: Record<string, unknown>, toolName = 'client_recall') =>
      ({
        id: 'm1',
        role: 'assistant',
        contentParts: [
          { type: 'tool-call', state: 'result', toolCallId: 'c1', toolName, args: {}, result },
          { type: 'text', text: 'Jo said the price is 4,200 USD.' },
        ],
      }) as unknown as Message

    it('files the local-only sources with the fact, so it keeps their rule', async () => {
      await saveIn(recallAnswer({ ok: true, localOnly: true, localOnlySourceIds: ['g1'] }))
      expect(addKnowledge).toHaveBeenCalledWith({
        scopeId: 'acme',
        kind: 'fact',
        text: 'Jo said the price is 4,200 USD.',
        sources: [{ kind: 'chat', label: 'Chat answer', sourceId: 'g1' }],
      })
      expect(toastActions.add).not.toHaveBeenCalled()
    })

    it('saves nothing when the sources are not known', async () => {
      await saveIn(recallAnswer({ ok: true, localOnly: true }))
      expect(addKnowledge).not.toHaveBeenCalled()
      expect(toastActions.add).toHaveBeenCalledWith(LOCAL_ONLY)
    })

    it('saves nothing from a client_answer result marked local-only, or a summary of such answers', async () => {
      await saveIn(recallAnswer({ ok: true, localOnly: true, message: 'Saved' }, 'client_answer'))
      await saveIn({ ...msg('Summary: price is 4,200 USD'), pmLocalOnly: true })
      expect(addKnowledge).not.toHaveBeenCalled()
      expect(toastActions.add).toHaveBeenCalledTimes(2)
      expect(toastActions.add).toHaveBeenCalledWith(LOCAL_ONLY)
    })

    it('saves nothing from a Needs you opening, which quotes the mail', async () => {
      await saveIn({ ...msg('Jo asks: is the price 4,200 USD?'), pmQuestionId: 'q1' })
      expect(addKnowledge).not.toHaveBeenCalled()
      expect(toastActions.add).toHaveBeenCalledWith(LOCAL_ONLY)
    })

    it('treats a later answer in the chat like the local-only one before it', async () => {
      const later = { ...msg('As I said, 4,200 USD.'), id: 'm3' }
      vi.mocked(chatStore.getSession).mockResolvedValueOnce({
        id: 's1',
        projectId: 'acme',
        messages: [
          { ...recallAnswer({ ok: true, localOnly: true, localOnlySourceIds: ['g1'] }), id: 'm1' },
          { ...msg('Say it again'), id: 'm2', role: 'user' },
          later,
        ],
      } as never)
      await saveIn(later)
      expect(addKnowledge).toHaveBeenCalledWith(
        expect.objectContaining({ sources: [{ kind: 'chat', label: 'Chat answer', sourceId: 'g1' }] })
      )

      vi.mocked(chatStore.getSession).mockResolvedValueOnce({
        id: 's1',
        projectId: 'acme',
        messages: [{ ...recallAnswer({ ok: true, localOnly: true }), id: 'm1' }, later],
      } as never)
      await saveIn(later)
      expect(addKnowledge).toHaveBeenCalledTimes(1)
      expect(toastActions.add).toHaveBeenCalledWith(LOCAL_ONLY)

      vi.mocked(chatStore.getSession).mockResolvedValueOnce({
        id: 's1',
        projectId: 'acme',
        messages: [{ ...msg('Jo asks: is the price 4,200 USD?'), id: 'm0', pmQuestionId: 'q1' }, later],
      } as never)
      await saveIn(later)
      expect(addKnowledge).toHaveBeenCalledTimes(1)
      expect(toastActions.add).toHaveBeenCalledTimes(2)
    })

    it("keeps the user's own message in such a chat as theirs", async () => {
      const mine = { ...msg('Our price is 4,000 USD'), id: 'm2', role: 'user' } as Message
      vi.mocked(chatStore.getSession).mockResolvedValueOnce({
        id: 's1',
        projectId: 'acme',
        messages: [{ ...recallAnswer({ ok: true, localOnly: true }), id: 'm1' }, mine],
      } as never)
      await saveIn(mine)
      expect(addKnowledge).toHaveBeenCalledWith({ scopeId: 'acme', kind: 'fact', text: 'Our price is 4,000 USD' })
    })

    it("saves no answer it can't find in its chat: the session can't be read, or doesn't hold it", async () => {
      vi.mocked(chatStore.getSession).mockResolvedValueOnce(null as never)
      await saveMessageAsKnowledge(msg('Jo said 4,200 USD.'), 's1')
      chat.messages.length = 0
      await saveMessageAsKnowledge(msg('Jo said 4,200 USD.'), 's1')
      expect(addKnowledge).not.toHaveBeenCalled()
      expect(toastActions.add).toHaveBeenCalledTimes(2)
      expect(toastActions.add).toHaveBeenCalledWith(LOCAL_ONLY)

      const mine = { ...msg('Our price is 4,000 USD'), role: 'user' } as Message
      await saveMessageAsKnowledge(mine, 's1')
      expect(addKnowledge).toHaveBeenCalledWith({ scopeId: 'acme', kind: 'fact', text: 'Our price is 4,000 USD' })
    })
  })
})
