import { isEverywhere, type Scope } from '@shared/types'

/** The scope a path is in: `/scope/<id>` → id. Everywhere and every other page → undefined. */
export function scopeIdFromPath(pathname: string): string | undefined {
  const match = /^\/scope\/([^/?#]+)/.exec(pathname)
  if (!match) return undefined
  const id = decodeURIComponent(match[1])
  return isEverywhere(id) ? undefined : id
}

/** A new chat's scope from a link: undefined unless a stored scope has that id (deleted scopes and Everywhere start unscoped). */
export function resolveDraftScopeId(scopeId: string | undefined, scopes: Scope[]): string | undefined {
  if (!scopeId || isEverywhere(scopeId)) return undefined
  return scopes.some((scope) => scope.id === scopeId) ? scopeId : undefined
}
