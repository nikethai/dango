/**
 * @vitest-environment jsdom
 */
// A11Y1 rule 3: Review works from the keyboard alone (roadmap Decisions: ↑↓ or J/K move, A approve, E edit,
// X dismiss, ↵ open, ⌘Z undo, ⌘↵ approves while editing). Rows are seeded through the store (R19); slice 4's real
// proposal row renders them, with the knowledge calls mocked.
import type { ReviewEntry } from '@shared/types/review'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProposalRenderer } from '@/packages/knowledge/review/ProposalRenderer'
import { registerReviewOpener, registerReviewRenderer, reviewRegistryStore } from '@/packages/review/registry'
import { reviewStore, setReviewStorageForTests } from '@/packages/review/store'
import { resetUndoForTests, useUndoHotkey } from '@/packages/undo'
import { dismissReviewEntry } from './dismissEntry'
import { ReviewFeed } from './ReviewFeed'

const translate = vi.hoisted(
  () => (key: string, vars?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => String(vars?.[name] ?? name))
)
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }))
vi.mock('i18next', () => ({ t: translate, default: { t: translate } }))
vi.mock('@/hooks/useScopes', () => ({ useScopes: () => ({ getScope: () => undefined }) }))
vi.mock('@/packages/knowledge/scopes', () => ({ scopeName: () => 'Everywhere' }))

const platform = vi.hoisted(() => ({ os: 'Mac' }))
vi.mock('@/packages/navigator', () => ({ getOS: () => platform.os }))

const handlers = vi.hoisted(() => ({
  approve: vi.fn(async (_id: string, _opts?: { text?: string }) => undefined),
  dismiss: vi.fn(async (_id: string) => ({ offerDontSuggest: false })),
  open: vi.fn(),
}))
vi.mock('@/packages/knowledge/approve', () => ({
  approveProposal: handlers.approve,
  KnowledgeConflictError: class KnowledgeConflictError extends Error {},
}))
vi.mock('@/packages/knowledge/proposals', () => ({ dismissProposal: handlers.dismiss }))

const now = Date.now()
const entry = (n: number): ReviewEntry => ({
  id: `r${n}`,
  kind: 'proposal',
  scopeId: 'everywhere',
  text: `Fact ${n}`,
  ref: { type: 'proposal', id: `p${n}` },
  state: 'open',
  createdAt: now - n * 1000,
})

let data: Record<string, unknown>
const rowEl = (id: string) => document.querySelector(`li[data-entry-id="${id}"]`) as HTMLElement
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('li[data-entry-id]'))
const active = () => document.activeElement as HTMLElement
const tick = () => new Promise((r) => setTimeout(r, 0))
const key = (target: Element, k: string, init: Partial<KeyboardEventInit> = {}) =>
  act(async () => {
    fireEvent.keyDown(target, { key: k, ...init })
    await tick()
  })

function Harness({ children }: { children: ReactNode }) {
  useUndoHotkey()
  return <>{children}</>
}

const mount = async () => {
  const entries = [entry(1), entry(2), entry(3)]
  data['review-entries'] = { entries }
  reviewStore.setState({ entries, lastCheckedAt: undefined, loaded: true })
  render(
    <Harness>
      <ReviewFeed caughtUp={<p>Nothing needs you</p>} />
    </Harness>
  )
  await act(tick)
}

beforeEach(() => {
  platform.os = 'Mac'
  data = {}
  setReviewStorageForTests({
    getItem: async <T,>(k: string, fb: T) => (k in data ? (JSON.parse(JSON.stringify(data[k])) as T) : fb),
    setItemNow: vi.fn((k: string, v: unknown) => {
      data[k] = JSON.parse(JSON.stringify(v))
      return Promise.resolve()
    }),
  })
  resetUndoForTests()
  handlers.approve.mockClear()
  handlers.open.mockClear()
  // The real dismiss writes the knowledge store and pushes its own undo; here the row goes the same way.
  handlers.dismiss.mockReset()
  handlers.dismiss.mockImplementation(async (proposalId: string) => {
    const id = reviewStore.getState().entries.find((e) => e.ref.id === proposalId)?.id
    if (id) await dismissReviewEntry(id, `Dismissed "${proposalId}"`)
    return { offerDontSuggest: false }
  })
  registerReviewRenderer('proposal', ProposalRenderer, { refType: 'proposal' })
  registerReviewOpener('proposal', handlers.open)
})
afterEach(() => {
  cleanup()
  reviewRegistryStore.setState({ openers: {}, renderers: {} })
  setReviewStorageForTests(null)
})

