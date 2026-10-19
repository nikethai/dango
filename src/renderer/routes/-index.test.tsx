/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  memory: new Map<string, unknown>(),
  failRead: false,
  props: [] as Array<{ sourceCount?: number }>,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ options: opts }),
  redirect: vi.fn(),
}))
vi.mock('@tanstack/zod-adapter', () => ({ zodValidator: (schema: unknown) => schema }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('@/components/layout/Page', () => ({
  default: ({ children }: { children: unknown }) => <div>{children as never}</div>,
}))
vi.mock('@/components/review/ReviewHome', () => ({
  ReviewHome: (props: { sourceCount?: number }) => {
    h.props.push(props)
    return <div>review-home {String(props.sourceCount)}</div>
  },
}))
// The real sources store over in-memory storage; only the hooks the route uses.
vi.mock('@/packages/sources', async () => {
  const store = await import('@/packages/sources/store')
  return { useSources: store.useSources, useSourcesLoaded: store.useSourcesLoaded }
})
vi.mock('@/storage', () => ({
  StorageKey: { Sources: 'sources' },
  default: {
    getItem: <T,>(key: string, fallback: T): Promise<T> =>
      h.failRead
        ? Promise.reject(new Error('read failed'))
        : Promise.resolve(h.memory.has(key) ? (h.memory.get(key) as T) : fallback),
    setItemNow: async () => undefined,
    removeItem: async () => undefined,
  },
}))
vi.mock('@/storage/StoreStorage', () => ({ StorageKeyGenerator: { sourceCursor: (id: string) => `c:${id}` } }))
vi.mock('@/platform', () => ({ default: {} }))
vi.mock('@/packages/background', () => ({
  listJobs: () => [],
  stopJob: vi.fn(),
  setJobSourceResolver: vi.fn(),
}))
vi.mock('@/packages/knowledge', () => ({ markSourceRemoved: vi.fn() }))
vi.mock('@/packages/review', () => ({
  loadReviewEntries: vi.fn(),
  reviewStore: { getState: () => ({ entries: [] }) },
  setReviewEntryState: vi.fn(),
}))
vi.mock('@/i18n', () => ({ default: { t: (k: string) => k } }))

import { _resetSourcesForTests } from '@/packages/sources/store'
import { Route } from './index'

const Index = (Route as unknown as { options: { component: ComponentType } }).options.component

const stored = (id: string) => ({
  id,
  kind: 'folder',
  scopeId: 'dango',
  label: id,
  backgroundReview: false,
  localOnly: false,
  config: {},
  connectedAt: 1,
})

beforeEach(() => {
  h.memory.clear()
  h.failRead = false
  h.props = []
  _resetSourcesForTests()
})

afterEach(cleanup)

describe('Review route', () => {
  it('Review gets the source count', async () => {
    h.memory.set('sources', [stored('a'), stored('b')])
    render(<Index />)
    await screen.findByText('review-home 2')
    expect(h.props.at(-1)).toEqual({ sourceCount: 2 })
  })

  it('with none stored, sourceCount is 0', async () => {
    render(<Index />)
    await screen.findByText('review-home 0')
    expect(h.props.at(-1)).toEqual({ sourceCount: 0 })
  })

  it('passes no count before the sources have loaded (R4)', async () => {
    h.failRead = true
    render(<Index />)
    await waitFor(() => expect(h.props.length).toBeGreaterThan(0))
    expect(h.props.every((p) => p.sourceCount === undefined)).toBe(true)
  })
})
