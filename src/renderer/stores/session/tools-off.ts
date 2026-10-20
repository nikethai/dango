import type { Message } from '@shared/types'

/** The user message that opened the turn of `targetMsgId` (the target itself when it is a user message). */
export function turnUserMessage(messages: Message[], targetMsgId: string): Message | undefined {
  const index = messages.findIndex((m) => m.id === targetMsgId)
  if (index < 0) return undefined
  for (let i = index; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i]
  }
  return undefined
}

/** ER4 "Answer without tools": the turn's own user message was sent with `toolsOff`, so the answer takes no tools. */
export function isToolsOffTurn(messages: Message[], targetMsgId: string): boolean {
  return turnUserMessage(messages, targetMsgId)?.toolsOff === true
}
