/**
 * Session-level "live generation" lock for UI (Stop button, statusline, scroll).
 * Independent of message.generating cache patches so multi-step tool rounds never
 * flash Send / idle chrome mid-turn.
 */

type Listener = () => void

const liveBySession = new Map<string, string>() // sessionId -> messageId
/** messageId -> when its turn went live (send), the stable origin for live timers. */
const liveStartedAt = new Map<string, number>()
const listeners = new Set<Listener>()

function emit() {
  for (const l of listeners) {
    try {
      l()
    } catch {
      // non-fatal
    }
  }
}

export function markSessionGenerationLive(sessionId: string, messageId: string): void {
  const prev = liveBySession.get(sessionId)
  if (prev === messageId) return
  if (prev) liveStartedAt.delete(prev)
  liveBySession.set(sessionId, messageId)
  liveStartedAt.set(messageId, Date.now())
  emit()
}

export function clearSessionGenerationLive(sessionId: string, messageId?: string): void {
  const cur = liveBySession.get(sessionId)
  if (!cur) return
  if (messageId && cur !== messageId) return
  liveBySession.delete(sessionId)
  liveStartedAt.delete(cur)
  emit()
}

/**
 * When the message's live turn started (marked at send, kept for the whole multi-step turn), or undefined when it is
 * not live in this window. Live timers count from it: the message timestamp moves on every persisted write, and a
 * remount (chat switch, virtualised scroll) must not restart the timer or its 8 s / 30 s stages.
 */
export function getLiveGenerationStartedAt(messageId: string): number | undefined {
  return liveStartedAt.get(messageId)
}

export function isSessionGenerationLive(sessionId: string): boolean {
  return liveBySession.has(sessionId)
}

export function getLiveGenerationMessageId(sessionId: string): string | undefined {
  return liveBySession.get(sessionId)
}

export function subscribeSessionGenerationLive(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
