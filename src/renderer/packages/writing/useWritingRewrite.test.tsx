// @vitest-environment jsdom

import type { WritingRequest } from '@shared/types/writing'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WritingResult } from './rewrite'

vi.mock('./runtime', () => ({ requestWritingRewrite: vi.fn() }))

import { requestWritingRewrite } from './runtime'
import { useWritingRewrite, WRITING_TIMEOUT_MS } from './useWritingRewrite'

const request: WritingRequest = {
  draft: 'Original draft',
  style: 'clearer',
  model: { provider: 'gemini', modelId: 'test' },
}

function deferred() {
  let resolve!: (result: WritingResult) => void
  let reject!: (error: Error) => void
  const promise = new Promise<WritingResult>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('writing request lifecycle', () => {
  it('replaces streaming text with a completed result', async () => {
    vi.mocked(requestWritingRewrite).mockImplementation((input, callbacks) => {
      callbacks.onText?.('In progress')
      return Promise.resolve({ request: input, text: 'Complete' })
    })
    const { result } = renderHook(() => useWritingRewrite())
    await act(async () => {
      await result.current.rewrite(request)
    })
    expect(result.current.state).toEqual({ status: 'complete', result: { request, text: 'Complete' } })
  })

  it('aborts and ignores late callbacks after editing/reset', async () => {
    const pending = deferred()
    vi.mocked(requestWritingRewrite).mockReturnValue(pending.promise)
    const { result } = renderHook(() => useWritingRewrite())
    act(() => {
      void result.current.rewrite(request)
    })
    const callbacks = vi.mocked(requestWritingRewrite).mock.calls[0][1]
    act(() => {
      result.current.reset()
    })
    expect(callbacks.signal.aborted).toBe(true)
    await act(async () => {
      callbacks.onText?.('STALE_TEXT')
      pending.resolve({ request, text: 'STALE_TEXT' })
      await pending.promise
    })
    expect(result.current.state).toEqual({ status: 'idle' })
  })

  it('cancels without accepting a late completion', async () => {
    const pending = deferred()
    vi.mocked(requestWritingRewrite).mockReturnValue(pending.promise)
    const { result } = renderHook(() => useWritingRewrite())
    act(() => {
      void result.current.rewrite(request)
    })
    act(() => {
      result.current.cancel()
    })
    await act(async () => {
      pending.resolve({ request, text: 'Too late' })
      await pending.promise
    })
    expect(result.current.state).toEqual({ status: 'cancelled' })
  })

  it('never lets an older request overwrite a newer result', async () => {
    const first = deferred()
    const second = deferred()
    vi.mocked(requestWritingRewrite).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result } = renderHook(() => useWritingRewrite())
    act(() => {
      void result.current.rewrite(request)
    })
    act(() => {
      void result.current.rewrite({ ...request, draft: 'New draft' })
    })
    await act(async () => {
      second.resolve({ request: { ...request, draft: 'New draft' }, text: 'New result' })
      await second.promise
      first.resolve({ request, text: 'Old result' })
      await first.promise
    })
    expect(result.current.state).toMatchObject({ status: 'complete', result: { text: 'New result' } })
  })

  it('aborts when the review unmounts', () => {
    vi.mocked(requestWritingRewrite).mockReturnValue(deferred().promise)
    const { result, unmount } = renderHook(() => useWritingRewrite())
    act(() => {
      void result.current.rewrite(request)
    })
    const signal = vi.mocked(requestWritingRewrite).mock.calls[0][1].signal
    unmount()
    expect(signal.aborted).toBe(true)
  })

  it('stops a stalled request and ignores later completion', async () => {
    vi.useFakeTimers()
    const pending = deferred()
    vi.mocked(requestWritingRewrite).mockReturnValue(pending.promise)
    const { result } = renderHook(() => useWritingRewrite())
    act(() => {
      void result.current.rewrite(request)
    })
    act(() => {
      vi.advanceTimersByTime(WRITING_TIMEOUT_MS)
    })
    expect(result.current.state).toEqual({ status: 'error', code: 'timeout' })
    expect(vi.mocked(requestWritingRewrite).mock.calls[0][1].signal.aborted).toBe(true)
    await act(async () => {
      pending.resolve({ request, text: 'Too late' })
      await pending.promise
    })
    expect(result.current.state).toEqual({ status: 'error', code: 'timeout' })
  })

  it('does not put raw unexpected errors into state', async () => {
    vi.mocked(requestWritingRewrite).mockRejectedValue(new Error('SECRET_PROVIDER_BODY'))
    const { result } = renderHook(() => useWritingRewrite())
    act(() => {
      void result.current.rewrite(request)
    })
    await waitFor(() => expect(result.current.state).toEqual({ status: 'error', code: 'request_failed' }))
  })
})
