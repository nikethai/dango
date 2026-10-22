import { afterEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => [] as string[])
const state = vi.hoisted(() => ({ sources: [{ id: 'g1', removalPendingAt: 1 }] as unknown[] }))

vi.mock('@/packages/background', () => ({
  listJobs: () => [],
  registerJobHandler: vi.fn(),
  registerJobReviewOpener: vi.fn(),
  resumeJobs: vi.fn(async () => undefined),
  subscribeBackgroundJobs: vi.fn(() => () => undefined),
}))
vi.mock('@/packages/sources', () => ({
  adoptExistingFolderBindings: vi.fn(async () => undefined),
  dueCheckIntervalMs: (ms: number) => ms,
  finishPendingRemovals: vi.fn(async () => {
    calls.push('finish:start')
    await new Promise((resolve) => setTimeout(resolve, 5))
    calls.push('finish:end')
  }),
  loadSources: vi.fn(async () => undefined),
  registerSourceFixHandlers: vi.fn(),
  registerSourcesResolver: vi.fn(),
  reviewJobHandler: {},
  sourcesStore: { getState: () => ({ loaded: true, sources: state.sources }) },
  startDueJobs: vi.fn(() => {
    calls.push('startDueJobs')
  }),
  syncJobHandler: {},
}))
vi.mock('@/platform', () => ({ default: { type: 'web' } }))
vi.mock('@/platform/windowRole', () => ({ getWindowRole: vi.fn(async () => 'jobs') }))
vi.mock('@/hooks/useScopes', () => ({ readScopes: vi.fn(async () => []) }))

import { finishPendingRemovals } from '@/packages/sources'
import { _stopBackgroundJobsForTests, initBackgroundJobs } from './background_jobs'

afterEach(() => {
  _stopBackgroundJobsForTests()
})

describe('initBackgroundJobs launch check', () => {
  it('finishes source removals pending at quit before it starts any due job', async () => {
    await initBackgroundJobs()
    expect(calls).toEqual(['finish:start', 'finish:end', 'startDueJobs'])
    expect(finishPendingRemovals).toHaveBeenCalledWith(state.sources, expect.any(Number))
  })
})
