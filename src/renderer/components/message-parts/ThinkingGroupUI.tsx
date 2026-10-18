import type { Message, MessageContentParts, MessageReasoningPart, MessageToolCallPart } from '@shared/types'
import { type FC, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ThinkingLine } from '@/components/chat/ThinkingLine'
import { liveToolHint } from '@/packages/thinking/tool-summary'
import { getLiveGenerationStartedAt } from '@/stores/session/session-live-generation'
import { ToolBlock } from './ToolBlock'

/** While generating, the line stays live until work has been inactive this long (narration between tool calls). */
export const LEAVE_LIVE_MS = 1_500

interface ThinkingGroupUIProps {
  message: Message
  sessionId?: string
  parts: MessageContentParts
  /** Mid-turn assistant prose absorbed from between tools; part of the thinking text. */
  monologueTexts?: string[]
  /** True while the model is still working (reasoning or tools) and no answer has started: `group.workActive`. */
  isLastGroup: boolean
  /** Whether the thinking text starts open (setting and scope kind). */
  defaultOpen: boolean
  /** False while a running plan card in the same message shows the mascot. */
  showMascot: boolean
  onStop: () => void
}

/**
 * An assistant turn's work. While work is active: one live ThinkingLine (tools summarised in its hint).
 * Once the answer starts: a "Thought for" line (only when reasoning text exists) and the collapsed ToolBlock.
 */
export const ThinkingGroupUI: FC<ThinkingGroupUIProps> = ({
  message,
  parts,
  monologueTexts = [],
  isLastGroup,
  defaultOpen,
  showMascot,
  onStop,
}) => {
  const { t } = useTranslation()

  // Entering live is immediate; leaving it while generating waits LEAVE_LIVE_MS, so a short narration between two
  // tool calls never flashes the finished line and tool block. Once generation ends, settle at once.
  const [holdLive, setHoldLive] = useState(isLastGroup)
  const generating = Boolean(message.generating)
  useEffect(() => {
    if (isLastGroup) {
      setHoldLive(true)
      return
    }
    if (!generating) {
      setHoldLive(false)
      return
    }
    const timer = setTimeout(() => setHoldLive(false), LEAVE_LIVE_MS)
    return () => clearTimeout(timer)
  }, [isLastGroup, generating])
  const live = isLastGroup || (generating && holdLive)

  const reasoningParts = useMemo(() => parts.filter((p) => p.type === 'reasoning') as MessageReasoningPart[], [parts])
  const toolParts = useMemo(() => parts.filter((p) => p.type === 'tool-call') as MessageToolCallPart[], [parts])
  const text = useMemo(
    () => [...reasoningParts.map((p) => p.text), ...monologueTexts].filter((s) => s?.trim()).join('\n\n'),
    [reasoningParts, monologueTexts]
  )

  const reasoningMs = reasoningParts.reduce((sum, p) => sum + (p.duration || 0), 0)
  const workStart = reasoningParts[reasoningParts.length - 1]?.startTime || message.timestamp
  // The turn's start, stable across remounts and persisted writes; another window (no live mark) falls back.
  const liveOrigin = (generating ? getLiveGenerationStartedAt(message.id) : undefined) ?? message.timestamp ?? workStart

  // Fallback duration when reasoning parts carry none: the work time measured when this mount saw it go live → done.
  // A turn loaded from history never saw that transition, so it gets no number rather than "now - timestamp".
  const sawLiveRef = useRef(live)
  const originRef = useRef<number | undefined>(undefined)
  if (live) {
    sawLiveRef.current = true
    originRef.current ??= liveOrigin
  }
  const [settledMs, setSettledMs] = useState<number | undefined>(undefined)
  // Layout effect: the measured duration lands before paint, so the line never flashes a bare "Thought".
  useLayoutEffect(() => {
    if (live) {
      setSettledMs(undefined)
      return
    }
    const origin = originRef.current ?? workStart
    if (sawLiveRef.current && origin) setSettledMs(Date.now() - origin)
  }, [live, workStart])

  // One slot for the line in both states, so its open/closed choice carries from live to finished.
  return (
    <>
      {live || text ? (
        <ThinkingLine
          live={live}
          startedAt={liveOrigin}
          durationMs={reasoningMs > 0 ? reasoningMs : settledMs}
          text={text}
          toolHint={live ? liveToolHint(toolParts, t) : undefined}
          defaultOpen={defaultOpen}
          showMascot={showMascot}
          onStop={onStop}
        />
      ) : null}
      {live ? null : <ToolBlock parts={toolParts} />}
    </>
  )
}
