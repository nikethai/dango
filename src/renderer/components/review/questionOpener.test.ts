import type { ReviewEntry } from '@shared/types/review'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ startNewChat: vi.fn() }))
vi.mock('@/lib/startNewChat', () => ({ startNewChat: h.startNewChat }))

import { openReviewEntry, registerReviewOpener, reviewRegistryStore } from '@/packages/review/registry'
import { registerDefaultQuestionOpener } from './questionOpener'

const question = {
  id: 'q',
  kind: 'needs-you',
  scopeId: 'p1',
  text: 'Why?',
  ref: { type: 'question' },
} as unknown as ReviewEntry

beforeEach(() => {
  h.startNewChat.mockClear()
  reviewRegistryStore.setState({ openers: {} })
})

describe('default question opener (M3: registered once at app init)', () => {
  it('registers a prefilled new chat when none exists', async () => {
    registerDefaultQuestionOpener()
    await openReviewEntry(question)
    expect(h.startNewChat).toHaveBeenCalledWith({ prefill: 'Why?', scopeId: 'p1' })
  })
  it('leaves an existing opener alone', async () => {
    const other = vi.fn()
    registerReviewOpener('question', other)
    registerDefaultQuestionOpener()
    await openReviewEntry(question)
    expect(other).toHaveBeenCalled()
    expect(h.startNewChat).not.toHaveBeenCalled()
  })
  it('its cleanup removes only the default', () => {
    const off = registerDefaultQuestionOpener()
    expect(reviewRegistryStore.getState().openers.question).toBeDefined()
    off()
    expect(reviewRegistryStore.getState().openers.question).toBeUndefined()
  })
})
