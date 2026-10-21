import type { SourceKind } from '@shared/types/sources'
import { useId, useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Mascot } from '@/components/brand/Mascot'
import { formatShortcutLabel } from '@/components/Shortcut'
import { stopJob, useBackgroundJobs } from '@/packages/background'
import { firstReadJob } from '@/packages/first-run/firstRead'
import { getOS } from '@/packages/navigator'
import { useSources } from '@/packages/sources'
import platform from '@/platform'
import { useSettingsStore } from '@/stores/settingsStore'

// English keys (FR5 copy).
const READING_TITLE: Record<SourceKind, string> = {
  folder: 'Reading your folder…',
  gmail: 'Reading your Gmail…',
  asana: 'Reading your Asana tasks…',
  'codex-threads': 'Reading your Codex threads…',
  documents: 'Reading your documents…',
}

/** The Quick Chat hotkey as Settings › Keyboard shortcuts writes it (⌘⇧Space on the Mac, Ctrl+Shift+Space elsewhere). */
function quickChatHotkey(shortcut: string | undefined): string | undefined {
  if (platform.type !== 'desktop' || !shortcut) return undefined
  const parts = shortcut.split('+').map((key) => formatShortcutLabel(key))
  return getOS() === 'Mac' ? parts.join('') : parts.join('+')
}

// Between the sync ending and its first review starting the card renders nothing for a moment, so a focused Stop is
// removed and focus falls to the body (T4 M1). Remember that for a short while: the card's next Stop takes focus back;
// if no card comes back, focus goes to the page's main region instead of staying on the body.
const HANDOVER_MS = 1000
let focusLost: ReturnType<typeof setTimeout> | null = null

const focusOnBody = () => !document.activeElement || document.activeElement === document.body

function StopButton({ onStop }: { onStop(): void }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    const button = ref.current
    if (focusLost) {
      clearTimeout(focusLost)
      focusLost = null
      if (focusOnBody()) button?.focus()
    }
    // Layout cleanups run before React removes the DOM, so a focused Stop is still the active element here.
    return () => {
      if (!button || document.activeElement !== button) return
      focusLost = setTimeout(() => {
        focusLost = null
        if (focusOnBody()) document.getElementById('main')?.focus()
      }, HANDOVER_MS)
    }
  }, [])
  return (
    <button ref={ref} type="button" className="dg-btn dg-btn--ghost" onClick={onStop}>
      {t('Stop')}
    </button>
  )
}

/**
 * FR5, above Review: while the source connected in first run is read (its first sync, then its first background
 * review; R9), a card says what is being read, with Stop, and under it the working mascot and "Ask anything
 * meanwhile". Renders nothing otherwise. Not a live region: its line changes as files are counted.
 */
export function FirstReadCard() {
  const { t } = useTranslation()
  const titleId = useId()
  const record = useSettingsStore((s) => s.firstRun)
  const quickToggle = useSettingsStore((s) => s.shortcuts?.quickToggle)
  const jobs = useBackgroundJobs()
  const sources = useSources()
  const job = firstReadJob(record, sources, jobs)
  const source = job ? sources.find((s) => s.id === job.sourceId) : undefined
  if (!job || !source) return null
  const hotkey = quickChatHotkey(quickToggle)
  const sub = job.progress
    ? t('{{progress}}. Items appear here as they are found.', { progress: job.progress })
    : t('Items appear here as they are found.')

  return (
    <div className="dg dg-first-read">
      <section className="dg-first-read__card" aria-labelledby={titleId}>
        <div className="dg-first-read__text">
          <h2 id={titleId} className="dg-type-headline dg-first-read__title">
            {t(READING_TITLE[source.kind])}
          </h2>
          <p className="dg-type-caption dg-first-read__sub">{sub}</p>
        </div>
        <StopButton onStop={() => void stopJob(job.id)} />
      </section>
      <p className="dg-type-caption dg-first-read__meanwhile">
        <Mascot state="working" size={20} />
        {hotkey ? <span>{t('Ask anything meanwhile: {{hotkey}}.', { hotkey })}</span> : null}
      </p>
    </div>
  )
}
