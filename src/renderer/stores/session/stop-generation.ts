/**
 * Stop in-flight generation for a session: abort stream + clear UI generating flag.
 * Prefer registry cancel over Message.cancel (functions are lost after JSON persist).
 */

import type { Message, MessageContentParts, Session } from '@shared/types'
import * as chatStore from '../chatStore'
import { cancelSessionGeneration, getActiveGenerationMessageId } from './generation-cancel'
import { modifyMessage } from './messages'
import { cancelRateLimitRetry } from './rate-limit-retry'
import { clearSessionGenerationLive } from './session-live-generation'

function markRunningToolsCancelled(parts: MessageContentParts | undefined): MessageContentParts | undefined {
  if (!parts?.length) return parts
  let changed = false
  const next = parts.map((part) => {
    if (part.type === 'tool-call' && part.state === 'call') {
      changed = true
      return {
        ...part,
        state: 'error' as const,
        result: { message: 'Stopped by user', cancelled: true },
      }
    }
    return part
  })
  return changed ? next : parts
}

/**
 * Abort generation and mark the assistant message done.
 * Returns true when a generating message was found / cancel was attempted.
 */
export async function stopSessionGeneration(
  sessionId: string,
  lastGeneratingMessage?: Message | null
): Promise<boolean> {
  // A waiting rate-limit retry is not live, so cancel it before the nothing-live early return.
  cancelRateLimitRetry(sessionId)
  const registryMsgId = getActiveGenerationMessageId(sessionId)
  const hasLive = Boolean(lastGeneratingMessage?.generating) || Boolean(registryMsgId)
  if (!hasLive) {
    return false
  }

  // 1) Abort stream (registry first — survives cancel fn strip)
  const aborted = cancelSessionGeneration(sessionId)
  if (!aborted && typeof lastGeneratingMessage?.cancel === 'function') {
    try {
      lastGeneratingMessage.cancel()
    } catch {
      // ignore
    }
  }

  // Drop session live-lock so Stop → Send immediately after user abort.
  clearSessionGenerationLive(sessionId, lastGeneratingMessage?.id ?? registryMsgId)

  // 2) Clear UI generating flag + stuck tool rows (never wipe contentParts)
  if (lastGeneratingMessage?.generating) {
    const contentParts = markRunningToolsCancelled(lastGeneratingMessage.contentParts)
    await modifyMessage(
      sessionId,
      {
        ...lastGeneratingMessage,
        generating: false,
        cancel: undefined,
        status: [],
        ...(contentParts ? { contentParts } : {}),
      },
      true
    )
    return true
  }

  const messageId = registryMsgId
  if (messageId) {
    await chatStore.updateMessage(sessionId, messageId, (m) => {
      if (!m) return m as unknown as Message
      return {
        ...m,
        generating: false,
        cancel: undefined,
        status: [],
        contentParts: markRunningToolsCancelled(m.contentParts) ?? m.contentParts,
      }
    })
  }

  return true
}

/**
 * Stop whatever this chat is running before an action that rewrites or removes its messages (delete, edit and resend).
 * A run counts when a message is marked generating or when the cancel registry still knows it: generate() registers its
 * run a moment before the message is marked. A waiting rate-limit retry is dropped either way. Pass the chat when it
 * was just read; otherwise it is read here. Resolves true when something was running.
 */
export async function stopChatIfRunning(sessionId: string, session?: Session | null): Promise<boolean> {
  const current = session ?? (await chatStore.getSession(sessionId))
  const generating = current ? [...current.messages].reverse().find((m) => m.generating) : undefined
  if (!generating && !getActiveGenerationMessageId(sessionId)) {
    cancelRateLimitRetry(sessionId)
    return false
  }
  await stopSessionGeneration(sessionId, generating ?? null)
  return true
}
