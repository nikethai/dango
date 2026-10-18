import type { Message, MessageContentParts, MessageReasoningPart, MessageToolCallPart } from '@shared/types'
import { type FC, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ThinkingLine } from '@/components/chat/ThinkingLine'
import { liveToolHint } from '@/packages/thinking/tool-summary'
import { ToolBlock } from './ToolBlock'

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
  const live = isLastGroup

  const reasoningParts = useMemo(() => parts.filter((p) => p.type === 'reasoning') as MessageReasoningPart[], [parts])
  const toolParts = useMemo(() => parts.filter((p) => p.type === 'tool-call') as MessageToolCallPart[], [parts])
  const text = useMemo(
    () => [...reasoningParts.map((p) => p.text), ...monologueTexts].filter((s) => s?.trim()).join('\n\n'),
    [reasoningParts, monologueTexts]
  )

  const reasoningMs = reasoningParts.reduce((sum, p) => sum + (p.duration || 0), 0)
  const workStart = reasoningParts[reasoningParts.length - 1]?.startTime || message.timestamp

  // Fallback duration when reasoning parts carry none: the work time measured when this mount saw it go live → done.
  // A turn loaded from history never saw that transition, so it gets no number rather than "now - timestamp".
  const sawLiveRef = useRef(live)
  if (live) sawLiveRef.current = true
  const [settledMs, setSettledMs] = useState<number | undefined>(undefined)
  useEffect(() => {
    if (live) {
      setSettledMs(undefined)
      return
    }
    if (sawLiveRef.current && workStart) setSettledMs(Date.now() - workStart)
  }, [live, workStart])

  if (live) {
    return (
      <ThinkingLine
        live
        startedAt={message.timestamp ?? workStart}
        text={text}
        toolHint={liveToolHint(toolParts, t)}
        defaultOpen={defaultOpen}
        showMascot={showMascot}
        onStop={onStop}
      />
    )
  }

  return (
    <>
      {text ? (
        <ThinkingLine
          live={false}
          durationMs={reasoningMs > 0 ? reasoningMs : settledMs}
          text={text}
          defaultOpen={defaultOpen}
        />
      ) : null}
      <ToolBlock parts={toolParts} />
    </>
  )
}
