import type { ReviewEntry } from '@shared/types/review'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  openAddSourceSheet: vi.fn(async (): Promise<{ sourceId: string } | null> => null),
  setReviewEntryState: vi.fn(async () => undefined),
}))

vi.mock('@/components/sources/AddSourceSheet', () => ({ openAddSourceSheet: h.openAddSourceSheet }))
vi.mock('@/packages/review/store', () => ({ setReviewEntryState: h.setReviewEntryState }))

import { openReviewEntry } from '@/packages/review/registry'
import { registerFirstRunOpener } from './opener'

const ENTRY: ReviewEntry = {
  id: 'e1',
  kind: 'needs-you',
  scopeId: 'acme',
  text: 'Connect a source so Dango has something to read.',
  sub: 'Skipped during setup',
  actionLabel: 'Connect a source',
  ref: { type: 'setup', id: 'first-run:source' },
  state: 'open',
  createdAt: 1,
}

let unregister: (() => void) | undefined

beforeEach(() => {
  h.openAddSourceSheet.mockClear()
  h.setReviewEntryState.mockClear()
})
afterEach(() => unregister?.())

describe('registerFirstRunOpener', () => {
  it('opens Add a source in the entry’s scope', async () => {
    unregister = registerFirstRunOpener()
    expect(await openReviewEntry(ENTRY)).toBe(true)
    expect(h.openAddSourceSheet).toHaveBeenCalledTimes(1)
    expect(h.openAddSourceSheet).toHaveBeenCalledWith({ scopeId: 'acme' })
  })

  it('marks the entry done once a source is connected, and leaves it open otherwise', async () => {
    unregister = registerFirstRunOpener()
    await openReviewEntry(ENTRY)
    expect(h.setReviewEntryState).not.toHaveBeenCalled()
    h.openAddSourceSheet.mockResolvedValueOnce({ sourceId: 'src1' })
    await openReviewEntry(ENTRY)
    expect(h.setReviewEntryState).toHaveBeenCalledWith({ id: 'e1' }, 'done')
  })

  it('opens only the first-run setup entry', async () => {
    unregister = registerFirstRunOpener()
    expect(await openReviewEntry({ ...ENTRY, ref: { type: 'setup', id: 'something-else' } })).toBe(false)
    expect(h.openAddSourceSheet).not.toHaveBeenCalled()
  })

  it('returns an unregister function (registered from __root like the other openers)', async () => {
    registerFirstRunOpener()()
    expect(await openReviewEntry(ENTRY)).toBe(false)
  })
})
