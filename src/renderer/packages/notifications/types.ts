import type { SystemNotificationsConfig } from '@shared/types'

export type SystemNotificationKind = 'needs_you' | 'long_run_done'

/** What callers report. Copy is built by the service; payloads never carry message content. */
export type NotifyEvent =
  | { kind: 'needs_you'; entryId: string; text: string }
  | { kind: 'long_run_done'; sessionId: string; sessionName?: string; startedAt: number }

export type NotifyResult = 'shown' | 'queued' | 'skipped'

export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported'

export type NotificationPayload = {
  title: string
  body: string
  data: { sessionId?: string; kind: SystemNotificationKind }
}

export type NotificationServiceDeps = {
  getConfig: () => SystemNotificationsConfig | undefined
  isAppActive: () => boolean
  getPermission: () => Promise<NotificationPermissionState>
  requestPermission: () => Promise<NotificationPermissionState>
  show: (payload: NotificationPayload) => Promise<void>
  t?: (key: string, options?: Record<string, unknown>) => string
  now: () => number
  /** Schedules `fn` after `ms`; returns a cancel function. */
  setTimer: (fn: () => void, ms: number) => () => void
  /** When any window last showed a notification (shared across windows). */
  getLastShownAt: () => number | null
  setLastShownAt: (t: number) => void
}

/** A run must last at least this long before its finish is worth a notification. */
export const LONG_RUN_MS = 60_000
/** At most one notification per this gap, across all windows; what arrives in between is grouped. */
export const NOTIFY_MIN_GAP_MS = 600_000

export const DEFAULT_NOTIFICATIONS_CONFIG: SystemNotificationsConfig = {
  enabled: false,
  notifyOnNeedsYou: true,
  notifyOnGenerationComplete: true,
  notifyOnRoomComplete: true,
  notifyOnUpdateAvailable: true,
}
