/**
 * Browser Notification API + Capacitor LocalNotifications delivery.
 * Keeps WebPlatform thinner; never puts message content in payloads.
 */

import type {
  SystemNotificationClickPayload,
  SystemNotificationPayload,
  SystemNotificationPermission,
} from './interfaces'

type ClickHandler = (payload: SystemNotificationClickPayload) => void

let capacitorClickWired = false
const clickHandlers = new Set<ClickHandler>()
let channelReady = false
let nextLocalId = Math.floor(Date.now() % 100_000) + 1

function mapBrowserPermission(p: NotificationPermission): SystemNotificationPermission {
  if (p === 'granted') return 'granted'
  if (p === 'denied') return 'denied'
  return 'default'
}

export function isCapacitorNativeRuntime(): boolean {
  if (typeof window === 'undefined') return false
  try {
    // Avoid hard dependency on @capacitor/core at module load for web-only tests
    const Cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    return Cap?.isNativePlatform?.() === true
  } catch {
    return false
  }
}

export async function getWebOrCapacitorNotificationPermission(
  preferCapacitor: boolean
): Promise<SystemNotificationPermission> {
  if (preferCapacitor || isCapacitorNativeRuntime()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      const status = await LocalNotifications.checkPermissions()
      if (status.display === 'granted') return 'granted'
      if (status.display === 'denied') return 'denied'
      if (status.display === 'prompt' || status.display === 'prompt-with-rationale') return 'default'
      return 'default'
    } catch {
      // fall through to browser API
    }
  }

  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported'
  }
  if (typeof window.isSecureContext === 'boolean' && !window.isSecureContext) {
    return 'unsupported'
  }
  return mapBrowserPermission(Notification.permission)
}

export async function requestWebOrCapacitorNotificationPermission(
  preferCapacitor: boolean
): Promise<SystemNotificationPermission> {
  if (preferCapacitor || isCapacitorNativeRuntime()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      const status = await LocalNotifications.requestPermissions()
      if (status.display === 'granted') {
        await ensureAndroidChannel()
        return 'granted'
      }
      if (status.display === 'denied') return 'denied'
      return 'default'
    } catch {
      // fall through
    }
  }

  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported'
  }
  if (typeof window.isSecureContext === 'boolean' && !window.isSecureContext) {
    return 'unsupported'
  }
  return mapBrowserPermission(await Notification.requestPermission())
}

async function ensureAndroidChannel() {
  if (channelReady) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.createChannel({
      id: 'dango-chat',
      name: 'Chat',
      description: 'Generation and team-room alerts',
      importance: 4,
      visibility: 1,
      sound: undefined,
    })
    channelReady = true
  } catch {
    // iOS or channel already exists
    channelReady = true
  }
}

export async function showWebOrCapacitorNotification(
  payload: SystemNotificationPayload,
  preferCapacitor: boolean
): Promise<void> {
  if (preferCapacitor || isCapacitorNativeRuntime()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      await ensureAndroidChannel()
      const id = nextLocalId++
      if (nextLocalId > 2_000_000_000) nextLocalId = 1
      await LocalNotifications.schedule({
        notifications: [
          {
            id,
            title: payload.title,
            body: payload.body ?? '',
            channelId: 'dango-chat',
            extra: {
              sessionId: payload.data?.sessionId,
              kind: payload.data?.kind,
            },
            schedule: { at: new Date(Date.now() + 250) },
          },
        ],
      })
      return
    } catch (err) {
      console.warn('[notifications] Capacitor local notification failed, trying browser API', err)
    }
  }

  if (typeof window === 'undefined' || !('Notification' in window)) {
    return
  }
  if (Notification.permission !== 'granted') {
    return
  }
  const n = new Notification(payload.title, {
    body: payload.body,
    data: payload.data,
    // One tag: a new notification replaces the previous one instead of stacking.
    tag: 'dango',
  })
  n.onclick = () => {
    window.focus()
    const data = (n.data ?? payload.data) as SystemNotificationClickPayload | undefined
    dispatchClick({
      sessionId: data?.sessionId,
      kind: data?.kind,
    })
    n.close()
  }
}

function dispatchClick(payload: SystemNotificationClickPayload) {
  for (const handler of clickHandlers) {
    try {
      handler(payload)
    } catch (err) {
      console.warn('[notifications] click handler failed', err)
    }
  }
}

/** Register click/action listener; returns unsubscribe. */
export function onWebOrCapacitorNotificationClick(callback: ClickHandler, preferCapacitor: boolean): () => void {
  clickHandlers.add(callback)

  if ((preferCapacitor || isCapacitorNativeRuntime()) && !capacitorClickWired) {
    capacitorClickWired = true
    void import('@capacitor/local-notifications')
      .then(({ LocalNotifications }) =>
        LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
          const extra = (event.notification.extra ?? {}) as Record<string, unknown>
          dispatchClick({
            sessionId: typeof extra.sessionId === 'string' ? extra.sessionId : undefined,
            kind: typeof extra.kind === 'string' ? extra.kind : undefined,
          })
        })
      )
      .catch((err) => {
        console.warn('[notifications] Capacitor action listener failed', err)
        capacitorClickWired = false
      })
  }

  return () => {
    clickHandlers.delete(callback)
  }
}
