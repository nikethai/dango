// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  let resolveRole: (role: 'jobs' | 'quick' | 'other') => void = () => {}
  return {
    known: undefined as 'jobs' | 'quick' | 'other' | undefined,
    getWindowRole: vi.fn(
      () =>
        new Promise<'jobs' | 'quick' | 'other'>((resolve) => {
          resolveRole = resolve
        })
    ),
    resolveRole: (role: 'jobs' | 'quick' | 'other') => resolveRole(role),
    needEdit: true,
    state: { firstRun: undefined as unknown, providers: {} },
    setSettings: vi.fn(),
  }
})

vi.mock('@/platform/windowRole', () => ({
  knownWindowRole: () => h.known,
  getWindowRole: h.getWindowRole,
}))
vi.mock('@/stores/settingActions', () => ({ needEditSetting: () => h.needEdit }))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (s: typeof h.state) => unknown) => selector(h.state),
  settingsStore: { getState: () => ({ ...h.state, setSettings: h.setSettings }) },
}))

import { useFirstRunGate, useFirstRunResolution } from './useFirstRun'

beforeEach(() => {
  h.known = undefined
  h.needEdit = true
  h.state.firstRun = undefined
  h.getWindowRole.mockClear()
  h.setSettings.mockReset()
  h.setSettings.mockImplementation((patch: Partial<typeof h.state>) => Object.assign(h.state, patch))
})
afterEach(cleanup)

describe('useFirstRunResolution', () => {
  it('reads the record and whether a model exists', () => {
    h.needEdit = false
    h.state.firstRun = { step: 3, sourceSkipped: false }
    const { result } = renderHook(() => useFirstRunResolution())
    expect(result.current).toEqual({ show: true, step: 3, modelOnly: false })
  })
})

describe('useFirstRunGate', () => {
  it('does not redirect while the role is pending, nor once it resolves to quick', async () => {
    const navigate = vi.fn()
    renderHook(() => useFirstRunGate('/', navigate))
    expect(navigate).not.toHaveBeenCalled()
    await act(async () => h.resolveRole('quick'))
    expect(navigate).not.toHaveBeenCalled()
  })

  it('does not redirect another desktop window', async () => {
    const navigate = vi.fn()
    renderHook(() => useFirstRunGate('/', navigate))
    await act(async () => h.resolveRole('other'))
    expect(navigate).not.toHaveBeenCalled()
  })

  it('redirects the main desktop window once its role resolves, carrying the path', async () => {
    const navigate = vi.fn()
    renderHook(() => useFirstRunGate('/session/abc', navigate))
    await act(async () => h.resolveRole('jobs'))
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('/first-run', '/session/abc')
  })

  it('redirects at once when the role is known (web, mobile)', () => {
    h.known = 'jobs'
    const navigate = vi.fn()
    renderHook(() => useFirstRunGate('/', navigate))
    expect(navigate).toHaveBeenCalledWith('/first-run', '/')
    expect(h.getWindowRole).not.toHaveBeenCalled()
  })

  it('runs again on every path change, leaving settings alone', () => {
    h.known = 'jobs'
    const navigate = vi.fn()
    const { rerender } = renderHook(({ path }) => useFirstRunGate(path, navigate), {
      initialProps: { path: '/settings/provider' },
    })
    expect(navigate).not.toHaveBeenCalled()
    rerender({ path: '/' })
    expect(navigate).toHaveBeenCalledWith('/first-run', '/')
  })

  it('marks an upgrading user with a model completed and never redirects', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234)
    h.known = 'jobs'
    h.needEdit = false
    const navigate = vi.fn()
    const { rerender } = renderHook(() => useFirstRunGate('/', navigate))
    rerender()
    expect(navigate).not.toHaveBeenCalled()
    expect(h.setSettings).toHaveBeenCalledTimes(1)
    expect(h.setSettings).toHaveBeenCalledWith({ firstRun: { step: 5, sourceSkipped: false, completedAt: 1234 } })
    vi.restoreAllMocks()
  })

  it('after that marker, removing every model shows only step 1 and redirects', () => {
    h.known = 'jobs'
    h.needEdit = false
    const navigate = vi.fn()
    const { rerender } = renderHook(() => useFirstRunGate('/session/abc', navigate))
    h.needEdit = true
    rerender()
    expect(renderHook(() => useFirstRunResolution()).result.current).toEqual({ show: true, step: 1, modelOnly: true })
    expect(navigate).toHaveBeenCalledWith('/first-run', '/session/abc')
    expect(h.setSettings).toHaveBeenCalledTimes(1)
  })

  it('records a new user without a model at step 1, once', () => {
    h.known = 'jobs'
    const navigate = vi.fn()
    const { rerender } = renderHook(() => useFirstRunGate('/', navigate))
    rerender()
    expect(h.setSettings).toHaveBeenCalledTimes(1)
    expect(h.setSettings).toHaveBeenCalledWith({ firstRun: { step: 1, sourceSkipped: false } })
  })

  it('writes nothing in the quick window, another window, or while the role is pending', async () => {
    h.needEdit = false
    renderHook(() => useFirstRunGate('/', vi.fn()))
    expect(h.setSettings).not.toHaveBeenCalled()
    await act(async () => h.resolveRole('quick'))
    expect(h.setSettings).not.toHaveBeenCalled()
    renderHook(() => useFirstRunGate('/', vi.fn()))
    await act(async () => h.resolveRole('other'))
    expect(h.setSettings).not.toHaveBeenCalled()
  })

  it('passes from with its query and hash', () => {
    h.known = 'jobs'
    const navigate = vi.fn()
    renderHook(() => useFirstRunGate('/session/abc', navigate, '/session/abc?thread=t1#m2'))
    expect(navigate).toHaveBeenCalledWith('/first-run', '/session/abc?thread=t1#m2')
  })

  describe('pending (M1: nothing is painted before the redirect)', () => {
    it('is pending for a new user while the role is unknown, and while the redirect is in flight', async () => {
      const { result, rerender } = renderHook(({ path }) => useFirstRunGate(path, vi.fn()), {
        initialProps: { path: '/' },
      })
      expect(result.current).toBe(true)
      await act(async () => h.resolveRole('jobs'))
      // navigate was called; the location still says / until the router moves.
      expect(result.current).toBe(true)
      rerender({ path: '/first-run' })
      expect(result.current).toBe(false)
    })

    it('is not pending once the role resolves to the quick window or another window', async () => {
      const { result } = renderHook(() => useFirstRunGate('/', vi.fn()))
      expect(result.current).toBe(true)
      await act(async () => h.resolveRole('quick'))
      expect(result.current).toBe(false)
    })

    it('is never pending for an upgrading user, nor on Settings', () => {
      h.needEdit = false
      expect(renderHook(() => useFirstRunGate('/', vi.fn())).result.current).toBe(false)
      h.needEdit = true
      h.known = 'jobs'
      expect(renderHook(() => useFirstRunGate('/settings/provider', vi.fn())).result.current).toBe(false)
    })
  })
})
