/**
 * @vitest-environment jsdom
 */
import type { ReviewEntry } from '@shared/types/review'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { type ReactNode, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type ReviewRendererProps, registerReviewOpener, reviewRegistryStore } from '@/packages/review/registry'
import { reviewStore, setReviewStorageForTests } from '@/packages/review/store'
import { setReviewApplierForTests } from '@/packages/review/trust'
import { resetUndoForTests } from '@/packages/undo'
import { DefaultReviewRenderer } from './DefaultReviewRenderer'
import { useReviewKeys } from './useReviewKeys'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => String(vars?.[name] ?? name)),
  }),
}))
vi.mock('@/hooks/useScopes', () => ({ useScopes: () => ({ getScope: () => undefined }) }))

const row = (id: string, over: Partial<ReviewEntry> = {}): ReviewEntry => ({
  id,
  kind: 'proposal',
  scopeId: 'everywhere',
  text: `Row ${id}`,
  ref: { type: 'proposal', id: `p-${id}` },
  state: 'open',
  createdAt: 1000,
  ...over,
})

const clicks = { approve: vi.fn(), edit: vi.fn(), dismiss: vi.fn() }

/** Slice 4 style proposal: Approve (primary), Edit, Dismiss and a textarea. */
function FakeProposal({ entry }: ReviewRendererProps) {
  return (
    <article>
      <textarea aria-label={`Edit ${entry.id}`} />
      <button type="button" className="dg-btn dg-btn--primary" onClick={() => clicks.approve(entry.id)}>
        Approve
      </button>
      <button type="button" className="dg-btn" onClick={() => clicks.edit(entry.id)}>
        Edit
      </button>
      <button type="button" className="dg-btn dg-btn--ghost" onClick={() => clicks.dismiss(entry.id)}>
        Dismiss
      </button>
    </article>
  )
}

function Bare() {
  return <article>No buttons here</article>
}

/** A row with a sheet portaled to the body, like slice 4's Keep both sheet. */
function WithSheet({ entry }: ReviewRendererProps) {
  return (
    <article>
      <button type="button" className="dg-btn dg-btn--ghost" onClick={() => clicks.dismiss(entry.id)}>
        Dismiss
      </button>
      {createPortal(
        <div data-testid="sheet">
          <button type="button">Save</button>
        </div>,
        document.body
      )}
    </article>
  )
}

type HarnessRow = { entry: ReviewEntry; render: (focused: boolean) => ReactNode }

function Harness({ rows, dismissFallback }: { rows: HarnessRow[]; dismissFallback: (id: string) => void }) {
  const rowsRef = useRef(new Map<string, HTMLElement>())
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const ids = rows.map((r) => r.entry.id)
  const { onKeyDown } = useReviewKeys({ rowsRef, ids, focusedId, setFocusedId, dismissFallback })
  return (
    <ol>
      {rows.map((r) => (
        <li
          key={r.entry.id}
          tabIndex={0}
          data-entry-id={r.entry.id}
          data-testid={`row-${r.entry.id}`}
          ref={(el) => {
            if (el) rowsRef.current.set(r.entry.id, el)
            else rowsRef.current.delete(r.entry.id)
          }}
          onFocus={() => setFocusedId(r.entry.id)}
          onKeyDown={onKeyDown}
        >
          {r.render(r.entry.id === focusedId)}
        </li>
      ))}
    </ol>
  )
}

let data: Record<string, unknown>
const seed = (entries: ReviewEntry[]) => {
  data['review-entries'] = { entries }
  reviewStore.setState({ entries, lastCheckedAt: undefined, loaded: true })
}
const fake = (e: ReviewEntry): HarnessRow => ({ entry: e, render: (f) => <FakeProposal entry={e} focused={f} /> })
const byDefault = (e: ReviewEntry): HarnessRow => ({
  entry: e,
  render: (f) => <DefaultReviewRenderer entry={e} focused={f} />,
})
const mount = (rows: HarnessRow[], dismissFallback = vi.fn()) => {
  seed(rows.map((r) => r.entry))
  render(<Harness rows={rows} dismissFallback={dismissFallback} />)
  return dismissFallback
}
const press = (target: Element, key: string, init: Partial<KeyboardEventInit> = {}) =>
  act(async () => {
    fireEvent.keyDown(target, { key, ...init })
    await new Promise((r) => setTimeout(r, 0))
  })
