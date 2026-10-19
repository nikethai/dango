import type { SystemNotificationsConfig } from '@shared/types'
import platform, { isCapacitorMobile } from '@/platform'
import { settingsStore } from '@/stores/settingsStore'
import { ACTIVE_HEARTBEAT_MS, createActiveWindowTracker } from './active-window'
import { NotificationService, routeNotificationClick } from './notification-service'
import { createSeenEntriesLedger } from './seen-entries'
import { DEFAULT_NOTIFICATIONS_CONFIG, type NotifyEvent, type NotifyResult } from './types'

export { NotificationService, routeNotificationClick } from './notification-service'
export type {
  NotificationServiceDeps,
  NotifyEvent,
  NotifyResult,
  SystemNotificationKind,
} from './types'
export { DEFAULT_NOTIFICATIONS_CONFIG, LONG_RUN_MS, NOTIFY_MIN_GAP_MS } from './types'

/** Shared by every window of this origin, so the 10-minute gap holds across the main and quick windows. */
const LAST_SHOWN_KEY = 'dango.notify.last-shown-at'

let focusWired = false
let clickWired = false
let i18nWired = false

function localStore(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** This window's real focus. On mobile, document.hasFocus() is unreliable; visibility is enough. */
function probeFocus(): boolean {
  if (typeof document === 'undefined') return false
  const visible = document.visibilityState === 'visible'
  return isCapacitorMobile ? visible : visible && document.hasFocus()
}

const activeWindow = createActiveWindowTracker({
  id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  storage: localStore,
  now: () => Date.now(),
  probeFocus,
})

const seenEntries = createSeenEntriesLedger({ storage: localStore, now: () => Date.now() })

function wireI18n() {
  if (i18nWired) return
  i18nWired = true
  void import('@/i18n')
    .then((mod) => {
      const i18n = mod.default
      notificationService.setDeps({
        t: (key, options) => String(i18n.t(key, options as Record<string, unknown>)),
      })
    })
    .catch(() => {
      i18nWired = false
    })
}

function wireFocusTracking() {
  if (focusWired || typeof window === 'undefined' || typeof document === 'undefined') return
  focusWired = true

  const refresh = () => activeWindow.setFocused(probeFocus())
  document.addEventListener('visibilitychange', refresh)
  window.addEventListener('focus', () => activeWindow.setFocused(true))
  window.addEventListener('blur', () => activeWindow.setFocused(false))
  window.addEventListener('pagehide', () => activeWindow.setFocused(false))
  refresh()
  // Always on: settings are not synced across windows, so a window with a stale "off" must still report its focus.
  setInterval(() => activeWindow.heartbeat(), ACTIVE_HEARTBEAT_MS)

  // Desktop Tauri emits this to every window; re-read this window's own focus.
  try {
    platform.onWindowFocused(refresh)
  } catch {
    // ignore
  }

  // Capacitor native app state (background / foreground)
  if (isCapacitorMobile) {
    void import('@capacitor/app')
      .then(({ App }) =>
        App.addListener('appStateChange', ({ isActive }) => {
          activeWindow.setFocused(isActive)
        })
      )
      .catch(() => {
        // plugin may be unavailable in pure web
      })
  }
}

function wireClickNavigation() {
  if (clickWired || typeof window === 'undefined') return
  clickWired = true
  if (!platform.onSystemNotificationClick) return

  platform.onSystemNotificationClick((payload) => {
    void (async () => {
      // A click raised by the quick window opens the chat or Review in the main window, never in the quick window.
      let inQuickWindow = false
      try {
        inQuickWindow = Boolean(platform.openInMain) && (await platform.getWindowLabel?.()) === 'quick'
      } catch {
        inQuickWindow = false
      }
      await routeNotificationClick(payload, {
        showMainWindow: () => platform.showMainWindow?.() ?? Promise.resolve(),
        navigate: (to) => {
          void import('@/router').then(({ router }) => router.navigate({ to: to as never }))
        },
        openInMain: inQuickWindow ? (to) => platform.openInMain?.(to) ?? Promise.resolve() : undefined,
      })
    })()
  })
}

function getNotificationsConfig(): SystemNotificationsConfig {
  const raw = settingsStore.getState().extension?.notifications
  return { ...DEFAULT_NOTIFICATIONS_CONFIG, ...raw }
}

function readLastShownAt(): number | null {
  try {
    const raw = localStore()?.getItem(LAST_SHOWN_KEY)
    const value = raw ? Number(raw) : Number.NaN
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function writeLastShownAt(t: number) {
  try {
    localStore()?.setItem(LAST_SHOWN_KEY, String(t))
  } catch {
    // Storage blocked: the gap then holds per window only.
  }
}

export const notificationService = new NotificationService({
  getConfig: getNotificationsConfig,
  isAppActive: () => {
    wireFocusTracking()
    return activeWindow.isActive()
  },
  getPermission: () => platform.getSystemNotificationPermission(),
  requestPermission: () => platform.requestSystemNotificationPermission(),
  show: (payload) => platform.showSystemNotification(payload),
  now: () => Date.now(),
  setTimer: (fn, ms) => {
    const id = setTimeout(fn, ms)
    return () => clearTimeout(id)
  },
  getLastShownAt: readLastShownAt,
  setLastShownAt: writeLastShownAt,
  claimNeedsYou: (entryId) => seenEntries.claim(entryId),
})

/**
 * Starts this window's share of "is Dango active?" (focus flag + heartbeat). Every window calls it at startup so a
 * focused quick window also counts when the main window decides.
 */
export function trackAppActive(): void {
  wireFocusTracking()
}

/** Fire-and-forget notify with focus wiring + click routing initialized. */
export function notifySystemEvent(event: NotifyEvent): Promise<NotifyResult> {
  wireI18n()
  wireFocusTracking()
  wireClickNavigation()
  return notificationService.notify(event)
}

/** For tests: override this window's focus. */
export function __setAppActiveForTests(active: boolean) {
  activeWindow.setFocused(active)
}
