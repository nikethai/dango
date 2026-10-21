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
  }
})

vi.mock('@/platform/windowRole', () => ({
  knownWindowRole: () => h.known,
  getWindowRole: h.getWindowRole,
}))
vi.mock('@/stores/settingActions', () => ({ needEditSetting: () => h.needEdit }))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (s: typeof h.state) => unknown) => selector(h.state),
  settingsStore: { getState: () => h.state },
}))

import { useFirstRunGate, useFirstRunResolution } from './useFirstRun'

beforeEach(() => {
  h.known = undefined
  h.needEdit = true
  h.state.firstRun = undefined
  h.getWindowRole.mockClear()
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

  it('never redirects an upgrading user who has a model', () => {
    h.known = 'jobs'
    h.needEdit = false
    const navigate = vi.fn()
    renderHook(() => useFirstRunGate('/', navigate))
    expect(navigate).not.toHaveBeenCalled()
  })
})
