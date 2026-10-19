import { createMessage, type Message, type MessageContentParts } from '@shared/types'
import * as chatStore from '../chatStore'
import { createNewFork, findMessageLocation } from './forks'
import { generateMore, generateMoreInNewFork } from './generation'
import { insertMessageAfter, modifyMessage, submitNewUserMessage } from './messages'
import { stopChatIfRunning } from './stop-generation'

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
 * switch back to them): the edit forks just before the question and sends, or inserts, an edited copy. Only a first
 * message (nothing to fork before) is edited in place and answered in a new branch, so the old answer is still kept.
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
  // Forking moves later messages into the old branch; a run still streaming there would never settle, so stop the
  // chat first. This holds for an edit in an older thread too: the chat runs one answer at a time, so editing an old
  // message also stops the answer streaming in the current thread.
  await stopChatIfRunning(sessionId, session)
  const message = location.list[location.index]
  const predecessor = location.index > 0 ? location.list[location.index - 1] : undefined
  if (predecessor && location.list === session.messages) {
    // A send always lands at the end of the current list.
    await createNewFork(sessionId, predecessor.id)
    await submitNewUserMessage(sessionId, { newUserMsg: copyUserMessage(message, text), needGenerating: true })
    return
  }
  if (predecessor) {
    // An older thread: a send would land in the current list, so put the edited copy right after the fork point in
    // that thread and answer it there.
    const copy = copyUserMessage(message, text)
    await createNewFork(sessionId, predecessor.id)
    await insertMessageAfter(sessionId, copy, predecessor.id)
    await generateMore(sessionId, copy.id)
    return
  }
  await modifyMessage(sessionId, { ...message, contentParts: replaceMessageText(message.contentParts, text) }, true)
  await generateMoreInNewFork(sessionId, messageId)
}
