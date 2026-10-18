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
vi.mock('@/stores/chatStore', () => ({ getSession: vi.fn(async () => ({ id: 's1', projectId: 'acme' })) }))
vi.mock('./approve', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./approve')>()),
  addKnowledge: vi.fn(async () => ({ id: 'k1' })),
}))

const msg = (text: string) =>
  ({ id: 'm1', role: 'assistant', contentParts: [{ type: 'text', text }] }) as unknown as Message

beforeEach(() => {
  vi.clearAllMocks()
})

describe('saveMessageAsKnowledge', () => {
  it("saves the message as a fact in the chat's scope (first 500 characters)", async () => {
    const text = 'x'.repeat(600)
    await saveMessageAsKnowledge(msg(text), 's1')
    expect(addKnowledge).toHaveBeenCalledWith({ scopeId: 'acme', kind: 'fact', text: 'x'.repeat(500) })
    expect(toastActions.add).not.toHaveBeenCalled()
  })

  it('an unscoped chat saves to Everywhere', async () => {
    vi.mocked(chatStore.getSession).mockResolvedValueOnce({ id: 's1' } as never)
    await saveMessageAsKnowledge(msg('Launch is 13 Nov'), 's1')
    expect(addKnowledge).toHaveBeenCalledWith(expect.objectContaining({ scopeId: EVERYWHERE_SCOPE_ID }))
  })

  it('a contradiction toasts that it waits in Review', async () => {
    vi.mocked(addKnowledge).mockRejectedValueOnce(
      new KnowledgeConflictError({ id: 'c' } as KnowledgeConflict, 'Launch is 4 Nov')
    )
    await saveMessageAsKnowledge(msg('Launch is 13 Nov'), 's1')
    expect(toastActions.add).toHaveBeenCalledWith('Waiting in Review: it contradicts "Launch is 4 Nov"')
  })

  it('a duplicate toasts Already saved', async () => {
    vi.mocked(addKnowledge).mockRejectedValueOnce(new Error('duplicate'))
    await saveMessageAsKnowledge(msg('Launch is 13 Nov'), 's1')
    expect(toastActions.add).toHaveBeenCalledWith('Already saved')
  })

  it('an empty message saves nothing', async () => {
    await saveMessageAsKnowledge(msg('   '), 's1')
    expect(addKnowledge).not.toHaveBeenCalled()
    expect(toastActions.add).toHaveBeenCalledWith('Nothing to save')
  })

  it('any other failure toasts that it could not save', async () => {
    vi.mocked(addKnowledge).mockRejectedValueOnce(new Error('disk'))
    await saveMessageAsKnowledge(msg('Launch is 13 Nov'), 's1')
    expect(toastActions.add).toHaveBeenCalledWith("Couldn't save that. Try again.")
  })
})
