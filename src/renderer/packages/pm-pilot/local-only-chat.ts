import type { Message } from '@shared/types'

/*
 * Whether a chat holds text a local model read from device-only mail or tasks (ADR 0003). Type imports only, so the
 * settings export (`storage/exportFilter.ts`) can use it without loading i18next, model checks or providers.
 * `model-calls/toolsets/pm-pilot-history.ts` re-exports everything here.
 */

export const CLIENT_RECALL_TOOL = 'client_recall'
export const CLIENT_ANSWER_TOOL = 'client_answer'
const PM_TOOLS: ReadonlySet<string> = new Set([CLIENT_RECALL_TOOL, CLIENT_ANSWER_TOOL])

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
export function holdsLocalOnlyRecall(message: Pick<Message, 'contentParts' | 'pmLocalOnly'>): boolean {
  return message.pmLocalOnly === true || usedLocalOnlyRecall(message)
}

/**
 * True when the chat holds text a local model read from local-only mail or tasks: a local-only recall, a summary
 * built from one, or a Needs you chat (whose opening quotes client mail). Legacy memory saves nothing from such a chat.
 * Take it from the messages before `cloudSafeMessages`, whose placeholder drops the tool parts.
 */
export function chatHoldsLocalOnly(
  messages: Pick<Message, 'contentParts' | 'pmLocalOnly' | 'pmQuestionId'>[]
): boolean {
  return messages.some((m) => holdsLocalOnlyRecall(m) || !!m.pmQuestionId)
}