const rowEl = (id: string) => screen.getByTestId(`row-${id}`)
const focusRow = (id: string) => act(() => rowEl(id).focus())

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
  for (const f of Object.values(clicks)) f.mockReset()
})
afterEach(() => {
  cleanup()
  setReviewApplierForTests('draft', undefined)
  reviewRegistryStore.setState({ openers: {}, renderers: {} })
  setReviewStorageForTests(null)
})

describe('useReviewKeys', () => {
  it('J and ↓ move to the next row, K and ↑ move back, all clamped at the ends', async () => {
    mount([fake(row('a')), fake(row('b')), fake(row('c'))])
    await focusRow('a')
    await press(rowEl('a'), 'j')
    expect(document.activeElement).toBe(rowEl('b'))
    await press(rowEl('b'), 'ArrowDown')
    expect(document.activeElement).toBe(rowEl('c'))
    await press(rowEl('c'), 'j')
    expect(document.activeElement).toBe(rowEl('c'))
    await press(rowEl('c'), 'ArrowDown')
    expect(document.activeElement).toBe(rowEl('c'))
    await press(rowEl('c'), 'k')
    expect(document.activeElement).toBe(rowEl('b'))
    await press(rowEl('b'), 'ArrowUp')
    expect(document.activeElement).toBe(rowEl('a'))
    await press(rowEl('a'), 'k')
    expect(document.activeElement).toBe(rowEl('a'))
    await press(rowEl('a'), 'ArrowUp')
    expect(document.activeElement).toBe(rowEl('a'))
  })

  it('A on a focused fake proposal clicks its Approve', async () => {
    mount([fake(row('a')), fake(row('b'))])
    await focusRow('b')
    await press(rowEl('b'), 'a')
    expect(clicks.approve).toHaveBeenCalledExactlyOnceWith('b')
  })

  it('letter keys are case-insensitive', async () => {
    mount([fake(row('a'))])
    await focusRow('a')
    await press(rowEl('a'), 'A', { shiftKey: true })
    expect(clicks.approve).toHaveBeenCalledExactlyOnceWith('a')
  })

  it('X on a row without Dismiss calls dismissFallback', async () => {
    const e = row('a', { kind: 'change', ref: { type: 'change', id: 'c1' } })
    const fallback = mount([{ entry: e, render: () => <Bare /> }])
    await focusRow('a')
    await press(rowEl('a'), 'x')
    expect(fallback).toHaveBeenCalledExactlyOnceWith('a')
  })

  it('X clicks the row Dismiss when it has one', async () => {
    const fallback = mount([fake(row('a'))])
    await focusRow('a')
    await press(rowEl('a'), 'x')
    expect(clicks.dismiss).toHaveBeenCalledExactlyOnceWith('a')
    expect(fallback).not.toHaveBeenCalled()
  })

  it('E on a default-rendered row with a registered opener calls openReviewEntry', async () => {
    const open = vi.fn()
    registerReviewOpener('job', open)
    const e = row('a', { kind: 'needs-you', ref: { type: 'job', id: 'j1' } })
    mount([byDefault(e)])
    await focusRow('a')
    await press(rowEl('a'), 'e')
    expect(open).toHaveBeenCalledTimes(1)
    expect(open.mock.calls[0][0]).toMatchObject({ id: 'a' })
  })

  it('a, x and e typed into the renderer textarea click nothing (Review Focus 3)', async () => {
    const fallback = mount([fake(row('a'))])
    const textarea = screen.getByLabelText('Edit a')
    await act(() => textarea.focus())
    for (const key of ['a', 'x', 'e', 'A', 'Enter']) await press(textarea, key)
    expect(clicks.approve).not.toHaveBeenCalled()
    expect(clicks.dismiss).not.toHaveBeenCalled()
    expect(clicks.edit).not.toHaveBeenCalled()
    expect(fallback).not.toHaveBeenCalled()
  })

  it('⌘A, Ctrl+A and Alt+A click nothing', async () => {
    mount([fake(row('a'))])
    await focusRow('a')
    await press(rowEl('a'), 'a', { metaKey: true })
    await press(rowEl('a'), 'a', { ctrlKey: true })
    await press(rowEl('a'), 'a', { altKey: true })
    expect(clicks.approve).not.toHaveBeenCalled()
  })

  it('ignores a key whose event was already handled', async () => {
    mount([fake(row('a'))])
    await focusRow('a')
    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
    event.preventDefault()
    await act(() => rowEl('a').dispatchEvent(event))
    expect(clicks.approve).not.toHaveBeenCalled()
  })

  it('A on a default-rendered draft row applies it, leaving the row Done with Undo', async () => {
    const apply = vi.fn(() => Promise.resolve())
    setReviewApplierForTests('draft', { apply, undo: vi.fn(() => Promise.resolve()) })
    const e = row('a', { actionLabel: 'Apply', ref: { type: 'draft', id: 'd1' } })
    mount([byDefault(e)])
    await focusRow('a')
    await press(rowEl('a'), 'a')
    expect(apply).toHaveBeenCalledTimes(1)
    expect(reviewStore.getState().entries[0]).toMatchObject({ id: 'a', state: 'done' })
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
  })

  it('A on a needs-you job row with an opener calls openReviewEntry', async () => {
    const open = vi.fn()
    registerReviewOpener('job', open)
    const e = row('a', { kind: 'needs-you', ref: { type: 'job', id: 'j1' } })
    mount([byDefault(e)])
    await focusRow('a')
    await press(rowEl('a'), 'a')
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('↵ and E on the draft row open it and do not apply', async () => {
    const apply = vi.fn(() => Promise.resolve())
    const open = vi.fn()
    setReviewApplierForTests('draft', { apply, undo: vi.fn(() => Promise.resolve()) })
    registerReviewOpener('draft', open)
    const e = row('a', { actionLabel: 'Apply', ref: { type: 'draft', id: 'd1' } })
    mount([byDefault(e)])
    await focusRow('a')
    await press(rowEl('a'), 'Enter')
    expect(open).toHaveBeenCalledTimes(1)
    await press(rowEl('a'), 'e')
    expect(open).toHaveBeenCalledTimes(2)
    expect(apply).not.toHaveBeenCalled()
    expect(reviewStore.getState().entries[0].state).toBe('open')
  })

  it('↵ never clicks the primary button', async () => {
    mount([fake(row('a'))])
    await focusRow('a')
    await press(rowEl('a'), 'Enter')
    expect(clicks.approve).not.toHaveBeenCalled()
  })

  it('↵ clicks the row Open when it has one', async () => {
    const open = vi.fn()
    const e = row('a', { kind: 're-check', ref: { type: 'change', id: 'c1' } })
    mount([
      {
        entry: e,
        render: () => (
          <article>
            <button type="button" className="dg-btn dg-btn--primary" onClick={() => clicks.approve('a')}>
              Approve again
            </button>
            <button type="button" className="dg-btn" onClick={open}>
              Open
            </button>
          </article>
        ),
      },
    ])
    await focusRow('a')
    await press(rowEl('a'), 'Enter')
    expect(open).toHaveBeenCalledTimes(1)
    expect(clicks.approve).not.toHaveBeenCalled()
  })

  it('Enter on a focused Edit button does not also click Approve', async () => {
    mount([fake(row('a'))])
    const edit = screen.getByRole('button', { name: 'Edit' })
    await act(() => edit.focus())
    await press(edit, 'Enter')
    await press(edit, ' ')
    expect(clicks.approve).not.toHaveBeenCalled()
  })

  it('X pressed inside a portaled sheet clicks nothing', async () => {
    const fallback = mount([{ entry: row('a'), render: (f) => <WithSheet entry={row('a')} focused={f} /> }])
    await focusRow('a')
    const save = screen.getByRole('button', { name: 'Save' })
    await act(() => save.focus())
    await press(save, 'x')
    await press(save, 'a')
    expect(clicks.dismiss).not.toHaveBeenCalled()
    expect(fallback).not.toHaveBeenCalled()
  })
})
