/** English key: every kind shows it when unavailable on this platform (the UI passes it through t()). */
export const UNAVAILABLE_HINT = 'Needs the desktop app.'

/** Throws an `AbortError` when the run was stopped, so a stopped job never counts as a failure. */
export function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  const error = new Error('Aborted')
  error.name = 'AbortError'
  throw error
}

/** The last segment of a display path ("/Users/me/Work/Acme" → "Acme"). */
export function lastPathSegment(path: string): string {
  return (
    path
      .split(/[\\/]/)
      .filter((part) => part.length > 0)
      .pop() ?? path
  )
}
