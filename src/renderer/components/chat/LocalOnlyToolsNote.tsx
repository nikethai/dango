import type { Message } from '@shared/types'
import { useTranslation } from 'react-i18next'

/**
 * ADR 0016: one quiet line under an answer whose turn held device-only text, so web search and outside tools were off.
 * Muted and not announced: it explains, it doesn't alert.
 */
export function LocalOnlyToolsNote({ msg }: { msg: Message }) {
  const { t } = useTranslation()
  if (msg.role !== 'assistant' || !msg.localOnlyToolsOff || msg.generating) return null
  return (
    <p className="dg-type-caption dg-msg-note">
      {t('Web and outside tools are off because this chat holds device-only mail.')}
    </p>
  )
}
