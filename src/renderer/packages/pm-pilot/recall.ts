import { inertValues, type SourceRecord } from '@shared/pm-pilot'
import i18n from '@/i18n'
import { type ConnectedSource, listClientScopes, listSources, loadSources, type Scope } from './bridge'
import { getSourceHealth } from './pipeline'
import { overlap, tokens } from './retrieve'
import { pmStore } from './store'

/*
 * `client_recall` (slice 10, Task 10): what a client scope's synced email and tasks say, for a chat answer. Approved
 * knowledge already reaches the turn through `knowledgeForTurn`; this searches the records, which are not knowledge.
 *
 * - Only client scopes are searched, and only the one resolved scope's records are returned.
 * - Local-only (ADR 0003): on a cloud model, records of a local-only source, or of a source that is not connected (or
 *   not named), are skipped and the gap is stated.
 * - Record titles, names and text are external data. They go back to the model as plain JSON fields, capped per
 *   record and in total; links are kept only when they are http(s).
 */

export const RECALL_DEFAULT_LIMIT = 8
export const RECALL_MAX_LIMIT = 20
export const RECALL_TITLE_CHARS = 200
export const RECALL_RECORD_TEXT_CHARS = 1500
/** Titles and texts of all returned records together. */
export const RECALL_TOTAL_CHARS = 12_000

export type ClientCandidate = { id: string; name: string }
export type ClientResolveErrorCode = 'ambiguous_client' | 'unknown_client' | 'no_client_given'

export type ResolvedClient =
  | { ok: true; scope: Scope }
  | { ok: false; code: ClientResolveErrorCode; candidates: ClientCandidate[] }

export type RecalledRecord = {
  kind: 'email' | 'task'
  title: string
  text: string
  /** Gmail sender (name, else address) or Asana author. */
  from: string
  sentByMe: boolean
  /** Only when the record's link is http(s). */
  link?: { label: string; url: string }
  occurredAt: number
  date: string
}

export type ClientRecallResult =
  | { ok: true; scope: ClientCandidate; records: RecalledRecord[]; gaps: string[] }
  | { ok: false; code: ClientResolveErrorCode; candidates: ClientCandidate[] }

const candidate = (s: Scope): ClientCandidate => ({ id: s.id, name: s.name })
const fold = (s: string) => s.trim().toLocaleLowerCase()

/**
 * The client scope a recall is about. No name: the session's scope when it is a client scope, else `no_client_given`.
 * A name: an id, else an exact case-insensitive name, else names that contain it (or that it contains). Only
 * `kind === 'client'` scopes are considered.
 */
export function resolveClientScope(
  nameOrId: string | undefined,
  sessionScopeId: string | undefined,
  scopes: Scope[]
): ResolvedClient {
  const clients = scopes.filter((s) => s.kind === 'client')
  const wanted = fold(nameOrId ?? '')
  if (!wanted) {
    const own = clients.find((s) => s.id === sessionScopeId)
    return own ? { ok: true, scope: own } : { ok: false, code: 'no_client_given', candidates: clients.map(candidate) }
  }
  const byId = clients.find((s) => s.id === nameOrId?.trim())
  if (byId) return { ok: true, scope: byId }
  const exact = clients.filter((s) => fold(s.name) === wanted)
  if (exact.length === 1) return { ok: true, scope: exact[0] }
  const matches = exact.length > 1 ? exact : clients.filter((s) => namesMatch(fold(s.name), wanted))
  if (matches.length === 1) return { ok: true, scope: matches[0] }
  if (matches.length > 1) return { ok: false, code: 'ambiguous_client', candidates: matches.map(candidate) }
  return { ok: false, code: 'unknown_client', candidates: clients.map(candidate) }
}

function namesMatch(name: string, wanted: string): boolean {
  if (!name) return false
  return name.includes(wanted) || (name.length >= 2 && wanted.includes(name))
}

