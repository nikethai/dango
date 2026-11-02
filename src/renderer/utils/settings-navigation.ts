/**
 * Pure helpers for settings entry/exit navigation.
 * Kept free of router imports so unit tests stay lightweight.
 */

/** Parent path within settings for mobile back navigation, or null at settings root. */
export function getSettingsParentPath(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] !== 'settings' || parts.length <= 1) {
    return null
  }
  if (parts.length === 2) {
    return '/settings'
  }
  return `/${parts.slice(0, -1).join('/')}`
}

/** Whether `pathname` is a page under Settings. */
export function isSettingsPath(pathname: string): boolean {
  return pathname === '/settings' || pathname.startsWith('/settings/')
}

/**
 * The page closing Settings returns to: the last page outside Settings, with its search (a scope's tab). A chat or the
 * new-chat draft is left to `resolveSettingsExit`, which checks the chat still exists; null when Settings was the
 * first page (cold entry).
 */
export function settingsOpenerHref(opener: { pathname: string; href: string } | undefined): string | null {
  if (!opener || isSettingsPath(opener.pathname)) return null
  if (opener.pathname === '/new' || opener.pathname.startsWith('/session/')) return null
  return opener.href
}

/** Resolve where leaving settings should land given the cached session and storage validation result. */
export function resolveSettingsExitTarget(
  sessionId: string | null | undefined,
  sessionExists = true
): {
  to: '/session/$sessionId' | '/' | '/new'
  params?: { sessionId: string }
} {
  if (sessionId && sessionId !== 'new' && sessionExists) {
    return { to: '/session/$sessionId', params: { sessionId } }
  }
  if (sessionId === 'new' && sessionExists) {
    return { to: '/new' }
  }
  return { to: '/' }
}

/**
 * Where leaving settings should land. `'new'` is the open new-chat draft: it is never in storage,
 * so it counts as existing and returns to `/new`; any other id is checked with `sessionExists`.
 */
export async function resolveSettingsExit(
  sessionId: string | null | undefined,
  sessionExists: (id: string) => Promise<boolean>
): Promise<ReturnType<typeof resolveSettingsExitTarget>> {
  const exists = sessionId === 'new' || Boolean(sessionId && (await sessionExists(sessionId)))
  return resolveSettingsExitTarget(sessionId, exists)
}

/** Build the `/settings/*` path for open-settings navigations. */
export function resolveSettingsEntryPath(path?: string): string {
  const suffix = path ? (path.startsWith('/') ? path : `/${path}`) : '/provider'
  return `/settings${suffix === '/' ? '/provider' : suffix}`
}
