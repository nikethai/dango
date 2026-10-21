/**
 * Live generation hint — joins the composer dock surface (same DNA as task dock).
 * Quiet Grok/ChatGPT chrome: one line, no floating badge, no dual noise.
 */

import type { Message } from '@shared/types'
import { type FC, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatWorkedDuration } from '@/hooks/useThinkingTimer'
import { PendingDots } from './AssistantPending'

export type LiveGenerationDockHintProps = {
  generating: boolean
  liveMessage?: Message | null
  className?: string
}

function resolveLabels(
  message: Message | null | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string
): { title: string; detail: string } {
  const parts = message?.contentParts || []
  const runningTool = parts.find((p) => p.type === 'tool-call' && p.state === 'call' && p.toolName !== 'memory_lookup')
  if (runningTool && runningTool.type === 'tool-call') {
    const tool = runningTool.toolName
    if (tool === 'web_search') return { title: t('Using tools…'), detail: t('Web search') }
    if (tool === 'parse_link') return { title: t('Using tools…'), detail: t('Reading link') }
    if (tool === 'query_knowledge_base') return { title: t('Using tools…'), detail: t('Knowledge base') }
    return {
      title: t('Using tools…'),
      detail: tool.replace(/_/g, ' '),
    }
  }

  const hasTool = parts.some(
    (p) => p.type === 'tool-call' && p.toolName !== 'memory_lookup' && !String(p.toolName).includes('task')
  )
  if (hasTool) return { title: t('Thinking…'), detail: t('Preparing answer') }
  return { title: t('Thinking…'), detail: t('Model is working') }
}

function elapsedFromMessage(message: Message | null | undefined): string {
  if (!message?.timestamp) return '0s'
  const reasoningPart = message.contentParts?.find((p) => p.type === 'reasoning')
  const reasoningStart = reasoningPart && reasoningPart.type === 'reasoning' ? reasoningPart.startTime : undefined
  const start = reasoningStart || message.timestamp
  const ms = Math.max(0, Date.now() - start)
  if (ms < 1000) return '0s'
  return formatWorkedDuration(ms)
}

export const LiveGenerationDockHint: FC<LiveGenerationDockHintProps> = ({ generating, liveMessage, className }) => {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(generating)
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    if (generating) {
      setVisible(true)
      setExiting(false)
      return
    }
    if (!visible) return
    setExiting(true)
    const id = window.setTimeout(() => {
      setVisible(false)
      setExiting(false)
    }, 140)
    return () => window.clearTimeout(id)
  }, [generating, visible])

  const { title, detail } = useMemo(
    () => resolveLabels(liveMessage, t),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      t,
      liveMessage?.id,
      liveMessage?.contentParts?.length,
      liveMessage?.contentParts?.map((p) => (p.type === 'tool-call' ? `${p.toolName}:${p.state}` : p.type)).join('|'),
    ]
  )

  const elapsed = visible ? elapsedFromMessage(liveMessage) : '0s'

  if (!visible) return null

  return (
    <div className={['live-gen-dock', exiting && 'is-exiting', className].filter(Boolean).join(' ')}>
      <div className="live-gen-dock-inner">
        <PendingDots className="assistant-pending-dots--sm live-gen-dock-dots" />
        <span className="live-gen-dock-title">{title}</span>
        <span className="live-gen-dock-sep" aria-hidden>
          ·
        </span>
        <span className="live-gen-dock-detail">{detail}</span>
        <span className="live-gen-dock-time tabular-nums">{elapsed}</span>
      </div>
    </div>
  )
}

export default LiveGenerationDockHint
