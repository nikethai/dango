import { z } from 'zod'
import { ProjectSchema } from './session'

export const EVERYWHERE_SCOPE_ID = 'everywhere'

export type ScopeKind = 'project' | 'client'

export const ScopeSchema = ProjectSchema.extend({
  kind: z.enum(['project', 'client']).default('project'),
  readsEverywhere: z.object({ facts: z.boolean(), documents: z.boolean() }).optional(), // absent = defaults
})
export type Scope = z.infer<typeof ScopeSchema>

export function everywhereDefaults(kind: ScopeKind): { facts: boolean; documents: boolean } {
  return kind === 'client' ? { facts: true, documents: false } : { facts: true, documents: true }
}

export function readsEverywhereFor(scope: Pick<Scope, 'kind' | 'readsEverywhere'>): {
  facts: boolean
  documents: boolean
} {
  return scope.readsEverywhere ?? everywhereDefaults(scope.kind)
}

export function isEverywhere(id: string | undefined): boolean {
  return id === EVERYWHERE_SCOPE_ID
}
