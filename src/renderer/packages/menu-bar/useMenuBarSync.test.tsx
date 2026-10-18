/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrayStatus } from './tray-status'

const h = vi.hoisted(() => ({
  count: 0,
  countSubs: new Set<() => void>(),
  label: 'main',
  supported: true,
  statuses: [] as TrayStatus[],
  toggleCb: null as null | (() => void),
  unsub: vi.fn(),
  loadReviewEntries: vi.fn(async () => undefined),
  settings: {} as Record<string, unknown>,
  setSettings: vi.fn(),
  rejectSet: false,
  sessionCb: null as null | (() => void),
  lang: 'en',
  langSubs: new Set<() => void>(),
  watcherNotify: null as null | ((e: unknown) => void),
  stopWatcher: vi.fn(),
  notifySystemEvent: vi.fn(async () => 'skipped'),
  trackAppActive: vi.fn(),
}))

vi.mock('./needs-you-watcher', () => ({
  createNeedsYouWatcher: (notify: (e: unknown) => void) => {
    h.watcherNotify = notify
    return h.stopWatcher
  },
}))
vi.mock('@/packages/notifications', () => ({
  notifySystemEvent: h.notifySystemEvent,
  trackAppActive: h.trackAppActive,
}))

vi.mock('@/i18n', () => ({
  default: {
    t: (key: string) => (h.lang === 'de' && key === 'Open Review' ? 'Review öffnen' : key),
    on: (_e: string, cb: () => void) => h.langSubs.add(cb),
    off: (_e: string, cb: () => void) => h.langSubs.delete(cb),
  },
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: (_name: string, cb: () => void) => {
    h.sessionCb = cb
    return Promise.resolve(() => undefined)
  },
}))

vi.mock('@/packages/review', async () => {
  const React = await import('react')
  return {
    loadReviewEntries: h.loadReviewEntries,
    useLastCheckedAt: () => undefined,
    useReviewWaitingCount: () =>
      React.useSyncExternalStore(
        (cb) => {
          h.countSubs.add(cb)
          return () => h.countSubs.delete(cb)
        },
        () => h.count
      ),
  }
})
vi.mock('@/platform', () => ({
  default: {
    getWindowLabel: async () => h.label,
    setTrayStatus: (s: TrayStatus) => {
      h.statuses.push(s)
      return h.rejectSet ? Promise.reject(new Error('nope')) : Promise.resolve()
    },
    onTrayPauseToggle: (cb: () => void) => {
      h.toggleCb = cb
      return h.unsub
    },
  },
  platformCapabilities: {
    get supportsDesktopOnlySettings() {
      return h.supported
    },
  },
}))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: { getState: () => ({ ...h.settings, setSettings: h.setSettings }) },
  useSettingsStore: (sel: (s: Record<string, unknown>) => unknown) => sel(h.settings),
}))

import { useMenuBarSync } from './useMenuBarSync'

const flush = () => act(async () => void (await Promise.resolve()))

