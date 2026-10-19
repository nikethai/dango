import { createMessage, type Message, type MessageContentParts } from '@shared/types'
import * as chatStore from '../chatStore'
import { createNewFork, findMessageLocation } from './forks'
import { generateMoreInNewFork } from './generation'
import { modifyMessage, submitNewUserMessage } from './messages'

/** The message's parts with its text replaced by `text` (at the first text part); images and other parts stay. */
export function replaceMessageText(parts: MessageContentParts, text: string): MessageContentParts {
  const firstText = parts.findIndex((p) => p.type === 'text')
  if (firstText < 0) {
    return [{ type: 'text', text }, ...parts]
  }
  return parts.flatMap((part, index): MessageContentParts => {
    if (part.type !== 'text') return [part]
    return index === firstText ? [{ ...part, text }] : []
  })
}

/** A new user turn with the old one's attachments, quote and chips, and the new text. */
function copyUserMessage(source: Message, text: string): Message {
  return {
    ...createMessage('user', ''),
    name: source.name,
    files: source.files,
    links: source.links,
    memoryAttachments: source.memoryAttachments,
    quoteAttachment: source.quoteAttachment,
    skillIds: source.skillIds,
    commandIds: source.commandIds,
    mentionedAgentIds: source.mentionedAgentIds,
    credentialIds: source.credentialIds,
    toolsOff: source.toolsOff,
    contentParts: replaceMessageText(source.contentParts, text),
  }
}

/**
 * Edit a user message and send it again. The old question and its answer stay as the other branch (the fork arrows
 * switch back to them). In the current list the edit forks just before the question and sends an edited copy; a first
 * message (nothing to fork before) or one in an older thread is edited in place and answered in a new branch, so the
 * old answer is still kept.
 */
export async function editAndResend(sessionId: string, messageId: string, text: string): Promise<void> {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    throw new Error(`Session ${sessionId} not found`)
  }
  const location = findMessageLocation(session, messageId)
  if (!location) {
    throw new Error(`Message ${messageId} not found`)
  }
  // Forking moves later messages into the old branch; one still streaming there would never settle, so stop it first.
  const streaming = [...session.messages].reverse().find((m) => m.generating)
  if (streaming) {
    const { stopSessionGeneration } = await import('./stop-generation')
    await stopSessionGeneration(sessionId, streaming)
  }
  const message = location.list[location.index]
  const predecessor = location.index > 0 ? location.list[location.index - 1] : undefined
  // A send always lands at the end of the current list, so the fork-and-send path is only for that list.
  if (predecessor && location.list === session.messages) {
    await createNewFork(sessionId, predecessor.id)
    await submitNewUserMessage(sessionId, { newUserMsg: copyUserMessage(message, text), needGenerating: true })
    return
  }
  await modifyMessage(sessionId, { ...message, contentParts: replaceMessageText(message.contentParts, text) }, true)
  await generateMoreInNewFork(sessionId, messageId)
}
