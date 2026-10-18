import type { MessageToolCallPart } from '@shared/types'
import { ChevronRight } from 'lucide-react'
import { type JSX, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { summarizeToolCalls, toolRow, visibleToolCalls } from '@/packages/thinking/tool-summary'
import { ToolCallPartUI } from './ToolCallPartUI'

/**
 * A turn's tool calls as one quiet line ("Read 2 files · searched the web"). Opening it lists one mono row per
 * call; a row opens that call's detail. Row targets are tool args (external text) and render as plain children,
 * never through i18next.
 */
export function ToolBlock({ parts }: { parts: MessageToolCallPart[] }): JSX.Element | null {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const baseId = useId()

  const summary = summarizeToolCalls(parts, t)
  if (!summary) return null
  const calls = visibleToolCalls(parts)

  return (
    <details className="dg-think dg-tool-block" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary
        onClick={(e) => {
          e.preventDefault()
          setOpen((value) => !value)
        }}
      >
        <span className="dg-think__title">
          {summary}
          <ChevronRight className="dg-think__chevron" size={15} strokeWidth={1.8} aria-hidden="true" />
        </span>
      </summary>
      {open ? (
        <div className="dg-think__body">
          {calls.map((part, index) => {
            const row = toolRow(part, t)
            const expanded = expandedId === part.toolCallId
            const detailId = `${baseId}-detail-${index}`
            return (
              <div key={part.toolCallId} className="dg-tool-block__item">
                <button
                  type="button"
                  className="dg-tool"
                  aria-expanded={expanded}
                  aria-controls={detailId}
                  title={row.target}
                  onClick={() => setExpandedId(expanded ? null : part.toolCallId)}
                >
                  <span className="dg-tool__verb">{row.verb}</span>
                  <span className="dg-tool__target">{row.target}</span>
                  {row.size ? <span className="dg-tool__size">{row.size}</span> : null}
                </button>
                <div id={detailId}>{expanded ? <ToolCallPartUI part={part} defaultExpanded /> : null}</div>
              </div>
            )
          })}
        </div>
      ) : null}
    </details>
  )
}
