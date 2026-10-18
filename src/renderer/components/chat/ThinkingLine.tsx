import { ChevronRight } from 'lucide-react'
import { type JSX, type MouseEvent, useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Mascot } from '@/components/brand/Mascot'
import Markdown from '@/components/Markdown'
import { formatDangoDuration, useThinkingTimer } from '@/hooks/useThinkingTimer'
import { useThrottledValue } from '@/hooks/useThrottledValue'
import { rollingSummary, THINKING_ANNOUNCE_MS, thinkingStage } from '@/packages/thinking/thinking'

export type ThinkingLineProps = {
  live: boolean
  /** Live timer origin. */
  startedAt?: number
  /** Finished: total thought time. */
  durationMs?: number
  /** Full thinking text (reasoning + mid-turn monologue). */
  text: string
  /** Live summary when there is no thought yet, e.g. "searched the web". */
  toolHint?: string
  defaultOpen: boolean
  /** Default true. */
  showMascot?: boolean
  onStop?: () => void
}

const withEllipsis = (summary: string) => (summary.endsWith('…') ? summary : `${summary}…`)

/**
 * The thinking line: live ("Thinking · {summary}…", timer, Stop) while the model works, then a quiet
 * "Thought for {{duration}}" disclosure. Stop sits beside the <details>, never inside <summary>.
 */
export function ThinkingLine({
  live,
  startedAt,
  durationMs,
  text,
  toolHint,
  defaultOpen,
  showMascot = true,
  onStop,
}: ThinkingLineProps): JSX.Element | null {
  const { t } = useTranslation()
  const [open, setOpen] = useState(defaultOpen)
  const userToggledRef = useRef(false)

  useEffect(() => {
    if (!userToggledRef.current) setOpen(defaultOpen)
  }, [defaultOpen])

  const elapsed = useThinkingTimer(startedAt, live)
  const summary = rollingSummary(text) || (live ? (toolHint?.trim() ?? '') : '')
  const announced = useThrottledValue(live ? summary : '', THINKING_ANNOUNCE_MS)

  if (!live && !text.trim()) return null

  const onSummaryClick = (e: MouseEvent<HTMLElement>) => {
    e.preventDefault()
    userToggledRef.current = true
    setOpen((value) => !value)
  }

  const stage = live ? thinkingStage(elapsed) : null
  const stageTitle = stage === 'thinking' ? t('Thinking') : t('Still thinking')

  const details = (
    <details className="dg-think" open={open}>
      <summary onClick={onSummaryClick}>
        {live && showMascot ? <Mascot state="thinking" size={16} /> : null}
        {live ? (
          <>
            <span className="dg-think__title">
              {summary ? (
                <Trans
                  i18nKey="<0>{{title}}</0> · {{summary}}"
                  values={{ title: stageTitle, summary: withEllipsis(summary) }}
                  components={[<strong key="title" />]}
                />
              ) : (
                <strong>{stageTitle}</strong>
              )}
            </span>
            <span className="dg-think__time">{formatDangoDuration(elapsed)}</span>
            {stage === 'reassure' ? (
              <span className="dg-think__note">
                {t('Still working. Nothing is stuck; this model thinks before it writes.')}
              </span>
            ) : null}
          </>
        ) : (
          <>
            <span className="dg-think__title">
              {durationMs && durationMs > 0
                ? t('Thought for {{duration}}', { duration: formatDangoDuration(durationMs) })
                : t('Thought')}
            </span>
            <ChevronRight size={15} strokeWidth={1.8} aria-hidden="true" />
          </>
        )}
      </summary>
      {open && text.trim() ? (
        <div className="dg-think__body">
          <Markdown enableLaTeXRendering={false} enableMermaidRendering={false} generating={live}>
            {text}
          </Markdown>
        </div>
      ) : null}
    </details>
  )

  return (
    <div className="dg-think-line">
      {details}
      {live && onStop ? (
        <button type="button" className="dg-btn dg-btn--ghost dg-think-line__stop" onClick={onStop}>
          {t('Stop')}
        </button>
      ) : null}
      {live ? (
        <div role="status" className="sr-only">
          {announced}
        </div>
      ) : null}
    </div>
  )
}
