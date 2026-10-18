/**
 * @vitest-environment jsdom
 */
import type { ReviewEntry } from '@shared/types/review'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type ReviewRendererProps, registerReviewRenderer, reviewRegistryStore } from '@/packages/review/registry'
import { reviewStore, setReviewEntryState, setReviewStorageForTests } from '@/packages/review/store'
import { setReviewApplierForTests } from '@/packages/review/trust'
import { resetUndoForTests, undoStore } from '@/packages/undo'
import { ReviewFeed } from './ReviewFeed'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => String(vars?.[name] ?? name)),
  }),
}))
vi.mock('@/hooks/useScopes', () => ({ useScopes: () => ({ getScope: () => undefined }) }))

const DAY = 24 * 60 * 60 * 1000
const row = (id: string, over: Partial<ReviewEntry> = {}): ReviewEntry => ({
  id,
  kind: 'proposal',
  scopeId: 'everywhere',
  text: `Row ${id}`,
  ref: { type: 'proposal', id: `p-${id}` },
  state: 'open',
  createdAt: Date.now(),
  ...over,
})

/** Like slice 4's proposal row: it knows nothing about the feed. */
function FakeProposal({ entry }: ReviewRendererProps) {
  return (
    <article data-testid={`fake-${entry.id}`}>
      <input aria-label={`Note ${entry.id}`} />
      <button type="button" className="dg-btn dg-btn--primary">
        Approve
      </button>
      <button type="button" className="dg-btn" tabIndex={0}>
        Edit
      </button>
      <button
        type="button"
        className="dg-btn dg-btn--ghost"
        onClick={() => void setReviewEntryState({ id: entry.id }, 'dismissed')}
      >
        Dismiss
      </button>
    </article>
  )
}

function FakeConflict({ entry }: ReviewRendererProps) {
  return (
    <article>
      <button type="button" className="dg-btn" aria-label='Keep this: "first"'>
        Keep this
      </button>
      <button type="button" className="dg-btn" aria-label='Keep this: "second"'>
        Keep this
      </button>
      <button type="button" className="dg-btn dg-btn--ghost">
        Dismiss {entry.id}
      </button>
    </article>
  )
}

let data: Record<string, unknown>
const seed = (entries: ReviewEntry[]) => {
  data['review-entries'] = { entries }
  reviewStore.setState({ entries, lastCheckedAt: undefined, loaded: true })
}
const rowEl = (id: string) => document.querySelector(`li[data-entry-id="${id}"]`) as HTMLElement
const press = (target: Element, key: string) =>
  act(async () => {
    fireEvent.keyDown(target, { key })
    await new Promise((r) => setTimeout(r, 0))
  })
const mountFeed = async (entries: ReviewEntry[], props: Parameters<typeof ReviewFeed>[0] = {}) => {
  seed(entries)
  render(<ReviewFeed caughtUp={<p>Nothing needs you</p>} {...props} />)
  await act(() => new Promise((r) => setTimeout(r, 0)))
}

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
  registerReviewRenderer('proposal', FakeProposal, { refType: 'proposal' })
  registerReviewRenderer('conflict', FakeConflict, { refType: 'conflict' })
})
afterEach(() => {
  cleanup()
  setReviewApplierForTests('draft', undefined)
  reviewRegistryStore.setState({ openers: {}, renderers: {} })
  setReviewStorageForTests(null)
})

