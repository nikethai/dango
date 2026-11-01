import type { SystemNotificationPermission } from '@/platform/interfaces'

export type NotificationOs = 'Windows' | 'Mac' | 'Linux' | 'Android' | 'iOS' | 'Unknown'

/** Where the OS keeps this app's notification switch (opened with `platform.openLink`), if it has a link. */
export function notificationSettingsUrl(os: NotificationOs): string | undefined {
  if (os === 'Mac') return 'x-apple.systempreferences:com.apple.preference.notifications'
  if (os === 'Windows') return 'ms-settings:notifications'
  return undefined
}

export type NotificationPermissionView = {
  /** English i18n key for the Permission row's description. */
  label: string
  /** The OS settings link for "Open System Settings", when there is one. */
  settingsUrl?: string
  /** "Send a test notification": the only way to see whether the OS lets Dango's notifications through. */
  canTest: boolean
  /** "Request permission": only where the permission answer is real (web, mobile). */
  canRequest: boolean
}

/**
 * The Permission row. On desktop the notification plugin reports "granted" without asking the OS, so Dango cannot
 * know whether notifications show: the row says the OS decides, links to its settings and offers a test instead of
 * claiming "Permission granted" (finding 24).
 */
export function notificationPermissionView(i: {
  desktop: boolean
  os: NotificationOs
  permission: SystemNotificationPermission | string
}): NotificationPermissionView {
  if (i.permission === 'unsupported') {
    return { label: 'Not supported on this platform', canTest: false, canRequest: false }
  }
  if (i.desktop) {
    const label =
      i.os === 'Mac'
        ? 'macOS decides whether these show: System Settings › Notifications › Dango.'
        : i.os === 'Windows'
          ? 'Windows decides whether these show: Settings › System › Notifications.'
          : 'Your system decides whether these show.'
    return { label, settingsUrl: notificationSettingsUrl(i.os), canTest: true, canRequest: false }
  }
  const label =
    i.permission === 'granted'
      ? 'Permission granted'
      : i.permission === 'denied'
        ? 'Permission denied'
        : 'Permission not requested'
  return { label, canTest: i.permission === 'granted', canRequest: i.permission !== 'granted' }
}
