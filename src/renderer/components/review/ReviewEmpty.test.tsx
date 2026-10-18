/**
 * @vitest-environment jsdom
 */
import type { ReviewEntry } from '@shared/types/review'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  navigateToSettings: vi.fn(),
  startNewChat: vi.fn(),
  platform: { showQuickWindow: undefined as undefined | (() => Promise<void>) },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => String(vars?.[name] ?? name)),
  }),
}))
vi.mock('@tanstack/react-router', () => ({ useSearch: () => ({}), useNavigate: () => vi.fn() }))
vi.mock('@/hooks/useScopes', () => ({ useScopes: () => ({ scopes: [], getScope: () => undefined }) }))
vi.mock('@/lib/startNewChat', () => ({ startNewChat: h.startNewChat }))
vi.mock('@/modals/Settings', () => ({ navigateToSettings: h.navigateToSettings }))
vi.mock('@/platform', () => ({ default: h.platform }))
vi.mock('./ReviewToolbar', () => ({ ReviewToolbar: () => null }))

import { reviewStore, setReviewStorageForTests } from '@/packages/review/store'
import { formatLastChecked } from './feedSelectors'
import { ReviewEmpty } from './ReviewEmpty'
import { ReviewHome } from './ReviewHome'

const row = (id: string, over: Partial<ReviewEntry> = {}): ReviewEntry => ({
  id,
  kind: 'needs-you',
  scopeId: 'everywhere',
  text: `Row ${id}`,
  ref: { type: 'question', id: 'q' },
  state: 'open',
  createdAt: Date.now(),
  ...over,
})

function seed(entries: ReviewEntry[], lastCheckedAt?: number) {
  reviewStore.setState({ entries, lastCheckedAt })
}

beforeEach(() => {
  setReviewStorageForTests({
    // Autoload re-reads the store's own state, so seeded entries survive it.
    getItem: () => {
      const { entries, lastCheckedAt } = reviewStore.getState()
      return Promise.resolve({ entries, lastCheckedAt } as never)
    },
    setItemNow: () => Promise.resolve(),
  })
  h.navigateToSettings.mockClear()
  h.startNewChat.mockClear()
  h.platform.showQuickWindow = undefined
  seed([])
})
afterEach(cleanup)

describe('ReviewEmpty', () => {
  it('caught-up shows the heading and the formatted last-checked line', () => {
    const at = Date.now() - 60_000
    render(<ReviewEmpty variant="caught-up" lastCheckedAt={at} />)
    expect(screen.getByRole('heading', { name: 'Nothing needs you' })).toBeTruthy()
    expect(screen.getByText(formatLastChecked(at, Date.now()))).toBeTruthy()
  })
  it('caught-up shows no line without lastCheckedAt', () => {
    render(<ReviewEmpty variant="caught-up" />)
    expect(screen.getByText('Nothing needs you')).toBeTruthy()
    expect(screen.queryByText(/Last checked/)).toBeNull()
  })
  it('no-sources shows both buttons; Connect a source opens /sources settings', () => {
    render(<ReviewEmpty variant="no-sources" />)
    expect(screen.getByText('Connect a source to get started')).toBeTruthy()
    expect(screen.getByText('Dango reads a folder, Gmail or Asana and tells you here what needs you.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Connect a source' }))
    expect(h.navigateToSettings).toHaveBeenCalledWith('/sources')
    expect(screen.getByRole('button', { name: 'Ask anything' })).toBeTruthy()
  })
  it('Ask anything uses the quick window when defined, else a new chat', () => {
    render(<ReviewEmpty variant="no-sources" />)
    fireEvent.click(screen.getByRole('button', { name: 'Ask anything' }))
    expect(h.startNewChat).toHaveBeenCalledTimes(1)
    cleanup()
    const show = vi.fn(async () => undefined)
    h.platform.showQuickWindow = show
    render(<ReviewEmpty variant="no-sources" />)
    fireEvent.click(screen.getByRole('button', { name: 'Ask anything' }))
    expect(show).toHaveBeenCalledTimes(1)
    expect(h.startNewChat).toHaveBeenCalledTimes(1)
  })
})

describe('ReviewHome empty states', () => {
  it('no entries and no sourceCount: EM2, not RV5', () => {
    render(<ReviewHome />)
    expect(screen.getByText('Connect a source to get started')).toBeTruthy()
    expect(screen.queryByText('Nothing needs you')).toBeNull()
  })
  it('sourceCount 1 and no entries: RV5, not EM2', () => {
    render(<ReviewHome sourceCount={1} />)
    expect(screen.getByText('Nothing needs you')).toBeTruthy()
    expect(screen.queryByText('Connect a source to get started')).toBeNull()
  })
  it('sourceCount 0 with a done row: EM2 only', () => {
    seed([row('d', { state: 'done' })])
    render(<ReviewHome sourceCount={0} />)
    expect(screen.getByText('Connect a source to get started')).toBeTruthy()
    expect(screen.queryByText('Nothing needs you')).toBeNull()
  })
  it('one done row: RV5 above that row', () => {
    seed([row('d', { state: 'done' })])
    render(<ReviewHome />)
    const heading = screen.getByText('Nothing needs you')
    const rowEl = screen.getByText('Row d')
    expect(heading.compareDocumentPosition(rowEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('Connect a source to get started')).toBeNull()
  })
  it('one waiting row: neither', () => {
    seed([row('w')])
    render(<ReviewHome />)
    expect(screen.queryByText('Nothing needs you')).toBeNull()
    expect(screen.queryByText('Connect a source to get started')).toBeNull()
  })
})
