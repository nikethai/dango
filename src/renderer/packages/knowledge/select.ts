import type { KnowledgeItem, KnowledgeKind, KnowledgeState } from '@shared/types/knowledge'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'

// The built-in item and the pure list selector. Kept free of undo, Review and storage imports so that
// chat context assembly (`for-turn`, `message-utils`) can read knowledge without pulling them in.

/** sha256 of `preference\nNever send email\n` (see `contentHash`). */
const NEVER_SEND_EMAIL_HASH = '743095b0d8f494d8ecabc9a04bfdf7ba7fee8ddc4b2b7cb699f3335c3588bd5c'

/**
 * The built-in Everywhere preference. It is never stored, so it cannot be edited, removed or moved, and
 * health checks skip it.
 */
export const NEVER_SEND_EMAIL: KnowledgeItem = {
  id: 'builtin:never-send-email',
  scopeId: EVERYWHERE_SCOPE_ID,
  kind: 'preference',
  text: 'Never send email',
  sources: [{ kind: 'user', label: 'Built in', id: 's1' }],
  status: 'approved',
  history: [],
  revisions: [
    {
      id: 'r1',
      text: 'Never send email',
      by: 'user',
      createdAt: 0,
      approval: { by: 'user', at: 0, contentHash: NEVER_SEND_EMAIL_HASH },
    },
  ],
  approvedRevisionId: 'r1',
  createdAt: 0,
  updatedAt: 0,
}

export type KnowledgeListOptions = { status?: KnowledgeItem['status'][]; kind?: KnowledgeKind[]; query?: string }

/** Lower case, accents dropped (NFD, marks stripped), for search. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/**
 * The scope's items, newest `updatedAt` first; default status `approved`. In Everywhere the built-in item
 * leads whenever it matches. Pure, so hooks and `listKnowledge` share it.
 */
export function selectKnowledge(state: KnowledgeState, scopeId: string, opts?: KnowledgeListOptions): KnowledgeItem[] {
  const statuses = opts?.status ?? ['approved']
  const kinds = opts?.kind
  const query = fold(opts?.query?.trim() ?? '')
  const matches = (i: KnowledgeItem) =>
    statuses.includes(i.status) && (!kinds || kinds.includes(i.kind)) && (!query || fold(i.text).includes(query))
  const items = state.items.filter((i) => i.scopeId === scopeId && matches(i)).sort((a, b) => b.updatedAt - a.updatedAt)
  return scopeId === EVERYWHERE_SCOPE_ID && matches(NEVER_SEND_EMAIL) ? [NEVER_SEND_EMAIL, ...items] : items
}
