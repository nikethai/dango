/**
 * @vitest-environment jsdom
 */

import type { CodexThreadsDetection } from '@shared/types/sources'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  resolve: undefined as ((d: CodexThreadsDetection) => void) | undefined,
  supported: true,
}))

vi.mock('@/i18n', () => ({
  default: {
    t: (key: string, opts?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(opts?.[name] ?? '')),
  },
}))
vi.mock('@/platform', () => ({
  default: {
    detectCodexThreads: vi.fn(
      () =>
        new Promise<CodexThreadsDetection>((resolve) => {
          h.resolve = resolve
        })
    ),
  },
  platformCapabilities: {
    get supportsCodexThreads() {
      return h.supported
    },
  },
}))
vi.mock('@/packages/background', () => ({ NeedsUserError: class extends Error {} }))
vi.mock('../store', () => ({}))

import { _resetCodexDetectionForTests, codexThreadsHint, useCodexDetection } from './codex-threads'

beforeEach(() => {
  _resetCodexDetectionForTests()
  h.resolve = undefined
  h.supported = true
})

describe('useCodexDetection', () => {
  it('is undefined while looking, then the detection', async () => {
    const { result } = renderHook(() => useCodexDetection())
    expect(result.current).toBeUndefined()
    expect(codexThreadsHint(result.current)).toBe('Looking for Codex threads…')
    await act(async () => h.resolve?.({ found: false, threadCount: 0, displayPath: '~/.codex/sessions' }))
    expect(result.current).toEqual({ found: false, threadCount: 0, displayPath: '~/.codex/sessions' })
    expect(codexThreadsHint(result.current)).toBe('No Codex threads on this computer.')
  })

  it('is null where Codex threads are unavailable', async () => {
    h.supported = false
    const { result } = renderHook(() => useCodexDetection())
    await act(async () => {})
    expect(result.current).toBeNull()
    expect(codexThreadsHint(result.current)).toBe('No Codex threads on this computer.')
  })
})
