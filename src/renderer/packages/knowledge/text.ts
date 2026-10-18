import type {
  KnowledgeEvent,
  KnowledgeItem,
  KnowledgeKind,
  KnowledgeRevision,
  KnowledgeSource,
  KnowledgeSourceInput,
} from '@shared/types/knowledge'

/** The key two texts share when they say the same thing: NFC, trimmed, single spaces, lower case, no end punctuation. */
export function knowledgeTextKey(text: string): string {
  return text
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/[.!?]+$/, '')
    .trimEnd()
}

const QUOTE_MAX = 60

/** Text for quoting in copy: cut to 60 characters, ending in `…` when cut. */
export function quote(text: string): string {
  const chars = Array.from(text)
  return chars.length <= QUOTE_MAX ? text : `${chars.slice(0, QUOTE_MAX - 1).join('')}…`
}

/** `sha256hex(kind + '\n' + text + '\n' + (condition ?? ''))`, the hash an approval is bound to (ADR 0014). */
export async function contentHash(kind: KnowledgeKind, text: string, condition?: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${kind}\n${text}\n${condition ?? ''}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/

/** Epoch ms for ISO 8601 with `Z` or `±hh:mm`; anything else is unknown (`undefined`). Callers keep the string. */
export function parseStaleAfter(v?: string): number | undefined {
  if (!v || !ISO_WITH_OFFSET.test(v)) return undefined
  const ms = Date.parse(v)
  return Number.isNaN(ms) ? undefined : ms
}

/** The highest `{prefix}{n}` number among ids, or 0. */
function highestNumber(ids: Iterable<string | undefined>, prefix: string): number {
  const re = new RegExp(`^${prefix}(\\d+)$`)
  let max = 0
  for (const id of ids) {
    const m = id ? re.exec(id) : null
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max
}

/**
 * Gives each input without an id the next `s{n}` after the highest number on the item (and among the
 * inputs' own ids), so ids are never reused. An input that has its own id keeps it.
 */
export function assignSourceIds(existing: KnowledgeSource[], inputs: KnowledgeSourceInput[]): KnowledgeSource[] {
  let next = highestNumber([...existing.map((s) => s.id), ...inputs.map((s) => s.id)], 's')
  return inputs.map((input) => {
    if (input.id) return { ...input, id: input.id }
    next += 1
    return { ...input, id: `s${next}` }
  })
}

export type RevisionFields = { text: string; condition?: string; by?: KnowledgeEvent['by'] }

/**
 * The item's next revision: id `r{n}` after the highest on the item, parent = the approved revision.
 * `condition` is taken from `fields` when the key is present, otherwise from the item.
 * With `approvedBy`, it carries an approval bound to the content hash; `by` defaults to `'user'`.
 */
export async function newRevision(
  item: Pick<KnowledgeItem, 'kind' | 'condition' | 'revisions' | 'approvedRevisionId'>,
  fields: RevisionFields,
  approvedBy?: 'user'
): Promise<KnowledgeRevision> {
  const now = Date.now()
  const condition = 'condition' in fields ? fields.condition : item.condition
  const nextRevisionNumber =
    highestNumber(
      item.revisions.map((r) => r.id),
      'r'
    ) + 1
  const revision: KnowledgeRevision = {
    id: `r${nextRevisionNumber}`,
    text: fields.text,
    ...(condition !== undefined ? { condition } : {}),
    ...(item.approvedRevisionId ? { parentId: item.approvedRevisionId } : {}),
    by: fields.by ?? 'user',
    createdAt: now,
  }
  if (approvedBy) {
    revision.approval = { by: approvedBy, at: now, contentHash: await contentHash(item.kind, fields.text, condition) }
  }
  return revision
}
