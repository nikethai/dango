import { EVERYWHERE_SCOPE_ID, type Folder, type Scope, ScopeSchema, type ScopeKind } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'
import { projectToFolder } from './project-migration'

function sortScopes(scopes: Scope[]): Scope[] {
  return [...scopes].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}

/** Parse the stored `myProjects` value into scopes. Drops junk and any stored Everywhere. */
export function parseScopes(raw: unknown): Scope[] {
  if (!Array.isArray(raw)) return []
  const scopes: Scope[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const parsed = ScopeSchema.safeParse(entry)
    if (!parsed.success) continue
    if (!parsed.data.id || !parsed.data.name || parsed.data.id === EVERYWHERE_SCOPE_ID) continue
    scopes.push(parsed.data)
  }
  return sortScopes(scopes)
}

export function createScope(
  scopes: Scope[],
  input: { name: string; kind: ScopeKind; id?: string; defaultAgentId?: string }
): Scope {
  return {
    id: input.id || uuidv4(),
    name: input.name,
    kind: input.kind,
    defaultAgentId: input.defaultAgentId,
    order: scopes.reduce((max, s) => Math.max(max, s.order), -1) + 1,
  }
}

export function patchScope(scopes: Scope[], id: string, patch: Partial<Omit<Scope, 'id'>>): Scope[] {
  return scopes.map((scope) => {
    if (scope.id !== id) return scope
    const next: Scope = { ...scope, ...patch }
    if (patch.kind !== undefined && patch.kind !== scope.kind && !('readsEverywhere' in patch)) {
      next.readsEverywhere = undefined
    }
    return next
  })
}

/** Apply a legacy Folder-shaped update without losing scope-only fields (kind, readsEverywhere). */
export function applyFolderUpdate(scope: Scope, update: Partial<Folder> | ((folder: Folder) => Folder)): Scope {
  const folder = projectToFolder(scope)
  const nextFolder = typeof update === 'function' ? update(folder) : { ...folder, ...update }
  return { ...scope, ...nextFolder, id: scope.id }
}

export function validateScopeName(name: string): 'empty' | 'reserved' | null {
  const trimmed = name.trim()
  if (!trimmed) return 'empty'
  if (trimmed.toLowerCase() === EVERYWHERE_SCOPE_ID) return 'reserved'
  return null
}
