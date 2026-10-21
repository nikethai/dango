import type { SourceKind } from '@shared/types/sources'
import { useId } from 'react'
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
        <button type="button" className="dg-btn dg-btn--ghost" onClick={() => void stopJob(job.id)}>
          {t('Stop')}
        </button>
      </section>
      <p className="dg-type-caption dg-first-read__meanwhile">
        <Mascot state="working" size={20} />
        {hotkey ? <span>{t('Ask anything meanwhile: {{hotkey}}.', { hotkey })}</span> : null}
      </p>
    </div>
  )
}
