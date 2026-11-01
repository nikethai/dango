// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useOnline } from './useOnline'

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
}

afterEach(() => {
  cleanup()
  setNavigatorOnline(true)
})

describe('useOnline', () => {
  it('follows the window online and offline events', () => {
    setNavigatorOnline(true)
    const { result } = renderHook(() => useOnline())
    expect(result.current[0]).toBe(true)

    setNavigatorOnline(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(result.current[0]).toBe(false)

    setNavigatorOnline(true)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(result.current[0]).toBe(true)
  })

  it('recheck reads the connection again (Retry on the offline notice)', () => {
    setNavigatorOnline(false)
    const { result } = renderHook(() => useOnline())
    expect(result.current[0]).toBe(false)

    setNavigatorOnline(true)
    act(() => result.current[1]())
    expect(result.current[0]).toBe(true)
  })
})
