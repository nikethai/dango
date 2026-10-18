import type { KnowledgeItem } from '@shared/types/knowledge'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { t } from 'i18next'
import { getLogger } from '@/lib/utils'
import { addReviewEntry } from '@/packages/review'
import { memoryStore } from '@/stores/memoryStore'
import { getScopeReads, scopeName } from './scopes'
import { NEVER_SEND_EMAIL, selectKnowledge } from './select'
import { commitKnowledge, knowledgeStore } from './store'
import { contentHash, parseStaleAfter, quote } from './text'

const log = getLogger('knowledge')

// ---- What a chat turn answers from (ADR 0001, ADR 0013) ----

/**
 * The approved knowledge a turn in `scopeId` answers from, in prompt order:
 * 1. the scope's approved items, newest first;
 * 2. Everywhere preferences, always (the built-in "Never send email" included);
 * 3. Everywhere facts and decisions, when the scope reads them (`getScopeReads(scopeId).facts`).
 * Items that failed the health check, and Everywhere items a scope item overrides, are left out (the
 * built-in never is). Everywhere itself gets only its own items. Proposals are never items, so they never
 * appear. Synchronous: callers `await ensureKnowledgeLoaded({ fresh: true })` first.
 */
export function knowledgeForTurn(scopeId: string): KnowledgeItem[] {
  const { state, unverified } = knowledgeStore.getState()
  const verified = (i: KnowledgeItem) => !unverified.has(i.id)
  const everywhere = (kind: KnowledgeItem['kind'][]) => selectKnowledge(state, EVERYWHERE_SCOPE_ID, { kind })

  if (scopeId === EVERYWHERE_SCOPE_ID) {
    return [...everywhere(['preference']), ...everywhere(['fact', 'decision'])].filter(verified)
  }

  const own = selectKnowledge(state, scopeId).filter(verified)
  const overridden = new Set(own.flatMap((i) => i.overrides ?? []))
  const applies = (i: KnowledgeItem) => verified(i) && (i.id === NEVER_SEND_EMAIL.id || !overridden.has(i.id))
  const preferences = everywhere(['preference']).filter(applies)
  const facts = getScopeReads(scopeId).facts ? everywhere(['fact', 'decision']).filter(applies) : []
  return [...own, ...preferences, ...facts]
}

function line(item: KnowledgeItem): string {
  const text = item.text.replace(/\s*\n\s*/g, ' ')
  return item.condition ? `- ${text} (when ${item.condition.replace(/\s*\n\s*/g, ' ')})` : `- ${text}`
}

/**
 * The system-prompt section for `knowledgeForTurn(scopeId)`: the scope's items, then Everywhere's, then
 * which one wins when they disagree. An empty list gives `''`. Prompt text, so not translated.
 */
export function formatKnowledgeSection(scopeId: string, items: KnowledgeItem[]): string {
  const isEverywhere = scopeId === EVERYWHERE_SCOPE_ID
  const own = isEverywhere ? [] : items.filter((i) => i.scopeId === scopeId)
  const shared = items.filter((i) => i.scopeId === EVERYWHERE_SCOPE_ID)
  const name = isEverywhere ? 'Everywhere' : scopeName(scopeId)
  let out = ''
  if (own.length) out += `\n## Approved knowledge: ${name}\n${own.map(line).join('\n')}\n`
  if (shared.length) out += `\n## Approved knowledge: Everywhere\n${shared.map(line).join('\n')}\n`
  if (own.length && shared.length) {
    out += `\nIf an item for ${name} disagrees with an Everywhere item, follow the ${name} item.\n`
  }
  return out
}

/**
 * Whether the old memory banks still feed chat (memory section, memory tools, host lookup): memory is on
 * and the move to knowledge has not finished. `ensureKnowledgeLoaded` reads the move's state in every window.
 */
export function isLegacyMemoryActive(): boolean {
  return memoryStore.getState().settings.enabled && knowledgeStore.getState().migration !== 'done'
}

// ---- Health check (ADR 0014) ----

/** Per item and revision: the hash input and its hash, so unchanged revisions are hashed once. */
const hashCache = new Map<string, { input: string; hash: string }>()

async function revisionHash(item: KnowledgeItem, revId: string, text: string, condition?: string): Promise<string> {
  const key = `${item.id}\u0000${revId}`
  const input = `${item.kind}\n${text}\n${condition ?? ''}`
  const cached = hashCache.get(key)
  if (cached?.input === input) return cached.hash
  const hash = await contentHash(item.kind, text, condition)
  hashCache.set(key, { input, hash })
  return hash
}

/** The approved revision exists, its approval is bound to its content, and `text`/`condition` mirror it. */
async function isVerified(item: KnowledgeItem): Promise<boolean> {
  const rev = item.revisions.find((r) => r.id === item.approvedRevisionId)
  if (!rev?.approval) return false
  if (item.text !== rev.text || item.condition !== rev.condition) return false
  return rev.approval.contentHash === (await revisionHash(item, rev.id, rev.text, rev.condition))
}

type Notice = NonNullable<KnowledgeItem['healthNotice']>

/**
 * Checks every approved item (the built-in excepted): an unverified one goes into the store's
 * `unverified` (answers leave it out); an unverified or due (`staleAfter` passed) one files one `re-check`
 * Review entry, once per revision id or `staleAfter` value (`healthNotice`, set without undo). A due item
 * stays in use. Run by `ensureKnowledgeLoaded` after every load.
 */
export async function checkKnowledgeHealth(now: number = Date.now()): Promise<void> {
  const items = knowledgeStore.getState().state.items.filter((i) => i.status === 'approved')
  const unverified = new Set<string>()
  const notices: Array<{ item: KnowledgeItem; notice: Notice }> = []
  for (const item of items) {
    if (item.id === NEVER_SEND_EMAIL.id) continue
    let notice: Notice | undefined
    if (!(await isVerified(item))) {
      unverified.add(item.id)
      notice = { reason: 'unverified', key: item.approvedRevisionId }
    } else {
      const due = parseStaleAfter(item.staleAfter)
      if (due !== undefined && due <= now && item.staleAfter) notice = { reason: 'stale', key: item.staleAfter }
    }
    if (notice && !sameNotice(item.healthNotice, notice)) notices.push({ item, notice })
  }
  knowledgeStore.setState({ unverified })
  if (!notices.length) return

  // Claim each notice in one commit (another window may have filed it since our read), then file entries.
  const claimed: typeof notices = []
  await commitKnowledge((d) => {
    for (const n of notices) {
      const draft = d.items.find((i) => i.id === n.item.id)
      if (!draft || draft.status !== 'approved' || sameNotice(draft.healthNotice, n.notice)) continue
      draft.healthNotice = n.notice
      claimed.push(n)
    }
  })
  for (const { item, notice } of claimed) {
    try {
      await addReviewEntry({
        kind: 're-check',
        scopeId: item.scopeId,
        text:
          notice.reason === 'unverified'
            ? t("Can't verify: {{text}}", { text: quote(item.text) })
            : t('Due for review: {{text}}', { text: quote(item.text) }),
        ...(notice.reason === 'unverified'
          ? { sub: t('It changed outside Dango, so answers leave it out until you approve it again.') }
          : {}),
        ref: { type: 'knowledge', id: item.id },
      })
    } catch (error) {
      log.error('Knowledge health entry failed:', error)
    }
  }
}

function sameNotice(a: Notice | undefined, b: Notice): boolean {
  return a?.reason === b.reason && a.key === b.key
}

export function _resetHealthCacheForTests(): void {
  hashCache.clear()
}
