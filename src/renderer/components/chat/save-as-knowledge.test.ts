import { createMessage } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as toastActions from '@/stores/toastActions'
import { saveAsKnowledgeFromMessage } from './save-as-knowledge'

vi.mock('i18next', () => ({ t: (key: string) => key }))
vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))
vi.mock('@/lib/utils', () => ({ getLogger: () => ({ error: vi.fn() }) }))

beforeEach(() => vi.mocked(toastActions.add).mockClear())

describe('saveAsKnowledgeFromMessage', () => {
  const msg = createMessage('assistant', 'Launch is 6 Nov')

  it('passes the message and session on', async () => {
    const saveMessageAsKnowledge = vi.fn(async () => undefined)
    await saveAsKnowledgeFromMessage(msg, 's1', async () => ({ saveMessageAsKnowledge }))
    expect(saveMessageAsKnowledge).toHaveBeenCalledWith(msg, 's1')
    expect(toastActions.add).not.toHaveBeenCalled()
  })

  it('a chunk that fails to load toasts and never rejects', async () => {
    await expect(
      saveAsKnowledgeFromMessage(msg, 's1', () => Promise.reject(new Error('chunk load failed')))
    ).resolves.toBeUndefined()
    expect(toastActions.add).toHaveBeenCalledWith("Couldn't save that. Try again.")
  })
})
