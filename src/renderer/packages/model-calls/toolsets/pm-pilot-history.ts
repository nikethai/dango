import { type Evidence, mayReachCloud } from '@shared/pm-pilot'
import type { Message } from '@shared/types'
import type { KnowledgeItem } from '@shared/types/knowledge'

/*
 * What a cloud chat turn may carry from the PM pilot (ADR 0003: a local-only source's text never reaches a cloud
 * model). Pure; stream-text applies both only when the turn's model is cloud.
 * - An earlier answer that used a `client_recall` result marked `localOnly` (records a local model was given) is sent
 *   as a fixed placeholder: its text, reasoning and the tool result all stay on the device.
 * - Approved knowledge follows the pipeline's rule (`mayReachCloud`): an item is dropped when any of its live sources
 *   is local-only; knowledge the user typed (no source id) goes.
 */

export const CLIENT_RECALL_TOOL = 'client_recall'

/** Translation key (en value = key) of what a cloud model sees in place of such an answer. */
export const LOCAL_ONLY_ANSWER_PLACEHOLDER =
  '(This answer used email or tasks kept on this device, so it is not shared with this model.)'

function isLocalOnlyRecallResult(result: unknown): boolean {
  return typeof result === 'object' && result !== null && (result as { localOnly?: unknown }).localOnly === true
}

/** True when the message holds a `client_recall` result that carried local-only records. */
export function usedLocalOnlyRecall(message: Pick<Message, 'contentParts'>): boolean {
  return (message.contentParts ?? []).some(
    (p) => p.type === 'tool-call' && p.toolName === CLIENT_RECALL_TOOL && isLocalOnlyRecallResult(p.result)
  )
}

/**
 * The messages with every such answer replaced by `placeholder` (nothing else of it kept); an empty placeholder (no
 * translation loaded) falls back to the English text.
 */
export function hideLocalOnlyRecalls(messages: Message[], placeholder: string): Message[] {
  if (!messages.some(usedLocalOnlyRecall)) return messages
  const text = placeholder || LOCAL_ONLY_ANSWER_PLACEHOLDER
  return messages.map((m) => {
    if (!usedLocalOnlyRecall(m)) return m
    const {
      reasoningContent: _r,
      citations: _c,
      artifacts: _a,
      searchQuery: _q,
      groundingMetadata: _g,
      followUpSuggestions: _f,
      ...rest
    } = m
    return { ...rest, contentParts: [{ type: 'text' as const, text }] }
  })
}

/**
 * Whether approved knowledge may go to a cloud model. `localOnly` is the set of local-only source ids; `null` when
 * it could not be read, and then any item with a source id is held back.
 */
export function knowledgeMayReachCloud(
  item: Pick<KnowledgeItem, 'id' | 'sources'>,
  localOnly: ReadonlySet<string> | null
): boolean {
  const live = (item.sources ?? []).filter((s) => !s.removed)
  const sourceIds = [...new Set(live.flatMap((s) => (s.sourceId ? [s.sourceId] : [])))]
  if (localOnly === null) return sourceIds.length === 0
  const evidence: Evidence = {
    id: `k:${item.id}`,
    label: '',
    date: 0,
    text: '',
    source: { kind: live[0]?.kind ?? 'user', label: '', ...(live[0]?.sourceId ? { sourceId: live[0].sourceId } : {}) },
    sourceIds,
  }
  return mayReachCloud(evidence, localOnly)
}