function cap(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function httpLink(link: SourceRecord['link']): { label: string; url: string } | undefined {
  try {
    const url = new URL(link.url)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    return { label: cap(link.label, RECALL_TITLE_CHARS), url: link.url }
  } catch {
    return undefined
  }
}

function toRecalled(r: SourceRecord): RecalledRecord {
  const link = httpLink(r.link)
  return {
    kind: r.sourceKind === 'asana' ? 'task' : 'email',
    title: cap(r.title, RECALL_TITLE_CHARS),
    text: cap(r.text, RECALL_RECORD_TEXT_CHARS),
    from: cap(r.authorName?.trim() || r.author, RECALL_TITLE_CHARS),
    sentByMe: r.sentByMe,
    ...(link ? { link } : {}),
    occurredAt: r.occurredAt,
    date: new Date(r.occurredAt).toISOString(),
  }
}

const kindName = (kind: ConnectedSource['kind']) => (kind === 'asana' ? i18n.t('Asana') : i18n.t('Gmail'))

/** Outside the jobs window this window's copy of the records may be stale; the jobs window's copy is the newest. */
async function freshenRecords(): Promise<void> {
  const { getWindowRole } = await import('@/platform/windowRole')
  if ((await getWindowRole()) !== 'jobs') await pmStore.reloadRecords()
}

/**
 * Searches one client scope's synced email and tasks for `query`: records sharing the most words first, newest on a
 * tie (so a query that matches nothing returns the newest), noise skipped, at most `limit` (default 8, at most 20)
 * and `RECALL_TOTAL_CHARS` of text. `gaps` says what could not be searched or may be out of date.
 */
export async function recallClient(input: {
  client?: string
  query: string
  sessionScopeId?: string
  cloudModel: boolean
  limit?: number
}): Promise<ClientRecallResult> {
  const resolved = resolveClientScope(input.client, input.sessionScopeId, await listClientScopes())
  if (!resolved.ok) return resolved
  const { scope } = resolved

  await loadSources()
  const sources = listSources()
  const byId = new Map(sources.map((s) => [s.id, s]))
  const scopeSources = sources.filter((s) => s.scopeId === scope.id && (s.kind === 'gmail' || s.kind === 'asana'))

  await freshenRecords()
  const stored = (await pmStore.getRecords(scope.id)).filter((r) => r.scopeId === scope.id)

  const gaps: string[] = []
  for (const s of scopeSources) {
    const health = getSourceHealth(s.id)
    if (!health.ok) {
      gaps.push(
        i18n.t(
          '{{source}}: {{reason}} — results may be out of date',
          inertValues({ source: kindName(s.kind), reason: health.message })
        )
      )
    }
  }

  let usable = stored
  if (input.cloudModel) {
    const localOnlyKinds = new Set<ConnectedSource['kind']>()
    let unknown = false
    usable = stored.filter((r) => {
      const source = r.sourceId ? byId.get(r.sourceId) : undefined
      if (!source) {
        unknown = true
        return false
      }
      if (source.localOnly) {
        localOnlyKinds.add(source.kind)
        return false
      }
      return true
    })
    for (const s of scopeSources) if (s.localOnly) localOnlyKinds.add(s.kind)
    for (const kind of localOnlyKinds) {
      gaps.push(i18n.t('{{source}} stays on this device, so it was not searched', { source: kindName(kind) }))
    }
    if (unknown) gaps.push(i18n.t('Some email or tasks from a removed source were not searched'))
  }
  if (stored.length === 0) gaps.push(i18n.t('No email or tasks synced yet'))

  const limit = Math.min(RECALL_MAX_LIMIT, Math.max(1, Math.floor(input.limit ?? RECALL_DEFAULT_LIMIT)))
  const wanted = tokens(input.query)
  const ranked = usable
    .filter((r) => !r.noise)
    .map((r) => ({ r, score: overlap(wanted, tokens(`${r.title}\n${r.text}`)) }))
    .sort((a, b) => b.score - a.score || b.r.occurredAt - a.r.occurredAt)

  const records: RecalledRecord[] = []
  let total = 0
  for (const { r } of ranked) {
    if (records.length >= limit) break
    const out = toRecalled(r)
    const size = out.title.length + out.text.length
    if (total + size > RECALL_TOTAL_CHARS) break
    total += size
    records.push(out)
  }

  return { ok: true, scope: candidate(scope), records, gaps: [...new Set(gaps)] }
}
