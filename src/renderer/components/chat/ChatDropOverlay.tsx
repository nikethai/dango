import { FileUp } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { formatBytesForDisplay, getVideoLimits } from '@/packages/video'
import platform from '@/platform'
import { useUIStore } from '@/stores/uiStore'

/**
 * CO3: "Drop to attach" over the whole chat column while a file is dragged over the window.
 * InputBox owns the window drag listeners and the drop itself; this only shows uiStore.fileDragActive.
 * The parent needs `dg-drop-host` (position: relative).
 */
export function ChatDropOverlay() {
  const { t } = useTranslation()
  const active = useUIStore((s) => s.fileDragActive)
  const limits = useMemo(() => {
    const video = getVideoLimits(platform.formFactor === 'desktop' ? 'desktop' : 'mobile')
    return { minutes: Math.floor(video.maxDurationSec / 60), size: formatBytesForDisplay(video.maxFileBytes) }
  }, [])

  return (
    <div className={active ? 'dg-drop-overlay is-active' : 'dg-drop-overlay'} aria-hidden={!active}>
      <div className="dg-drop-overlay__card" role={active ? 'status' : undefined}>
        <FileUp className="dg-drop-overlay__icon" size={16} strokeWidth={1.8} aria-hidden />
        <span className="dg-drop-overlay__title dg-type-headline">{t('Drop to attach')}</span>
        <span className="dg-type-caption">{t('Images · video · PDFs · text · code')}</span>
        <span className="dg-drop-overlay__limits dg-type-caption">
          {t('MP4 · WebM · max {{minutes}} min · {{size}}', limits)}
        </span>
      </div>
    </div>
  )
}
