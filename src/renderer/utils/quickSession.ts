export const QUICK_SESSION_REUSE_WINDOW_MS = 3 * 60 * 1000

export type QuickSessionSnapshot = {
  sessionId: string | null
  lastOpenedAt: number
  lastScopeId: string | null
}

export function resolveQuickSessionId(
  snapshot: QuickSessionSnapshot | null | undefined,
  availableSessionIds: string[],
  now = Date.now()
): string | null {
  if (!snapshot || !snapshot.sessionId || !Number.isFinite(snapshot.lastOpenedAt)) {
    return null
  }

  if (!availableSessionIds.includes(snapshot.sessionId)) {
    return null
  }

  const elapsed = now - snapshot.lastOpenedAt
  if (elapsed < 0 || elapsed > QUICK_SESSION_REUSE_WINDOW_MS) {
    return null
  }

  return snapshot.sessionId
}
export const QUICK_SESSION_STORAGE_KEY = 'dango.quick-session'

export function readQuickSessionSnapshot(): QuickSessionSnapshot | null {
  if (typeof localStorage === 'undefined') {
    return null
  }

  try {
    const raw = localStorage.getItem(QUICK_SESSION_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    // Tolerant reader: older snapshots lack lastScopeId; wrong types fall back to defaults.
    return {
      sessionId: typeof record.sessionId === 'string' && record.sessionId ? record.sessionId : null,
      lastOpenedAt:
        typeof record.lastOpenedAt === 'number' && Number.isFinite(record.lastOpenedAt) ? record.lastOpenedAt : 0,
      lastScopeId: typeof record.lastScopeId === 'string' && record.lastScopeId ? record.lastScopeId : null,
    }
  } catch {
    return null
  }
}

export function writeQuickSessionSnapshot(snapshot: QuickSessionSnapshot): void {
  if (typeof localStorage === 'undefined') {
    return
  }

  try {
    localStorage.setItem(QUICK_SESSION_STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // Persistence is best effort; the quick window still works for this session.
  }
}
