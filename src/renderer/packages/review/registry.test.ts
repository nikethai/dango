import type { ReviewEntry } from '@shared/types/review'
import type { ComponentType } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ReviewRendererProps } from './registry'
import {
  getReviewRenderer,
  hasReviewOpener,
  openReviewEntry,
  registerReviewOpener,
  registerReviewRenderer,
} from './registry'

const entry = (over: Partial<ReviewEntry> = {}): ReviewEntry => ({
  id: 'r',
  kind: 'change',
  scopeId: 's',
  text: 't',
  ref: { type: 'job', id: 'j' },
  state: 'open',
  createdAt: 1,
  ...over,
})
const comp = () => (() => null) as ComponentType<ReviewRendererProps>

describe('review openers', () => {
  it('registers, opens and unregisters', async () => {
    const e = entry()
    expect(hasReviewOpener(e)).toBe(false)
    expect(await openReviewEntry(e)).toBe(false)
    const open = vi.fn()
    const off = registerReviewOpener('job', open)
    expect(hasReviewOpener(e)).toBe(true)
    expect(await openReviewEntry(e)).toBe(true)
    expect(open).toHaveBeenCalledWith(e)
    off()
    expect(hasReviewOpener(e)).toBe(false)
    expect(await openReviewEntry(e)).toBe(false)
  })

  it('an opener with canOpen opens only the entries it accepts', async () => {
    const open = vi.fn()
    const off = registerReviewOpener('job', open, { canOpen: (x) => x.text === 'yes' })
    expect(hasReviewOpener(entry({ text: 'yes' }))).toBe(true)
    expect(hasReviewOpener(entry({ text: 'no' }))).toBe(false)
    expect(await openReviewEntry(entry({ text: 'no' }))).toBe(false)
    expect(open).not.toHaveBeenCalled()
    expect(await openReviewEntry(entry({ text: 'yes' }))).toBe(true)
    expect(open).toHaveBeenCalledTimes(1)
    off()
  })

  it('an older unregister does not remove a replacement', async () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = registerReviewOpener('change', a)
    const offB = registerReviewOpener('change', b)
    offA()
    const e = entry({ ref: { type: 'change', id: 'c' } })
    expect(await openReviewEntry(e)).toBe(true)
    expect(b).toHaveBeenCalled()
    expect(a).not.toHaveBeenCalled()
    offB()
  })
})

describe('review renderers', () => {
  const p = (type: 'proposal' | 'draft') => ({ kind: 'proposal' as const, ref: { type, id: 'p' } })

  it('returns undefined until registered', () => {
    expect(getReviewRenderer(p('proposal'))).toBeUndefined()
    const A = comp()
    const off = registerReviewRenderer('proposal', A)
    expect(getReviewRenderer(p('proposal'))).toBe(A)
    off()
    expect(getReviewRenderer(p('proposal'))).toBeUndefined()
  })

  it('refType-specific wins, bare kind is the fallback', () => {
    const A = comp()
    const B = comp()
    const offA = registerReviewRenderer('proposal', A, { refType: 'proposal' })
    expect(getReviewRenderer(p('draft'))).toBeUndefined()
    const offB = registerReviewRenderer('proposal', B)
    expect(getReviewRenderer(p('draft'))).toBe(B)
    expect(getReviewRenderer(p('proposal'))).toBe(A)
    offA()
    offB()
  })

  it('an older unregister does not remove a replacement', () => {
    const A = comp()
    const B = comp()
    const offA = registerReviewRenderer('re-check', A)
    const offB = registerReviewRenderer('re-check', B)
    offA()
    expect(getReviewRenderer({ kind: 're-check', ref: { type: 'knowledge', id: 'k' } })).toBe(B)
    offB()
  })
})