describe('Review is keyboard first (A11Y1 rule 3)', () => {
  it('exactly one row is a tab stop, and it follows focus', async () => {
    await mount()
    expect(rows().filter((r) => r.tabIndex === 0)).toEqual([rowEl('r1')])
    await key(rowEl('r1'), 'ArrowDown')
    expect(rows().filter((r) => r.tabIndex === 0)).toEqual([rowEl('r2')])
    // Focus leaving the feed keeps the last row as the way back in.
    await act(() => active().blur())
    expect(rows().filter((r) => r.tabIndex === 0)).toEqual([rowEl('r2')])
  })

  it('when the stop row leaves while focus is outside the feed, the next row becomes the stop', async () => {
    await mount()
    await key(rowEl('r1'), 'ArrowDown')
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    try {
      await act(() => outside.focus())
      const setEntries = (entries: ReviewEntry[]) =>
        act(async () => {
          data['review-entries'] = { entries }
          reviewStore.setState({ entries })
          await tick()
        })
      await setEntries([entry(1), entry(3)])
      expect(rowEl('r2')).toBeNull()
      expect(rows().filter((r) => r.tabIndex === 0)).toEqual([rowEl('r3')])
      expect(active()).toBe(outside)
      // A newer row arriving on top does not take the stop.
      await setEntries([{ ...entry(0), createdAt: now + 1000 }, entry(1), entry(3)])
      expect(rows().filter((r) => r.tabIndex === 0)).toEqual([rowEl('r3')])
      expect(active()).toBe(outside)
    } finally {
      outside.remove()
    }
  })

  it('↓ and J move to the next row, ↑ and K back; the focused row shows is-focused', async () => {
    await mount()
    const ring = () => rows().filter((r) => r.querySelector('.is-focused'))
    expect(active()).toBe(rowEl('r1'))
    expect(ring()).toEqual([rowEl('r1')])
    await key(rowEl('r1'), 'ArrowDown')
    expect(active()).toBe(rowEl('r2'))
    await key(rowEl('r2'), 'j')
    expect(active()).toBe(rowEl('r3'))
    expect(ring()).toEqual([rowEl('r3')])
    await key(rowEl('r3'), 'ArrowUp')
    expect(active()).toBe(rowEl('r2'))
    await key(rowEl('r2'), 'k')
    expect(active()).toBe(rowEl('r1'))
    expect(ring()).toEqual([rowEl('r1')])
  })

  it('→ moves into the row’s first action, ← returns to the row', async () => {
    await mount()
    await key(rowEl('r1'), 'ArrowRight')
    expect(active().tagName).toBe('BUTTON')
    expect(active().textContent).toBe('Approve')
    expect(rowEl('r1').contains(active())).toBe(true)
    await key(active(), 'ArrowLeft')
    expect(active()).toBe(rowEl('r1'))
  })

  it('A approves, E edits, ↵ opens', async () => {
    await mount()
    await key(rowEl('r1'), 'a')
    expect(handlers.approve).toHaveBeenCalledWith('p1')
    await key(rowEl('r1'), 'Enter')
    expect(handlers.open).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }))
    await key(rowEl('r1'), 'e')
    expect(active().tagName).toBe('TEXTAREA')
    expect(rowEl('r1').contains(active())).toBe(true)
  })

  it('X dismisses, the next row takes focus, and ⌘Z brings the row back', async () => {
    await mount()
    await key(rowEl('r1'), 'x')
    expect(handlers.dismiss).toHaveBeenCalledWith('p1')
    await waitFor(() => expect(rowEl('r1')).toBeNull())
    expect(active()).toBe(rowEl('r2'))
    await key(active(), 'z', { metaKey: true })
    await waitFor(() => expect(rowEl('r1')).not.toBeNull())
  })

  it('Ctrl+Z undoes outside macOS', async () => {
    platform.os = 'Windows'
    await mount()
    await key(rowEl('r1'), 'x')
    await waitFor(() => expect(rowEl('r1')).toBeNull())
    await key(active(), 'z', { ctrlKey: true })
    await waitFor(() => expect(rowEl('r1')).not.toBeNull())
  })

  it('inside the edit field keys are text, and ⌘↵ approves the edit', async () => {
    await mount()
    await key(rowEl('r1'), 'e')
    const field = active() as HTMLTextAreaElement
    expect(field.tagName).toBe('TEXTAREA')
    for (const k of ['a', 'x', 'e', 'j', 'k', 'ArrowDown', 'ArrowLeft', 'Enter']) await key(field, k)
    expect(handlers.approve).not.toHaveBeenCalled()
    expect(handlers.dismiss).not.toHaveBeenCalled()
    expect(handlers.open).not.toHaveBeenCalled()
    expect(active()).toBe(field)
    await act(async () => fireEvent.change(field, { target: { value: 'Fact 1, edited' } }))
    await key(field, 'Enter', { metaKey: true })
    expect(handlers.approve).toHaveBeenCalledWith('p1', { text: 'Fact 1, edited' })
  })
})
