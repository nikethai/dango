import { toSessionAgentFieldsFromSelection } from '@shared/new-chat-agents'
import { EVERYWHERE_SCOPE_ID, type Scope, type Session } from '@shared/types'
import { z } from 'zod'

/** Search params of `/new`. Kept free of router imports so routes/new.tsx can use it without a cycle. */
export const NewChatSearchSchema = z.object({
  copilotId: z.string().optional(),
  scopeId: z.string().optional(),
  prefill: z.string().optional(),
})

export type NewChatSearch = z.infer<typeof NewChatSearchSchema>

/** Apply search params to a draft session. Absent params never clear what the user already picked. */
export function seedNewChatSession(session: Session, search: NewChatSearch): Session {
  let next = session
  if (search.copilotId) {
    next = { ...next, ...toSessionAgentFieldsFromSelection([search.copilotId]) }
  }
  if (search.scopeId && search.scopeId !== EVERYWHERE_SCOPE_ID) {
    next = { ...next, projectId: search.scopeId }
  }
  return next
}

/**
 * Put a draft in `scope` (none clears it). Preselects the scope's default agent only when no agent was chosen:
 * none on the draft and none named in the link.
 */
export function applyDraftScope(
  session: Session,
  scope: Pick<Scope, 'id' | 'defaultAgentId'> | undefined,
  options: { agentInSearch: boolean }
): Session {
  const next = { ...session, projectId: scope?.id }
  const agentChosen = options.agentInSearch || Boolean(session.agentIds?.length || session.copilotId)
  if (!agentChosen && scope?.defaultAgentId) {
    return { ...next, ...toSessionAgentFieldsFromSelection([scope.defaultAgentId]) }
  }
  return next
}

/** What `/new` last seeded from: the link's search object and the scope id it resolved to. */
export type DraftSeed = { search?: NewChatSearch; scopeId?: string }

/**
 * Seed a `/new` draft from its link. A new link always seeds. The same link resolving again (scopes loading late,
 * or the link's scope deleted while `/new` is open) re-applies only while the draft still holds the previous
 * resolution, so a scope the user picked in the pill is never overwritten.
 */
export function seedDraftFromLink(
  session: Session,
  link: { search: NewChatSearch; scopeId: string | undefined; scope: Pick<Scope, 'id' | 'defaultAgentId'> | undefined },
  previous: DraftSeed
): Session {
  const sameLink = previous.search === link.search
  if (sameLink && (previous.scopeId === link.scopeId || session.projectId !== previous.scopeId)) return session
  const next = seedNewChatSession(session, { ...link.search, scopeId: link.scopeId })
  return link.search.scopeId === undefined
    ? next
    : applyDraftScope(next, link.scope, { agentInSearch: Boolean(link.search.copilotId) })
}

/**
 * Whether a `prefill` seen by an already-open `/new` is new and should replace the composer draft
 * (startNewChat({ prefill }) while `/new` is open). The same prefill again, or none, keeps what the user typed.
 */
export function isNewPrefill(previous: string | undefined, next: string | undefined): next is string {
  return Boolean(next) && next !== previous
}
