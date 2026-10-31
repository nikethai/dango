import type { Message } from '@shared/types'
import { hasToolCallMarkup } from '@shared/utils/tool-call-markup'
import { useTranslation } from 'react-i18next'

/**
 * One quiet line under an answer whose model wrote a tool call as text: the markup is hidden from the answer and
 * nothing ran. Muted and not announced: it explains, it doesn't alert.
 */
export function ToolCallMarkupNote({ msg }: { msg: Message }) {
  const { t } = useTranslation()
  if (msg.role !== 'assistant' || msg.generating) return null
  const hidden = msg.contentParts?.some((part) => part.type === 'text' && hasToolCallMarkup(part.text || ''))
  if (!hidden) return null
  return (
    <p className="dg-type-caption dg-msg-note">
      {t('The model wrote a tool request as text. Dango hid it and ran nothing.')}
    </p>
  )
}
