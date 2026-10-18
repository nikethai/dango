import type { ReviewEntry } from '@shared/types/review'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ navigate: vi.fn(), setAtom: vi.fn() }))
vi.mock('@/router', () => ({ router: { navigate: h.navigate } }))
vi.mock('@/stores/atoms', () => ({ currentSessionIdAtom: 'currentSessionIdAtom' }))
vi.mock('jotai', () => ({ getDefaultStore: () => ({ set: h.setAtom }) }))

import { hasReviewOpener, openReviewEntry, reviewRegistryStore } from '@/packages/review/registry'
import { registerChangeOpener } from './changeOpener'

const change = (extra: Partial<ReviewEntry> = {}) =>
  ({
    id: 'c',
    kind: 'change',
    scopeId: 'p1',
    text: 'Plan finished: Move docs',
    ref: { type: 'change', id: 'cs-1' },
    state: 'open',
    createdAt: 1,
    ...extra,
  }) as ReviewEntry

beforeEach(() => {
  h.navigate.mockClear()
  h.setAtom.mockClear()
  reviewRegistryStore.setState({ openers: {} })
})

describe('change opener (R15: a Change entry opens its chat)', () => {
  it('opens the chat a Change entry came from', async () => {
    registerChangeOpener()
    expect(hasReviewOpener(change({ chatId: 's1' }))).toBe(true)
    expect(await openReviewEntry(change({ chatId: 's1' }))).toBe(true)
    expect(h.setAtom).toHaveBeenCalledWith('currentSessionIdAtom', 's1')
    expect(h.navigate).toHaveBeenCalledWith({ to: '/session/$sessionId', params: { sessionId: 's1' } })
  })

  it('a Change entry without a chat has no opener, so no Open action', async () => {
    registerChangeOpener()
    expect(hasReviewOpener(change())).toBe(false)
    expect(await openReviewEntry(change())).toBe(false)
    expect(h.navigate).not.toHaveBeenCalled()
  })

  it('leaves an existing opener alone, and its cleanup removes only its own', () => {
    const off = registerChangeOpener()
    expect(reviewRegistryStore.getState().openers.change).toBeDefined()
    expect(registerChangeOpener()).toBeTypeOf('function')
    off()
    expect(reviewRegistryStore.getState().openers.change).toBeUndefined()
  })
})
