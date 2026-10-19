import {
  DEFAULT_NOTIFICATIONS_CONFIG,
  LONG_RUN_MS,
  NOTIFY_MIN_GAP_MS,
  type NotificationPayload,
  type NotificationServiceDeps,
  type NotifyEvent,
  type NotifyResult,
  type SystemNotificationKind,
} from './types'

const DEDUPE_TTL_MS = 30_000
const MAX_ENTRY_TEXT = 100

type Translate = (key: string, options?: Record<string, unknown>) => string

const ENGLISH_PLURALS: Record<string, [one: string, other: string]> = {
  '{{count}} things need you': ['{{count}} thing needs you', '{{count}} things need you'],
  '{{count}} runs finished': ['{{count}} run finished', '{{count}} runs finished'],
}

/** English fallback when i18n is not wired (tests, early boot): fills {{slots}} and picks the _one form for 1. */
const englishTranslate: Translate = (key, options = {}) => {
  const plural = ENGLISH_PLURALS[key]
  const template = plural ? plural[options.count === 1 ? 0 : 1] : key
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name] ?? ''))
}

/** First `max` code points, so a cut never splits a surrogate pair. */
function cutText(text: string, max: number): string {
  return Array.from(text.trim()).slice(0, max).join('')
}

function kindEnabled(kind: SystemNotificationKind, config: typeof DEFAULT_NOTIFICATIONS_CONFIG): boolean {
  switch (kind) {
    case 'needs_you':
      return config.notifyOnNeedsYou !== false
    case 'long_run_done':
      return config.notifyOnGenerationComplete !== false
    default:
      return false
  }
}

function dedupeKey(event: NotifyEvent): string {
  return event.kind === 'needs_you'
    ? `needs_you:${event.entryId}`
    : `long_run_done:${event.sessionId}:${event.startedAt}`
}

function singlePayload(event: NotifyEvent, t: Translate): NotificationPayload {
  if (event.kind === 'needs_you') {
    return { title: t('Needs you'), body: cutText(event.text, MAX_ENTRY_TEXT), data: { kind: 'needs_you' } }
  }
  const name = event.sessionName?.trim()
  return {
    title: t('Finished in the background'),
    // The chat name is plain interpolation into OS notification text, never rendered as markup.
    body: name ? t('{{name}} is ready.', { name: cutText(name, MAX_ENTRY_TEXT) }) : t('Your chat is ready.'),
    data: { sessionId: event.sessionId, kind: 'long_run_done' },
  }
}

function groupedPayload(events: NotifyEvent[], t: Translate): NotificationPayload {
  const needs = events.filter((e) => e.kind === 'needs_you').length
  const runs = events.length - needs
  const needsText = needs > 0 ? t('{{count}} things need you', { count: needs }) : ''
  const runsText = runs > 0 ? t('{{count}} runs finished', { count: runs }) : ''
  const body =
    needsText && runsText ? t('{{needs}} · {{runs}}', { needs: needsText, runs: runsText }) : needsText || runsText
  return { title: t('Dango'), body, data: { kind: needs > 0 ? 'needs_you' : 'long_run_done' } }
}

/**
 * Policy layer for local OS notifications: only Needs you entries and long runs, only while Dango is in the
 * background, at most one per NOTIFY_MIN_GAP_MS across windows (the shared last-shown time), the rest grouped.
 */
export class NotificationService {
  private readonly recent = new Map<string, number>()
  private queue: NotifyEvent[] = []
  private cancelTimer: (() => void) | null = null
  private flushing = false
  private deps: NotificationServiceDeps

  constructor(deps: NotificationServiceDeps) {
    this.deps = deps
  }

  /** Replace deps (e.g. after i18n init or platform swap in tests). */
  setDeps(deps: Partial<NotificationServiceDeps>) {
    this.deps = { ...this.deps, ...deps }
  }

  private config() {
    return { ...DEFAULT_NOTIFICATIONS_CONFIG, ...this.deps.getConfig() }
  }

  private isDuplicate(key: string, now: number): boolean {
    for (const [k, ts] of this.recent) {
      if (now - ts >= DEDUPE_TTL_MS) this.recent.delete(k)
    }
    if (this.recent.has(key)) return true
    this.recent.set(key, now)
    return false
  }

