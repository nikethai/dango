import { ChevronRight } from 'lucide-react'
import { type JSX, type MouseEvent, type SyntheticEvent, useEffect, useMemo, useRef, useState } from 'react'
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

/** Delay before the status region gets its first words: a region that exists empty first is announced reliably. */
export const THINKING_STATUS_FILL_MS = 150

const withEllipsis = (summary: string) => (summary.endsWith('…') ? summary : `${summary}…`)

/** Renders text from a prop so Trans cannot replace or parse it. */
function LiteralText({ text }: { text: string }) {
  return <>{text}</>
}

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

  // The live origin is captured once per live phase (a persisted write can bump a fallback timestamp mid-wait) and
  // dropped when the line leaves live, so a later live phase takes its own origin.
  const originRef = useRef<number | undefined>(undefined)
  if (!live) originRef.current = undefined
  else if (originRef.current === undefined && startedAt) originRef.current = startedAt
  const elapsed = useThinkingTimer(originRef.current ?? startedAt, live)
  // Memoised: the timer re-renders the line about four times a second, and the scan walks the whole reasoning.
  const thoughtSummary = useMemo(() => rollingSummary(text), [text])
  const summary = thoughtSummary || (live ? (toolHint?.trim() ?? '') : '')
  const stage = live ? thinkingStage(elapsed) : null
  const stageTitle = stage === null ? '' : stage === 'thinking' ? t('Thinking') : t('Still thinking')

  // Screen readers hear the summary (or the stage on a plain wait), at most every 5 s.
  const announced = useThrottledValue(live ? summary || stageTitle : '', THINKING_ANNOUNCE_MS)
  const [statusReady, setStatusReady] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setStatusReady(true), THINKING_STATUS_FILL_MS)
    return () => clearTimeout(timer)
  }, [])

  if (!live && !text.trim()) return null

  const onSummaryClick = (e: MouseEvent<HTMLElement>) => {
    e.preventDefault()
    userToggledRef.current = true
    setOpen((value) => !value)
  }

  // Native toggles (find-in-page auto-expand) change the element without a click; follow them.
  const onToggle = (e: SyntheticEvent<HTMLDetailsElement>) => {
    const nativeOpen = e.currentTarget.open
    if (nativeOpen !== open) setOpen(nativeOpen)
  }

  const details = (
    <details className="dg-think" open={open} onToggle={onToggle}>
      <summary onClick={onSummaryClick}>
        {live && showMascot ? <Mascot state="thinking" size={16} /> : null}
        {live ? (
          <>
            <span className="dg-think__title">
              {summary ? (
                // Model text never passes through i18next: Trans would parse "<0>" and "a < b" as markup and
                // re-interpolate "{{title}}". The <1> slot renders the summary from a prop, literally.
                <Trans
                  i18nKey="<0>{{title}}</0> · <1>{{summary}}</1>"
                  values={{ title: stageTitle, summary: '' }}
                  components={[<strong key="title" />, <LiteralText key="summary" text={withEllipsis(summary)} />]}
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
          <span className="dg-think__title">
            {durationMs && durationMs > 0
              ? t('Thought for {{duration}}', { duration: formatDangoDuration(durationMs) })
              : t('Thought')}
            <ChevronRight className="dg-think__chevron" size={15} strokeWidth={1.8} aria-hidden="true" />
          </span>
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
          {statusReady ? announced : ''}
        </div>
      ) : null}
    </div>
  )
}
