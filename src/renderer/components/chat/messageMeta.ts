import type { Message } from '@shared/types'
import type { TFunction } from 'i18next'
import { formatDangoDuration } from '@/hooks/useThinkingTimer'

/** "1.2k", "2k", "840": one decimal above a thousand, trailing ".0" dropped. */
function shortAmount(n: number): string {
  if (n < 1000) return String(n)
  return `${(Math.round(n / 100) / 10).toString()}k`
}

/**
 * Token count for the answer meta: 1 → "1 token", 840 → "840 tokens", 1240 → "1.2k tokens".
 * With `t` the words come from the locale (plural by the exact count); without it, English.
 */
export function formatTokenCount(n: number, t?: TFunction): string {
  const amount = shortAmount(n)
  if (t) return t('{{amount}} tokens', { count: n, amount })
  return n === 1 ? `${amount} token` : `${amount} tokens`
}

function answerTokens(msg: Pick<Message, 'usage' | 'tokenCount'>): number | undefined {
  const usage = msg.usage
  if (usage?.totalTokens) return usage.totalTokens
  if (usage?.inputTokens !== undefined || usage?.outputTokens !== undefined) {
    const sum = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
    if (sum > 0) return sum
  }
  return msg.tokenCount || undefined
}

/** The answer's meta line: model · tokens · time, each part only when known. */
export function formatAnswerMeta(
  msg: Pick<Message, 'model' | 'usage' | 'tokenCount' | 'durationMs'>,
  t?: TFunction
): string {
  const parts: string[] = []
  if (msg.model) parts.push(msg.model)
  const tokens = answerTokens(msg)
  if (tokens !== undefined) parts.push(formatTokenCount(tokens, t))
  if (msg.durationMs !== undefined) parts.push(formatDangoDuration(msg.durationMs))
  return parts.join(' · ')
}