beforeEach(() => {
  h.count = 0
  h.label = 'main'
  h.supported = true
  h.statuses = []
  h.toggleCb = null
  h.settings = {}
  h.rejectSet = false
  h.sessionCb = null
  h.lang = 'en'
  h.langSubs.clear()
  h.unsub.mockClear()
  h.setSettings.mockClear()
  h.loadReviewEntries.mockClear()
  h.watcherNotify = null
  h.stopWatcher.mockClear()
  h.notifySystemEvent.mockClear()
  h.trackAppActive.mockClear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useMenuBarSync', () => {
  it('pushes a new status when the count changes while hidden', async () => {
    renderHook(() => useMenuBarSync())
    await flush()
    expect(h.statuses.at(-1)?.mood).toBe('idle')
    const before = h.statuses.length
    h.count = 2
    await act(async () => h.countSubs.forEach((f) => f()))
    await flush()
    expect(h.statuses.length).toBeGreaterThan(before)
    expect(h.statuses.at(-1)?.mood).toBe('needs-you')
  })

  it('does nothing in the quick window', async () => {
    h.label = 'quick'
    renderHook(() => useMenuBarSync())
    await flush()
    expect(h.statuses).toEqual([])
    expect(h.toggleCb).toBeNull()
  })

  it('does nothing without desktop-only support', async () => {
    h.supported = false
    renderHook(() => useMenuBarSync())
    await flush()
    expect(h.statuses).toEqual([])
  })

  it('a missing or invalid backgroundPaused reads as not paused', async () => {
    h.settings = { backgroundPaused: 'yes' }
    renderHook(() => useMenuBarSync())
    await flush()
    expect(h.statuses.at(-1)?.pauseLabel).toBe('Pause background work')
    expect(h.statuses.at(-1)?.mood).not.toBe('paused')
  })

  it('pause toggle flips backgroundPaused through the store setter', async () => {
    h.settings = { backgroundPaused: false }
    renderHook(() => useMenuBarSync())
    await flush()
    act(() => h.toggleCb?.())
    expect(h.setSettings).toHaveBeenCalledWith({ backgroundPaused: true })
    h.settings = { backgroundPaused: true }
    act(() => h.toggleCb?.())
    expect(h.setSettings).toHaveBeenLastCalledWith({ backgroundPaused: false })
  })

  it('minute tick re-pushes and reloads entries; unmount cleans up', async () => {
    vi.useFakeTimers()
    const { unmount } = renderHook(() => useMenuBarSync())
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)))
    const before = h.statuses.length
    await act(async () => void (await vi.advanceTimersByTimeAsync(60_000)))
    expect(h.statuses.length).toBeGreaterThan(before)
    expect(h.loadReviewEntries).toHaveBeenCalled()
    unmount()
    const n = h.statuses.length
    await act(async () => void (await vi.advanceTimersByTimeAsync(120_000)))
    expect(h.statuses.length).toBe(n)
    expect(h.unsub).toHaveBeenCalled()
  })

  it('swallows setTrayStatus rejections', async () => {
    h.rejectSet = true
    renderHook(() => useMenuBarSync())
    await flush()
    expect(h.statuses.length).toBeGreaterThan(0)
  })

  it('re-pushes translated labels when i18n emits languageChanged', async () => {
    renderHook(() => useMenuBarSync())
    await flush()
    expect(h.statuses.at(-1)?.menu.openReview).toBe('Open Review')
    const before = h.statuses.length
    h.lang = 'de'
    act(() => h.langSubs.forEach((f) => f()))
    expect(h.statuses.length).toBe(before + 1)
    expect(h.statuses.at(-1)?.menu.openReview).toBe('Review öffnen')
  })

  it('stops listening to languageChanged on unmount', async () => {
    const { unmount } = renderHook(() => useMenuBarSync())
    await flush()
    expect(h.langSubs.size).toBe(1)
    unmount()
    expect(h.langSubs.size).toBe(0)
  })

  it('reloads entries on session:changed', async () => {
    renderHook(() => useMenuBarSync())
    await flush()
    await flush()
    expect(h.sessionCb).not.toBeNull()
    h.loadReviewEntries.mockClear()
    h.sessionCb?.()
    expect(h.loadReviewEntries).toHaveBeenCalledTimes(1)
  })

  it('starts the needs-you watcher in the main window and stops it on unmount', async () => {
    const { unmount } = renderHook(() => useMenuBarSync())
    await flush()
    await flush()
    expect(h.trackAppActive).toHaveBeenCalled()
    expect(h.watcherNotify).not.toBeNull()
    const event = { kind: 'needs_you', entryId: 'e1', text: 'Approve?' }
    h.watcherNotify?.(event)
    await flush()
    await flush()
    expect(h.notifySystemEvent).toHaveBeenCalledWith(event)
    unmount()
    expect(h.stopWatcher).toHaveBeenCalled()
  })

  it('the quick window tracks focus but does not watch', async () => {
    h.label = 'quick'
    renderHook(() => useMenuBarSync())
    await flush()
    await flush()
    expect(h.trackAppActive).toHaveBeenCalled()
    expect(h.watcherNotify).toBeNull()
  })

  it('web and mobile (single window) run the watcher', async () => {
    h.supported = false
    renderHook(() => useMenuBarSync())
    await flush()
    await flush()
    expect(h.watcherNotify).not.toBeNull()
  })
})