  /** Remaining wait before another notification may show, from the shared last-shown time. */
  private gapRemaining(now: number): number {
    const last = this.deps.getLastShownAt()
    if (last === null || !Number.isFinite(last)) return 0
    if (last > now) {
      // A time in the future (clock change, bad write) counts as now and is stored as now, so it blocks one gap at most.
      this.deps.setLastShownAt(now)
      return NOTIFY_MIN_GAP_MS
    }
    return Math.max(0, last + NOTIFY_MIN_GAP_MS - now)
  }

  private schedule(ms: number) {
    if (this.cancelTimer) return
    this.cancelTimer = this.deps.setTimer(() => {
      this.cancelTimer = null
      void this.flush()
    }, ms)
  }

  async notify(event: NotifyEvent): Promise<NotifyResult> {
    const config = this.config()
    if (!config.enabled || !kindEnabled(event.kind, config)) return 'skipped'
    if (this.deps.isAppActive()) return 'skipped'
    const now = this.deps.now()
    if (event.kind === 'long_run_done' && now - event.startedAt < LONG_RUN_MS) return 'skipped'
    const key = dedupeKey(event)
    if (this.isDuplicate(key, now)) return 'skipped'
    if (event.kind === 'needs_you' && this.deps.claimNeedsYou && !this.deps.claimNeedsYou(event.entryId)) {
      return 'skipped'
    }
    if (!this.queue.some((e) => dedupeKey(e) === key)) this.queue.push(event)

    if (this.flushing) return 'queued'
    const wait = this.gapRemaining(now)
    if (wait > 0) {
      this.schedule(wait)
      return 'queued'
    }
    const shown = await this.flush()
    if (shown) return 'shown'
    return this.queue.includes(event) ? 'queued' : 'skipped'
  }

  /** Shows whatever is queued as one notification. Re-checks focus and the shared gap (another window may have shown). */
  private async flush(): Promise<boolean> {
    if (this.flushing) return false
    this.cancelTimer?.()
    this.cancelTimer = null
    if (this.queue.length === 0) return false
    this.flushing = true
    try {
      if (this.deps.isAppActive()) {
        this.queue = []
        return false
      }
      const wait = this.gapRemaining(this.deps.now())
      if (wait > 0) {
        this.schedule(wait)
        return false
      }
      let permission: Awaited<ReturnType<NotificationServiceDeps['getPermission']>>
      try {
        permission = await this.deps.getPermission()
      } catch {
        permission = 'unsupported'
      }
      if (permission !== 'granted') {
        this.queue = []
        return false
      }
      // The permission check was async: another window may have shown in the meantime.
      const now = this.deps.now()
      const waitAgain = this.gapRemaining(now)
      if (waitAgain > 0) {
        this.schedule(waitAgain)
        return false
      }
      const events = this.queue
      this.queue = []
      const t = this.deps.t ?? englishTranslate
      const payload = events.length === 1 ? singlePayload(events[0], t) : groupedPayload(events, t)
      this.deps.setLastShownAt(now)
      try {
        await this.deps.show(payload)
      } catch (err) {
        console.warn('[notifications] show failed', err)
      }
      return true
    } finally {
      this.flushing = false
      // Events that arrived while this flush awaited wait for the next gap.
      if (this.queue.length > 0) this.schedule(Math.max(1, this.gapRemaining(this.deps.now())))
    }
  }

  requestPermission() {
    return this.deps.requestPermission()
  }

  getPermission() {
    return this.deps.getPermission()
  }
}

export type NotificationClickDeps = {
  showMainWindow?: () => Promise<void>
  navigate: (to: string) => void
  /** Set in the quick window: hides it and routes the main window instead of navigating the quick window. */
  openInMain?: (to: string) => Promise<void>
}

/** A long run opens its chat; Needs you and grouped notifications (kind only) open Review at `/`. */
export async function routeNotificationClick(
  payload: { sessionId?: string; kind?: string },
  deps: NotificationClickDeps
): Promise<void> {
  const to = payload.sessionId ? `/session/${payload.sessionId}` : payload.kind ? '/' : null
  if (!to) return
  if (deps.openInMain) {
    try {
      await deps.openInMain(to)
      return
    } catch {
      // Fall back to showing main and navigating this window.
    }
  }
  try {
    await deps.showMainWindow?.()
  } catch {
    // Still navigate this window.
  }
  deps.navigate(to)
}
