import type { ReviewEntry } from '@shared/types/review'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
  entries: [] as ReviewEntry[],
  subs: new Set<(entries: ReviewEntry[]) => void>(),
}))

vi.mock('@/packages/review', () => ({
  listReviewEntries: () => h.entries,
  subscribeReviewEntries: (cb: (entries: ReviewEntry[]) => void) => {
    h.subs.add(cb)
    return () => h.subs.delete(cb)
  },
}))

import { createNeedsYouWatcher } from './needs-you-watcher'

function entry(id: string, patch: Partial<ReviewEntry> = {}): ReviewEntry {
  return {
    id,
    kind: 'needs-you',
    scopeId: 'everywhere',
    text: `Entry ${id}`,
    ref: { type: 'question', id: `q-${id}` },
    state: 'open',
    createdAt: Date.now(),
    ...patch,
  }
}

function emit(entries: ReviewEntry[]) {
  h.entries = entries
  for (const cb of h.subs) cb(entries)
}

beforeEach(() => {
  h.entries = []
  h.subs.clear()
})

describe('needs-you watcher', () => {
  test('entries present on the first list never notify', () => {
    h.entries = [entry('old')]
    const notify = vi.fn()
    createNeedsYouWatcher(notify)
    emit([...h.entries])
    emit([entry('old', { text: 'changed' })])
    expect(notify).not.toHaveBeenCalled()
  })

  test('a new open needs-you entry notifies once', () => {
    h.entries = [entry('old')]
    const notify = vi.fn()
    createNeedsYouWatcher(notify)
    const fresh = entry('new', { text: 'Approve the invoice?' })
    emit([entry('old'), fresh])
    emit([entry('old'), fresh])
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith({ kind: 'needs_you', entryId: 'new', text: 'Approve the invoice?' })
  })

  test('a new proposal or done entry never does', () => {
    const notify = vi.fn()
    createNeedsYouWatcher(notify)
    emit([
      entry('p', { kind: 'proposal', ref: { type: 'proposal', id: 'p' } }),
      entry('d', { kind: 'done' }),
      entry('closed', { state: 'done' }),
    ])
    expect(notify).not.toHaveBeenCalled()
  })

  test('entries created before the watcher started never notify, even when they load later', () => {
    const notify = vi.fn()
    createNeedsYouWatcher(notify)
    emit([entry('loaded-late', { createdAt: Date.now() - 60_000 })])
    expect(notify).not.toHaveBeenCalled()
  })

  test('stop unsubscribes', () => {
    const notify = vi.fn()
    const stop = createNeedsYouWatcher(notify)
    stop()
    emit([entry('new')])
    expect(notify).not.toHaveBeenCalled()
    expect(h.subs.size).toBe(0)
  })
})
