import {
  type Evidence,
  inboundMayReachCloud,
  inertValues,
  mayReachCloud,
  RETRIEVE_MAX_RECORDS,
  type SourceRecord,
} from '@shared/pm-pilot'
import type { KnowledgeItem } from '@shared/types/knowledge'
import dayjs from 'dayjs'
import i18n from '@/i18n'
import { ensureKnowledgeLoaded, knowledgeForTurn, NEVER_SEND_EMAIL } from './bridge'
import { pmStore } from './store'

/*
 * The evidence a client thread is judged against: the scope's records outside the thread, ranked by words shared with
 * the inbound message, then the scope's approved knowledge. Titles, names and mail text are external data; they are
 * only compared and copied into labels and evidence text, never interpreted.
 */

/** A local-only source's record would reach a cloud model (ADR 0003). The message carries no record text. */
export class LocalOnlyModelError extends Error {
  constructor() {
    super('This source stays on this device; choose a local model')
    this.name = 'LocalOnlyModelError'
  }
}

/** Characters of a record read for matching; keeps a huge mail from costing more than a normal one. */
const MATCH_CHARS = 20_000
const KNOWLEDGE_LABEL_CHARS = 40

// Words too common to say two messages are about the same thing (English; Vietnamese particles are short and kept).
const STOP_WORDS = new Set(
  (
    'the and for are was were you your our with that this have has had not but can will would could should from ' +
    'what when where which who how why any all its into about there their them they then than just also please ' +
    'thanks thank regards dear hi hello best let know get got been being re fwd'
  ).split(' ')
)

/** Lower case, accents dropped (đ → d), split on anything that is not a letter or digit. */
export function tokens(text: string): Set<string> {
  const folded = text.slice(0, MATCH_CHARS).normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase()
  const out = new Set<string>()
  for (const word of folded.split(/[^\p{L}\p{N}]+/u)) {
    if (word.length >= 2 && !STOP_WORDS.has(word)) out.add(word)
  }
  return out
}

export function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0
  for (const w of a) if (b.has(w)) n += 1
  return n
}

const dayMonth = (at: number) => dayjs(at).format('D MMM')

function firstName(record: SourceRecord): string {
  const name = record.authorName?.trim() || record.author.split('@')[0] || record.author
  return name.split(/\s+/)[0] ?? name
}

/** `your 12 Sep email`, `Jo's 12 Sep email` or `Asana "Homepage launch"` (external text passed as values). */
export function recordLabel(record: SourceRecord): string {
  if (record.sourceKind === 'asana') return i18n.t('Asana "{{title}}"', inertValues({ title: record.title }))
  const date = dayMonth(record.occurredAt)
  if (record.sentByMe) return i18n.t('your {{date}} email', { date })
  return i18n.t("{{name}}'s {{date}} email", inertValues({ name: firstName(record), date }))
}

/** `approved: {first 40 characters}`. */
export function knowledgeLabel(item: Pick<KnowledgeItem, 'text'>): string {
  return i18n.t('approved: {{text}}', inertValues({ text: item.text.trim().slice(0, KNOWLEDGE_LABEL_CHARS) }))
}

export function recordEvidence(record: SourceRecord): Evidence {
  const label = recordLabel(record)
  const kind = record.sourceKind === 'asana' ? 'task' : 'email'
  return {
    id: `r:${record.id}`,
    label,
    date: record.occurredAt,
    text: record.sourceKind === 'asana' ? `${record.title}\n${record.text}` : record.text,
    source: { kind, label, ref: record.link.url, ...(record.sourceId ? { sourceId: record.sourceId } : {}) },
  }
}

export function knowledgeEvidence(item: KnowledgeItem): Evidence {
  const label = knowledgeLabel(item)
  const text = item.condition ? `${item.text} (when ${item.condition})` : item.text
  const live = item.sources.filter((s) => !s.removed)
  const first = live[0]
  const sourceIds = [...new Set(live.flatMap((s) => (s.sourceId ? [s.sourceId] : [])))]
  return {
    id: `k:${item.id}`,
    label,
    date: item.updatedAt,
    text,
    source: {
      kind: first?.kind ?? 'user',
      label,
      ref: `k:${item.id}`,
      ...(first?.sourceId ? { sourceId: first.sourceId } : {}),
    },
    sourceIds,
  }
}

/**
 * Records of the scope outside the inbound thread that share words with it (best first, newest on a tie, at most
 * `RETRIEVE_MAX_RECORDS`), then every approved knowledge item for the scope except the built-in "Never send email".
 * On a cloud model, evidence `mayReachCloud` refuses is skipped, and an inbound record `inboundMayReachCloud` refuses
 * (local-only, or no source id) throws `LocalOnlyModelError`.
 */
export async function retrieveEvidence(input: {
  scopeId: string
  inbound: SourceRecord
  localOnlySourceIds: Set<string>
  cloudModel: boolean
}): Promise<Evidence[]> {
  const { scopeId, inbound, localOnlySourceIds, cloudModel } = input
  if (cloudModel && !inboundMayReachCloud(inbound, localOnlySourceIds)) throw new LocalOnlyModelError()
  const allowed = (e: Evidence) => !cloudModel || mayReachCloud(e, localOnlySourceIds)

  const wanted = tokens(`${inbound.title}\n${inbound.text}`)
  const records = await pmStore.getRecords(scopeId)
  const ranked = records
    .filter(
      (r) =>
        r.scopeId === scopeId &&
        !r.noise &&
        r.id !== inbound.id &&
        !(r.sourceKind === inbound.sourceKind && r.threadOrTaskId === inbound.threadOrTaskId)
    )
    .map((r) => ({ r, e: recordEvidence(r) }))
    .filter(({ e }) => allowed(e))
    .map(({ r, e }) => ({ r, e, score: overlap(wanted, tokens(`${r.title}\n${r.text}`)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.r.occurredAt - a.r.occurredAt)
    .slice(0, RETRIEVE_MAX_RECORDS)
    .map((x) => x.e)

  await ensureKnowledgeLoaded({ fresh: true })
  const knowledge = knowledgeForTurn(scopeId)
    .filter((item) => item.id !== NEVER_SEND_EMAIL.id)
    .map(knowledgeEvidence)
    .filter(allowed)

  return [...ranked, ...knowledge]
}
