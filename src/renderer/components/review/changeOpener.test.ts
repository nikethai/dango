import type { ReviewEntry } from '@shared/types/review'
import i18next from 'i18next'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  setAtom: vi.fn(),
  toast: vi.fn(),
  sessionList: undefined as { id: string }[] | undefined,
  stored: new Set<string>(['s1']),
}))
vi.mock('@/stores/queryClient', () => ({ default: { getQueryData: () => h.sessionList } }))
vi.mock('@/stores/chatStore', () => ({
  ChatQueryKeys: { ChatSessionsList: ['chat-sessions-list'] },
  getSession: async (id: string) => (h.stored.has(id) ? { id } : null),
}))
vi.mock('@/stores/toastActions', () => ({ add: h.toast }))
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

beforeAll(async () => {
  await i18next.init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } })
})

beforeEach(() => {
  h.navigate.mockClear()
  h.setAtom.mockClear()
  h.toast.mockClear()
  h.sessionList = undefined
  h.stored = new Set(['s1'])
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

  it('a Change entry whose chat was deleted has no Open', () => {
    registerChangeOpener()
    h.sessionList = [{ id: 's2' }]
    expect(hasReviewOpener(change({ chatId: 's1' }))).toBe(false)
    h.sessionList = [{ id: 's1' }]
    expect(hasReviewOpener(change({ chatId: 's1' }))).toBe(true)
  })

  it('re-checks the chat when opening: a chat deleted since the row rendered toasts instead of navigating (M8)', async () => {
    registerChangeOpener()
    h.stored = new Set() // deleted after the cached list said it exists
    expect(await openReviewEntry(change({ chatId: 's1' }))).toBe(true)
    expect(h.navigate).not.toHaveBeenCalled()
    expect(h.setAtom).not.toHaveBeenCalled()
    expect(h.toast).toHaveBeenCalledWith('This chat was deleted.')
  })

  it('leaves an existing opener alone, and its cleanup removes only its own', () => {
    const off = registerChangeOpener()
    expect(reviewRegistryStore.getState().openers.change).toBeDefined()
    expect(registerChangeOpener()).toBeTypeOf('function')
    off()
    expect(reviewRegistryStore.getState().openers.change).toBeUndefined()
  })
})
