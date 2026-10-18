/**
 * @vitest-environment jsdom
 */
import type { ReviewEntry } from '@shared/types/review'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerReviewOpener, reviewRegistryStore } from '@/packages/review/registry'
import { reviewStore, setReviewStorageForTests } from '@/packages/review/store'
import { setReviewApplierForTests } from '@/packages/review/trust'
import { resetUndoForTests, undoStore } from '@/packages/undo'
import { DefaultReviewRenderer } from './DefaultReviewRenderer'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => String(vars?.[name] ?? name)),
  }),
}))
vi.mock('@/hooks/useScopes', () => ({
  useScopes: () => ({ getScope: (id?: string) => (id === 'acme' ? { id: 'acme', name: 'Acme Co' } : undefined) }),
}))

const TEXT = 'Which quote is current?'
const row = (over: Partial<ReviewEntry> = {}): ReviewEntry => ({
  id: 'r1',
  kind: 'needs-you',
  scopeId: 'acme',
  text: TEXT,
  ref: { type: 'question', id: 'q1' },
  state: 'open',
  createdAt: 1000,
  ...over,
})

const click = (name: string) =>
  act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
    await Promise.resolve()
  })

let data: Record<string, unknown>
const seed = (e: ReviewEntry) => {
  data['review-entries'] = { entries: [e] }
  reviewStore.setState({ entries: [e], lastCheckedAt: undefined, loaded: true })
}
const stored = () => reviewStore.getState().entries[0]

beforeEach(() => {
  data = {}
  setReviewStorageForTests({
    getItem: async <T,>(k: string, fb: T) => (k in data ? (JSON.parse(JSON.stringify(data[k])) as T) : fb),
    setItemNow: vi.fn((k: string, v: unknown) => {
      data[k] = JSON.parse(JSON.stringify(v))
      return Promise.resolve()
    }),
  })
  resetUndoForTests()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  setReviewApplierForTests('draft', undefined)
  reviewRegistryStore.setState({ openers: {}, renderers: {} })
  setReviewStorageForTests(null)
})

describe('DefaultReviewRenderer', () => {
  it('applies a draft with its actionLabel, becomes Done with Undo, and Undo reopens it', async () => {
    const apply = vi.fn(async () => {})
    const undo = vi.fn(async () => {})
    setReviewApplierForTests('draft', { apply, undo })
    const e = row({ kind: 'proposal', risk: 'risky', actionLabel: 'Apply', ref: { type: 'draft', id: 'd1' } })
    seed(e)
    render(<DefaultReviewRenderer entry={e} focused={false} />)
    await click('Apply')
    expect(apply).toHaveBeenCalledTimes(1)
    expect(stored().state).toBe('done')
    expect(undoStore.getState().toast?.message).toBe(`Done: "${TEXT}"`)
    await click('Undo')
    expect(undo).toHaveBeenCalledTimes(1)
    expect(stored()).toMatchObject({ kind: 'proposal', state: 'open' })
    expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy()
  })

  it('opens through the opener when there is no applier', async () => {
    const open = vi.fn()
    registerReviewOpener('job', open)
    const e = row({ ref: { type: 'job', id: 'j1' }, actionLabel: 'Sign in again' })
    seed(e)
    render(<DefaultReviewRenderer entry={e} focused={false} />)
    await click('Sign in again')
    expect(open).toHaveBeenCalledWith(e)
  })

  it('Answer calls the opener', async () => {
    const open = vi.fn()
    registerReviewOpener('question', open)
    const e = row()
    seed(e)
    render(<DefaultReviewRenderer entry={e} focused={false} />)
    await click('Answer')
    expect(open).toHaveBeenCalledWith(e)
  })

  it('Dismiss sets the row dismissed and pushes the Dismissed toast; its undo reopens', async () => {
    const e = row()
    seed(e)
    render(<DefaultReviewRenderer entry={e} focused={false} />)
    await click('Dismiss')
    expect(stored().state).toBe('dismissed')
    expect(undoStore.getState().toast?.message).toBe(`Dismissed "${TEXT}"`)
  })

  it('shows the scope name, and Everywhere for the Everywhere scope', () => {
    const e = row()
    seed(e)
    const { unmount } = render(<DefaultReviewRenderer entry={e} focused={false} />)
    expect(screen.getByText('Needs you · Acme Co')).toBeTruthy()
    unmount()
    const everywhere = row({ scopeId: 'everywhere' })
    seed(everywhere)
    render(<DefaultReviewRenderer entry={everywhere} focused={false} />)
    expect(screen.getByText('Needs you · Everywhere')).toBeTruthy()
  })

  it('Undo disappears when undoUntil passes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    setReviewApplierForTests('draft', { apply: vi.fn(async () => {}), undo: vi.fn(async () => {}) })
    const e = row({ kind: 'proposal', actionLabel: 'Apply', ref: { type: 'draft', id: 'd1' } })
    seed(e)
    render(<DefaultReviewRenderer entry={e} focused={false} />)
    await click('Apply')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
    await act(() => {
      vi.advanceTimersByTime(5001)
      return Promise.resolve()
    })
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('undoing a Dismiss reopens the row', async () => {
    const e = row()
    seed(e)
    render(<DefaultReviewRenderer entry={e} focused={false} />)
    await click('Dismiss')
    const { undoLatest } = await import('@/packages/undo')
    await act(() => undoLatest())
    expect(stored()).toMatchObject({ kind: 'needs-you', state: 'open' })
  })

  it('a needs-you row with an actionLabel opens even when a draft applier exists', async () => {
    const apply = vi.fn(() => Promise.resolve())
    const open = vi.fn()
    setReviewApplierForTests('draft', { apply, undo: vi.fn(() => Promise.resolve()) })
    registerReviewOpener('draft', open)
    const e = row({ kind: 'needs-you', actionLabel: 'Fix it', ref: { type: 'draft', id: 'd1' } })
    seed(e)
    render(<DefaultReviewRenderer entry={e} focused={false} />)
    await click('Fix it')
    expect(open).toHaveBeenCalledWith(e)
    expect(apply).not.toHaveBeenCalled()
  })

  it('a dismissed proposal has no applying primary', () => {
    const apply = vi.fn(() => Promise.resolve())
    setReviewApplierForTests('draft', { apply, undo: vi.fn(() => Promise.resolve()) })
    const e = row({ kind: 'proposal', state: 'dismissed', actionLabel: 'Apply', ref: { type: 'draft', id: 'd1' } })
    seed(e)
    render(<DefaultReviewRenderer entry={e} focused={false} />)
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
    expect(apply).not.toHaveBeenCalled()
  })

  it('a throwing applier leaves the row an open proposal and pushes no toast', async () => {
    const apply = vi.fn(() => Promise.reject(new Error('boom')))
    setReviewApplierForTests('draft', { apply, undo: vi.fn(() => Promise.resolve()) })
    const e = row({ kind: 'proposal', actionLabel: 'Apply', ref: { type: 'draft', id: 'd1' } })
    seed(e)
    render(<DefaultReviewRenderer entry={e} focused={false} />)
    await click('Apply')
    expect(apply).toHaveBeenCalledTimes(1)
    expect(stored()).toMatchObject({ kind: 'proposal', state: 'open' })
    expect(undoStore.getState().toast).toBeUndefined()
  })
})
