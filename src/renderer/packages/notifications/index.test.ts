/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ACTIVE_HEARTBEAT_MS, ACTIVE_WINDOW_KEY } from './active-window'

vi.mock('@/platform', () => ({
  default: {
    onWindowFocused: () => () => undefined,
    getSystemNotificationPermission: async () => 'granted',
    requestSystemNotificationPermission: async () => 'granted',
    showSystemNotification: async () => undefined,
  },
  isCapacitorMobile: false,
}))
// Notifications are off in this window's (possibly stale) settings: the quick window must still count as active.
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: () => ({ extension: { notifications: { enabled: false } } }),
    subscribe: vi.fn(() => () => undefined),
  },
}))

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('notifications index', () => {
  test('the heartbeat writes the focus flag whatever the notifications setting', async () => {
    vi.useFakeTimers()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const { trackAppActive } = await import('./index')
    trackAppActive()
    const first = JSON.parse(localStorage.getItem(ACTIVE_WINDOW_KEY) ?? 'null') as { at: number } | null
    expect(first).not.toBeNull()
    vi.advanceTimersByTime(ACTIVE_HEARTBEAT_MS)
    const next = JSON.parse(localStorage.getItem(ACTIVE_WINDOW_KEY) ?? 'null') as { at: number } | null
    expect(next?.at).toBeGreaterThan(first?.at ?? Number.POSITIVE_INFINITY)
    const { settingsStore } = await import('@/stores/settingsStore')
    expect(settingsStore.subscribe).not.toHaveBeenCalled()
  })
})
