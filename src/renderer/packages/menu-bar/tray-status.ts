export type TrayMood = 'idle' | 'needs-you' | 'paused'

export type TrayMenuLabels = { openReview: string; quickChat: string; openDango: string; quit: string }

export type TrayStatus = {
  mood: TrayMood
  statusLine: string
  pauseLabel: string
  tooltip: string
  menu: TrayMenuLabels
}

export type TrayTranslate = (key: string, opts?: Record<string, unknown>) => string

export const REVIEW_PATH = '/'

const ENGLISH_PLURALS: Record<string, [one: string, other: string]> = {
  '{{count}} things need you': ['{{count}} thing needs you', '{{count}} things need you'],
}

/** English fallback when no translator is given: fills {{name}} slots and picks the _one form for count 1. */
const englishTranslate: TrayTranslate = (key, opts = {}) => {
  const plural = ENGLISH_PLURALS[key]
  const template = plural ? plural[opts.count === 1 ? 0 : 1] : key
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(opts[name] ?? ''))
}

/** Minutes since the last check, floored; below one minute reads "checked just now". */
function minutesSince(ms: number): number {
  return Math.floor(Math.max(0, ms) / 60_000)
}

function agoText(minutes: number, t: TrayTranslate): string {
  return minutes < 60
    ? t('{{count}} min ago', { count: minutes })
    : t('{{count}} h ago', { count: Math.floor(minutes / 60) })
}

export function computeTrayStatus(
  input: { waiting: number; paused: boolean; lastCheckedAt?: number; now: number },
  t: TrayTranslate = englishTranslate
): TrayStatus {
  const { waiting, paused, lastCheckedAt, now } = input
  const base = waiting > 0 ? t('{{count}} things need you', { count: waiting }) : t('Nothing needs you')
  let statusLine = base
  if (typeof lastCheckedAt === 'number') {
    const minutes = minutesSince(now - lastCheckedAt)
    statusLine =
      minutes < 1
        ? t('{{status}} · {{checked}}', { status: base, checked: t('checked just now') })
        : t('{{status}} · checked {{ago}}', { status: base, ago: agoText(minutes, t) })
  }
  if (paused) statusLine = t('Paused · {{status}}', { status: statusLine })
  return {
    mood: paused ? 'paused' : waiting > 0 ? 'needs-you' : 'idle',
    statusLine,
    pauseLabel: paused ? t('Resume background work') : t('Pause background work'),
    tooltip: t('Dango · {{status}}', { status: statusLine }),
    menu: {
      openReview: t('Open Review'),
      quickChat: t('Quick chat'),
      openDango: t('Open Dango'),
      quit: t('Quit Dango'),
    },
  }
}
