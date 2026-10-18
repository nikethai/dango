import type { ReviewEntry } from '@shared/types/review'
import { describe, expect, it, vi } from 'vitest'
import { defaultActions } from './defaultActions'

const entry = (over: Partial<ReviewEntry> = {}): ReviewEntry => ({
  id: 'r1',
  kind: 'needs-you',
  scopeId: 's',
  text: 'Which quote is current?',
  ref: { type: 'question', id: 'q1' },
  state: 'open',
  createdAt: 1,
  ...over,
})
const handlers = () => ({ open: vi.fn(), undo: vi.fn(), approve: vi.fn(), dismiss: vi.fn() })
const ctx = (over = {}) => ({ canOpen: true, canUndo: true, canApply: false, ...over })
const labels = (a: { label: string }[]) => a.map((x) => x.label)

describe('defaultActions', () => {
  it('done: Open then Undo', () => {
    expect(labels(defaultActions(entry({ kind: 'done', state: 'done' }), handlers(), ctx()))).toEqual(['Open', 'Undo'])
  })
  it('done with nothing available has no actions', () => {
    expect(defaultActions(entry({ kind: 'done' }), handlers(), ctx({ canOpen: false, canUndo: false }))).toEqual([])
  })
  it('a resolved row of any kind shows as done', () => {
    expect(labels(defaultActions(entry({ state: 'done' }), handlers(), ctx({ canUndo: false })))).toEqual(['Open'])
  })
  it('needs-you: Answer, Dismiss', () => {
    const a = defaultActions(entry(), handlers(), ctx())
    expect(labels(a)).toEqual(['Answer', 'Dismiss'])
    expect(a[0].variant).toBe('primary')
    expect(a[1].variant).toBe('ghost')
  })
  it('needs-you without an opener: Dismiss only', () => {
    expect(labels(defaultActions(entry(), handlers(), ctx({ canOpen: false })))).toEqual(['Dismiss'])
  })
  it('change: Open, Dismiss', () => {
    expect(labels(defaultActions(entry({ kind: 'change' }), handlers(), ctx()))).toEqual(['Open', 'Dismiss'])
  })
  it('proposal with an applier: Approve, Dismiss; without: Dismiss', () => {
    const e = entry({ kind: 'proposal', ref: { type: 'draft', id: 'd' } })
    expect(labels(defaultActions(e, handlers(), ctx({ canApply: true })))).toEqual(['Approve', 'Dismiss'])
    expect(labels(defaultActions(e, handlers(), ctx({ canOpen: false })))).toEqual(['Dismiss'])
  })
  it('orphan kinds get Dismiss', () => {
    expect(labels(defaultActions(entry({ kind: 'conflict' }), handlers(), ctx()))).toEqual(['Dismiss'])
    expect(labels(defaultActions(entry({ kind: 're-check' }), handlers(), ctx()))).toEqual(['Dismiss'])
  })
  it('actionLabel with an opener replaces Answer', () => {
    const h = handlers()
    const a = defaultActions(entry({ actionLabel: 'Sign in again' }), h, ctx())
    expect(labels(a)).toEqual(['Sign in again', 'Dismiss'])
    a[0].onClick()
    expect(h.open).toHaveBeenCalledTimes(1)
  })
  it('a draft with actionLabel and an applier approves, not opens', () => {
    const h = handlers()
    const e = entry({ kind: 'proposal', risk: 'risky', actionLabel: 'Apply', ref: { type: 'draft', id: 'd' } })
    const a = defaultActions(e, h, ctx({ canApply: true }))
    expect(labels(a)).toEqual(['Apply', 'Dismiss'])
    a[0].onClick()
    expect(h.approve).toHaveBeenCalledTimes(1)
    expect(h.open).not.toHaveBeenCalled()
  })
  it('the same draft with no applier but an opener opens', () => {
    const h = handlers()
    const e = entry({ kind: 'proposal', actionLabel: 'Apply', ref: { type: 'draft', id: 'd' } })
    const a = defaultActions(e, h, ctx())
    a[0].onClick()
    expect(h.open).toHaveBeenCalledTimes(1)
  })
  it('actionLabel with neither: no primary', () => {
    expect(labels(defaultActions(entry({ actionLabel: 'X' }), handlers(), ctx({ canOpen: false })))).toEqual([
      'Dismiss',
    ])
  })
})
