import type { Message, Session } from '@shared/types'
import { attachmentsNeedVision, type ModelNeeds, turnNeedsTools } from '@/utils/modelReadiness'
import { isToolsOffTurn, turnUserMessage } from './tools-off'

/** The message list (root or an older thread) holding the message. Pure: no store reads. */
function messageListOf(session: Session, messageId: string): Message[] | null {
  if (session.messages.some((m) => m.id === messageId)) return session.messages
  return session.threads?.find((thread) => thread.messages.some((m) => m.id === messageId))?.messages ?? null
}

/**
 * What a turn needs from a model when it is redone with another one (Redo ▾), checked before sending like the
 * composer does: tools when the chat runs tools (unless the turn was sent without tools), vision when the turn's
 * question carries a video, or a picture that no OCR model reads. Swarm counts only in a room of two or more agents.
 */
export function turnAbilityNeeds(
  session: Session,
  targetMsgId: string,
  options: { ocrReady?: boolean } = {}
): Required<ModelNeeds> {
  const list = messageListOf(session, targetMsgId)
  if (!list) return { requiresTools: false, requiresVision: false }
  const isRoom = (session.agentIds?.length ?? 0) > 1
  const requiresTools =
    !isToolsOffTurn(list, targetMsgId) &&
    turnNeedsTools({
      agentMode: session.agentMode,
      browserArmed: session.browserArmed,
      computerArmed: session.computerArmed,
      roomMode: isRoom ? session.roomMode : undefined,
    })
  const question = turnUserMessage(list, targetMsgId)
  const requiresVision = attachmentsNeedVision({
    pictureCount: question?.contentParts?.filter((part) => part.type === 'image').length ?? 0,
    hasVideo: Boolean(question?.files?.some((file) => file.mediaKind === 'video')),
    ocrReady: Boolean(options.ocrReady),
  })
  return { requiresTools, requiresVision }
}
