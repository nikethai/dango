/**
 * @vitest-environment jsdom
 */
import type { ReviewEntry } from '@shared/types/review'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  search: {} as { scope?: string },
  scopes: [] as { id: string; name: string }[],
  startNewChat: vi.fn(),
  feedScope: vi.fn(),
  toolbarScope: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => h.search,
  useNavigate: () => vi.fn(),
}))
vi.mock('@/hooks/useScopes', () => ({ useScopes: () => ({ scopes: h.scopes }) }))
vi.mock('@/lib/startNewChat', () => ({ startNewChat: h.startNewChat }))
// ReviewEmpty pulls these in; they import the router, which this test does not need.
vi.mock('@/modals/Settings', () => ({ navigateToSettings: vi.fn() }))
vi.mock('@/platform', () => ({ default: {} }))
vi.mock('./ReviewFeed', () => ({
  ReviewFeed: (p: { scopeId?: string }) => {
    h.feedScope(p.scopeId)
    return null
  },
}))
vi.mock('./ReviewToolbar', () => ({
  ReviewToolbar: (p: { scopeId?: string }) => {
    h.toolbarScope(p.scopeId)
    return null
  },
}))

import { openReviewEntry, registerReviewOpener, reviewRegistryStore } from '@/packages/review/registry'
import { ReviewHome } from './ReviewHome'

const question = {
  id: 'q',
  kind: 'question',
  scopeId: 'p1',
  text: 'Why?',
  ref: { type: 'question' },
} as unknown as ReviewEntry

beforeEach(() => {
  h.search = {}
  h.scopes = []
  h.startNewChat.mockClear()
  h.feedScope.mockClear()
  h.toolbarScope.mockClear()
  reviewRegistryStore.setState({ openers: {} })
})
afterEach(cleanup)

// sourceCount={1}: the feed (not EM2) renders, so the scope it receives can be observed.
describe('ReviewHome scope filter', () => {
  it('drops a stale scope id once scopes have loaded', () => {
    h.search = { scope: 'gone' }
    h.scopes = [{ id: 'p1', name: 'Acme' }]
    render(<ReviewHome sourceCount={1} />)
    expect(h.feedScope).toHaveBeenLastCalledWith(undefined)
    expect(h.toolbarScope).toHaveBeenLastCalledWith(undefined)
  })
  it('keeps the id while scopes are still loading, and for a known scope or Everywhere', () => {
    h.search = { scope: 'p1' }
    render(<ReviewHome sourceCount={1} />)
    expect(h.feedScope).toHaveBeenLastCalledWith('p1')
    cleanup()
    h.scopes = [{ id: 'p1', name: 'Acme' }]
    render(<ReviewHome sourceCount={1} />)
    expect(h.feedScope).toHaveBeenLastCalledWith('p1')
    cleanup()
    h.search = { scope: 'everywhere' }
    render(<ReviewHome sourceCount={1} />)
    expect(h.feedScope).toHaveBeenLastCalledWith('everywhere')
  })
})

describe('ReviewHome question opener', () => {
  it('registers a prefilled new chat when none exists', async () => {
    render(<ReviewHome />)
    await openReviewEntry(question)
    expect(h.startNewChat).toHaveBeenCalledWith({ prefill: 'Why?', scopeId: 'p1' })
  })
  it('leaves an existing opener alone', async () => {
    const other = vi.fn()
    registerReviewOpener('question', other)
    render(<ReviewHome />)
    await openReviewEntry(question)
    expect(other).toHaveBeenCalled()
    expect(h.startNewChat).not.toHaveBeenCalled()
  })
  it('unregisters on unmount', () => {
    const { unmount } = render(<ReviewHome />)
    expect(reviewRegistryStore.getState().openers.question).toBeDefined()
    unmount()
    expect(reviewRegistryStore.getState().openers.question).toBeUndefined()
  })
})
