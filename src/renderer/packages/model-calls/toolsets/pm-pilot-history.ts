import { type Evidence, mayReachCloud } from '@shared/pm-pilot'
import type { Message } from '@shared/types'
import type { KnowledgeItem } from '@shared/types/knowledge'
import { t } from 'i18next'
import { isLocalModelProvider } from '@/packages/sources/model-check'

/*
 * What a cloud model may be sent from the PM pilot (ADR 0003: a local-only source's text never reaches a cloud
 * model). `cloudSafeMessages` is the one entry for every path that sends a chat's messages to a model: chat turns
 * (stream-text), the chat knowledge proposer, compaction and "New chat with summary" (the summary generator).
 * - An earlier answer that used a `client_recall` or `client_answer` result marked `localOnly` (records a local model
 *   was given) is sent as a fixed placeholder: its text, reasoning and the tool result all stay on the device.
 * - A Needs you chat (CH6) opens with a message that quotes client mail (`pmQuestionId`). While its question is
 *   local-only, or when that is not known, the opening and every later assistant message of the chat are sent as the
 *   placeholder; the user's own messages go. Any other message carrying that question (a summary of the chat) is
 *   sent as the placeholder too.
 * - After the first local-only recall (or a summary marked `pmLocalOnly` that was built from one), every later
 *   assistant message is sent as the placeholder too: a local model may repeat the records in later answers.
 * - Approved knowledge follows the pipeline's rule (`mayReachCloud`): an item is dropped when any of its live sources
 *   is local-only; knowledge the user typed (no source id) goes.
 */

export const CLIENT_RECALL_TOOL = 'client_recall'
export const CLIENT_ANSWER_TOOL = 'client_answer'
const PM_TOOLS: ReadonlySet<string> = new Set([CLIENT_RECALL_TOOL, CLIENT_ANSWER_TOOL])

/** Translation key (en value = key) of what a cloud model sees in place of such an answer. */
export const LOCAL_ONLY_ANSWER_PLACEHOLDER =
  '(This answer used email or tasks kept on this device, so it is not shared with this model.)'

function isLocalOnlyRecallResult(result: unknown): boolean {
  return typeof result === 'object' && result !== null && (result as { localOnly?: unknown }).localOnly === true
}

/** True when the message holds a `client_recall` or `client_answer` result marked local-only. */
export function usedLocalOnlyRecall(message: Pick<Message, 'contentParts'>): boolean {
  return (message.contentParts ?? []).some(
    (p) => p.type === 'tool-call' && PM_TOOLS.has(p.toolName) && isLocalOnlyRecallResult(p.result)
  )
}

/** True when the message used a local-only recall, or is a summary built from messages that did. */
function holdsLocalOnlyRecall(message: Pick<Message, 'contentParts' | 'pmLocalOnly'>): boolean {
  return message.pmLocalOnly === true || usedLocalOnlyRecall(message)
}

/**
 * The marks a summary of these messages carries (compaction, New chat with summary), so a cloud turn holds it back
 * like the messages it was built from: the Needs you question, and `pmLocalOnly` after a local-only recall.
 */
export function summaryLocalOnlyMarks(
  messages: Pick<Message, 'contentParts' | 'pmLocalOnly' | 'pmQuestionId'>[]
): Pick<Message, 'pmQuestionId' | 'pmLocalOnly'> {
  const [questionId] = ch6QuestionIds(messages)
  return {
    ...(questionId ? { pmQuestionId: questionId } : {}),
    ...(messages.some(holdsLocalOnlyRecall) ? { pmLocalOnly: true } : {}),
  }
}

/** The questions whose Needs you chats these messages open, once each. */
export function ch6QuestionIds(messages: Pick<Message, 'pmQuestionId'>[]): string[] {
  return [...new Set(messages.flatMap((m) => (m.pmQuestionId ? [m.pmQuestionId] : [])))]
}

/** Index of the first opening whose question is local-only (all are, when `localOnly` is null); -1 when none. */
function firstLocalOnlyOpening(messages: Message[], localOnly: ReadonlySet<string> | null): number {
  return messages.findIndex((m) => !!m.pmQuestionId && (localOnly === null || localOnly.has(m.pmQuestionId)))
}

/**
 * The messages with every such answer replaced by `placeholder` (nothing else of it kept); an empty placeholder (no
 * translation loaded) falls back to the English text. `localOnlyQuestions`: the questions of Needs you chats that are
 * local-only now; null (the default) when unknown, which hides every Needs you chat's assistant messages.
 */
export function hideLocalOnlyRecalls(
  messages: Message[],
  placeholder: string,
  localOnlyQuestions: ReadonlySet<string> | null = null
): Message[] {
  const starts = [firstLocalOnlyOpening(messages, localOnlyQuestions), messages.findIndex(holdsLocalOnlyRecall)]
  const from = Math.min(...starts.map((i) => (i < 0 ? Number.POSITIVE_INFINITY : i)))
  const localQuestion = (id: string | undefined) => !!id && (localOnlyQuestions === null || localOnlyQuestions.has(id))
  const hidden = (m: Message, i: number) =>
    holdsLocalOnlyRecall(m) || localQuestion(m.pmQuestionId) || (i >= from && m.role === 'assistant')
  if (!messages.some(hidden)) return messages
  const text = placeholder || LOCAL_ONLY_ANSWER_PLACEHOLDER
  return messages.map((m, i) => {
    if (!hidden(m, i)) return m
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
 * The messages as `provider`'s model may receive them: unchanged for a local model (Ollama, LM Studio); for any other
 * provider, or none given, `hideLocalOnlyRecalls` with the CH6 questions that are local-only now (all of them when
 * that cannot be read).
 */
export async function cloudSafeMessages(messages: Message[], provider: string | undefined | null): Promise<Message[]> {
  if (isLocalModelProvider(provider)) return messages
  const questionIds = ch6QuestionIds(messages)
  let localOnly: Set<string> | null = new Set()
  if (questionIds.length > 0) {
    try {
      const { loadLocalOnlyQuestionIds } = await import('./pm-pilot')
      localOnly = await loadLocalOnlyQuestionIds(questionIds)
    } catch (error) {
      console.warn('[pm-pilot] Local-only questions could not be read; their chats are held back', error)
      localOnly = null
    }
  }
  return hideLocalOnlyRecalls(messages, t(LOCAL_ONLY_ANSWER_PLACEHOLDER), localOnly)
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