describe('ReviewFeed', () => {
  it('groups rows under Today, Yesterday and Earlier', async () => {
    const now = Date.now()
    await mountFeed([
      row('old', { createdAt: now - 5 * DAY }),
      row('today', { createdAt: now }),
      row('yday', { createdAt: now - DAY }),
    ])
    const headings = screen.getAllByRole('heading', { level: 2 })
    expect(headings.map((h) => h.textContent)).toEqual(['Today', 'Yesterday', 'Earlier'])
    const lists = screen.getAllByRole('list')
    expect(within(lists[0]).getByTestId('fake-today')).toBeTruthy()
    expect(within(lists[1]).getByTestId('fake-yday')).toBeTruthy()
    expect(within(lists[2]).getByTestId('fake-old')).toBeTruthy()
    const li = rowEl('today')
    expect(li.tabIndex).toBe(0)
    expect(li.getAttribute('aria-keyshortcuts')).toBe('ArrowUp ArrowDown J K A E X Enter')
  })

  it('scopeId filters the rows', async () => {
    await mountFeed([row('a', { scopeId: 'acme' }), row('b', { scopeId: 'beta' })], { scopeId: 'acme' })
    expect(rowEl('a')).toBeTruthy()
    expect(rowEl('b')).toBeNull()
  })

  it('shows the caught-up block only when nothing is waiting', async () => {
    await mountFeed([row('a', { scopeId: 'acme' }), row('b', { scopeId: 'beta', state: 'done' })], {
      scopeId: 'beta',
    })
    expect(screen.getByTestId('review-empty').textContent).toBe('Nothing needs you')
    cleanup()
    await mountFeed([row('a')])
    expect(screen.queryByTestId('review-empty')).toBeNull()
  })

  it('focuses the first row on mount', async () => {
    await mountFeed([row('a'), row('b', { createdAt: Date.now() - 1000 })])
    expect(document.activeElement).toBe(rowEl('a'))
  })

  it('keeps only the focused row controls tabbable and restores their original tabindex', async () => {
    const now = Date.now()
    await mountFeed([row('a', { createdAt: now }), row('b', { createdAt: now - 1000 })])
    const controls = (id: string) => Array.from(rowEl(id).querySelectorAll('button, input'))
    const tabindexes = (id: string) => controls(id).map((el) => el.getAttribute('tabindex'))

    await act(() => rowEl('a').focus())
    expect(tabindexes('a')).toEqual([null, null, '0', null])
    expect(tabindexes('b')).toEqual(['-1', '-1', '-1', '-1'])

    await act(() => rowEl('b').focus())
    expect(tabindexes('a')).toEqual(['-1', '-1', '-1', '-1'])
    expect(tabindexes('b')).toEqual([null, null, '0', null])
    for (const el of controls('b')) expect(el.hasAttribute('data-feed-tabindex')).toBe(false)

    await act(() => rowEl('a').focus())
    expect(tabindexes('a')).toEqual([null, null, '0', null])
  })

  it('takes a control a renderer adds later out of the tab order', async () => {
    const now = Date.now()
    await mountFeed([row('a', { createdAt: now }), row('b', { createdAt: now - 1000 })])
    const added = document.createElement('button')
    await act(async () => {
      rowEl('b').querySelector('article')?.appendChild(added)
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(added.getAttribute('tabindex')).toBe('-1')
  })

  it('X on the last row moves focus to the row above', async () => {
    const now = Date.now()
    await mountFeed([row('a', { createdAt: now }), row('b', { createdAt: now - 1000 })])
    await act(() => rowEl('b').focus())
    await press(rowEl('b'), 'x')
    await waitFor(() => expect(rowEl('b')).toBeNull())
    expect(document.activeElement).toBe(rowEl('a'))
  })

  it('dismissing the only waiting row focuses the caught-up block', async () => {
    await mountFeed([row('a')])
    await act(() => rowEl('a').focus())
    await press(rowEl('a'), 'x')
    await waitFor(() => expect(rowEl('a')).toBeNull())
    expect(document.activeElement).toBe(screen.getByTestId('review-empty'))
  })

  it('X on a default row without its own Dismiss dismisses it with a toast', async () => {
    const e = row('a', { kind: 'change', ref: { type: 'change', id: 'c1' }, state: 'done' })
    await mountFeed([e, row('b', { createdAt: Date.now() - 1000 })])
    await act(() => rowEl('a').focus())
    await press(rowEl('a'), 'x')
    await waitFor(() => expect(rowEl('a')).toBeNull())
    expect(undoStore.getState().toast?.message).toBe('Dismissed "Row a"')
    expect(document.activeElement).toBe(rowEl('b'))
  })

  it('a row removed through the store moves focus to the row below (Review Focus 4)', async () => {
    const now = Date.now()
    await mountFeed([row('a', { createdAt: now }), row('b', { createdAt: now - 1000 }), row('c', { createdAt: 0 })])
    await act(() => rowEl('b').focus())
    await act(async () => {
      await setReviewEntryState({ id: 'b' }, 'dismissed')
    })
    expect(rowEl('b')).toBeNull()
    expect(document.activeElement).toBe(rowEl('c'))
  })

  it('a draft proposal gets the default renderer and a knowledge proposal the registered one (Review Focus 2)', async () => {
    setReviewApplierForTests('draft', { apply: vi.fn(() => Promise.resolve()), undo: vi.fn(() => Promise.resolve()) })
    const now = Date.now()
    await mountFeed([
      row('draft', { ref: { type: 'draft', id: 'd1' }, createdAt: now }),
      row('know', { createdAt: now - 1000 }),
    ])
    expect(within(rowEl('draft')).queryByTestId('fake-draft')).toBeNull()
    expect(within(rowEl('draft')).getByRole('button', { name: 'Approve' })).toBeTruthy()
    expect(within(rowEl('know')).getByTestId('fake-know')).toBeTruthy()
  })

  it('a done knowledge proposal renders no Approve', async () => {
    await mountFeed([row('a', { state: 'done' })])
    expect(within(rowEl('a')).queryByTestId('fake-a')).toBeNull()
    expect(within(rowEl('a')).queryByRole('button', { name: 'Approve' })).toBeNull()
  })

  it('↵ on a conflict row focuses its first Keep this', async () => {
    await mountFeed([row('c', { kind: 'conflict', ref: { type: 'conflict', id: 'k1' } })])
    await act(() => rowEl('c').focus())
    await press(rowEl('c'), 'Enter')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep this: "first"' }))
  })
})
