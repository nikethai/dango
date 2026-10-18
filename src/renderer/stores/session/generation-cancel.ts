/**
 * Session/message abort registry for generation.
 * cancel() on Message is easy to lose (JSON persist strips functions); this Map is the source of truth for Stop.
 */

type CancelEntry = {
  cancel: () => void
  messageId: string
}

const bySession = new Map<string, CancelEntry>()
/** `${sessionId}:${messageId}` → the abort function Stop fired for that message's run. */
const cancelledRuns = new Map<string, () => void>()
const runKey = (sessionId: string, messageId: string) => `${sessionId}:${messageId}`

export function registerGenerationCancel(sessionId: string, messageId: string, cancel: () => void): void {
  // A new run for this message clears an earlier Stop. The stream re-registers the same abort function on every
  // update, including trailing ones after Stop, so only a different function counts as a new run.
  const key = runKey(sessionId, messageId)
  const fired = cancelledRuns.get(key)
  if (fired && fired !== cancel) cancelledRuns.delete(key)
  // Replace any prior cancel for this session (one active gen per session)
  bySession.set(sessionId, {
    messageId,
    cancel: () => {
      try {
        cancelledRuns.set(key, cancel)
        cancel()
      } finally {
        const cur = bySession.get(sessionId)
        if (cur?.messageId === messageId) {
          bySession.delete(sessionId)
        }
      }
    },
  })
}

export function clearGenerationCancel(sessionId: string, messageId?: string): void {
  const cur = bySession.get(sessionId)
  if (!cur) return
  if (messageId && cur.messageId !== messageId) return
  bySession.delete(sessionId)
}

/** Abort in-flight generation for session. Returns true if a cancel was invoked. */
export function cancelSessionGeneration(sessionId: string): boolean {
  const cur = bySession.get(sessionId)
  if (!cur) return false
  cur.cancel()
  // Best-effort: stop isolated browser + computer act for this session (kill switch)
  void import('@/packages/model-calls/toolsets/browser')
    .then(({ stopBrowserSession }) => stopBrowserSession(sessionId))
    .catch(() => {})
  void import('@/platform')
    .then((m) => m.default.computerAbort?.())
    .catch(() => {})
  void import('@/packages/browser/lock')
    .then(({ releaseBrowserLock }) => releaseBrowserLock(sessionId))
    .catch(() => {})
  return true
}

export function getActiveGenerationMessageId(sessionId: string): string | undefined {
  return bySession.get(sessionId)?.messageId
}

/** True while an abort handle is registered for this session (stream in flight). */
export function isSessionGenerationActive(sessionId: string): boolean {
  return bySession.has(sessionId)
}

/** True when Stop fired for this message's current run (until a new run registers for it). */
export function wasGenerationCancelled(sessionId: string, messageId: string): boolean {
  return cancelledRuns.has(runKey(sessionId, messageId))
}
