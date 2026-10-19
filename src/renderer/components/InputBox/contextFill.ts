/** The composer shows a quiet line once a chat fills this share of its model's context window. */
export const CONTEXT_WARN_RATIO = 0.8

/** How full the context window is (0..1+), or `null` when the count or the window is unknown. */
export function contextFillRatio(used?: number, window?: number): number | null {
  if (typeof used !== 'number' || !Number.isFinite(used)) return null
  if (typeof window !== 'number' || !Number.isFinite(window) || window <= 0) return null
  return used / window
}

export function shouldWarnContextFill(ratio: number | null): boolean {
  return ratio !== null && ratio >= CONTEXT_WARN_RATIO
}
