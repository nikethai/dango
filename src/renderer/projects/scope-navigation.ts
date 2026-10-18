import { isEverywhere, type Scope } from '@shared/types'

/** The scope a path is in: `/scope/<id>` → id. Everywhere and every other page → undefined. */
export function scopeIdFromPath(pathname: string): string | undefined {
  const match = /^\/scope\/([^/?#]+)/.exec(pathname)
  if (!match) return undefined
  const id = decodeURIComponent(match[1])
  return isEverywhere(id) ? undefined : id
}

/**
 * The scope ⌘N starts a chat in: on Review (`/`) the toolbar's scope filter (`?scope=`), as its New chat button
 * does; elsewhere the scope page in the path. Everywhere means unscoped.
 */
export function newChatScopeId(pathname: string, search: unknown): string | undefined {
  if (pathname !== '/') return scopeIdFromPath(pathname)
  const scope = (search as { scope?: unknown } | null | undefined)?.scope
  return typeof scope === 'string' && scope && !isEverywhere(scope) ? scope : undefined
}

/** A new chat's scope from a link: undefined unless a stored scope has that id (deleted scopes and Everywhere start unscoped). */
export function resolveDraftScopeId(scopeId: string | undefined, scopes: Scope[]): string | undefined {
  if (!scopeId || isEverywhere(scopeId)) return undefined
  return scopes.some((scope) => scope.id === scopeId) ? scopeId : undefined
}
