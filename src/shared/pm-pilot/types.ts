import { type KnowledgeSourceInput, KnowledgeSourceInputSchema } from '@shared/types/knowledge'
import { z } from 'zod'

// Slice 10 (PM pilot): Gmail and Asana as sources of client scopes. Pure types and constants.

export const GMAIL_BACKFILL_DAYS = 90
export const GMAIL_POLL_MS = 60_000
export const ASANA_POLL_MS = 120_000
/** Pinned by the roadmap's Decisions; tune in use. */
export const HIGH_CONFIDENCE = 0.85
/** Pinned by the roadmap's Decisions; tune in use. */
export const MEDIUM_CONFIDENCE = 0.6
/** Drafts a day that may arrive as safe; resets at local midnight. Pinned by the roadmap's Decisions. */
export const DAILY_DRAFT_CAP = 20
export const PIPELINE_MAX_THREADS_PER_TICK = 10
export const RETRIEVE_MAX_RECORDS = 12
export const DRAFT_LABEL = 'Dango/Draft ready'
export const PUBLIC_MAIL_DOMAINS = [
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'yahoo.com',
  'icloud.com',
]

export type PmSourceKind = 'gmail' | 'asana'
export const PmSourceKindSchema = z.enum(['gmail', 'asana'])

export type SourceRecord = {
  /** `{sourceKind}:{externalId}`, see `recordId`. */
  id: string
  sourceKind: PmSourceKind
  sourceId: string | null
  accountId: string
  /** Gmail message id or Asana task gid. */
  externalId: string
  threadOrTaskId: string
  scopeId: string | null
  /** Gmail: the From address, lower-cased. Asana: the author's name. */
  author: string
  /** Gmail: the From display name, when the header has one (evidence labels use its first name). */
  authorName?: string
  participants: string[]
  occurredAt: number
  title: string
  text: string
  status?: string
  sentByMe: boolean
  noise: boolean
  /** Gmail `Message-ID` header, for `In-Reply-To` on drafts. */
  rfcMessageId?: string
  link: { label: string; url: string }
}
export const SourceRecordSchema: z.ZodType<SourceRecord> = z.looseObject({
  id: z.string(),
  sourceKind: PmSourceKindSchema,
  sourceId: z.string().nullable(),
  accountId: z.string(),
  externalId: z.string(),
  threadOrTaskId: z.string(),
  scopeId: z.string().nullable(),
  author: z.string(),
  authorName: z.string().optional(),
  participants: z.array(z.string()),
  occurredAt: z.number(),
  title: z.string(),
  text: z.string(),
  status: z.string().optional(),
  sentByMe: z.boolean(),
  noise: z.boolean(),
  rfcMessageId: z.string().optional(),
  link: z.looseObject({ label: z.string(), url: z.string() }),
})

export function recordId(kind: PmSourceKind, externalId: string): string {
  return `${kind}:${externalId}`
}

/** `matchers` are domains (`@acme.com`) or addresses (`jo@acme.com`). */
export type GmailSourceConfig = { accountId: string; matchers: string[] }
export const GmailSourceConfigSchema: z.ZodType<GmailSourceConfig> = z.looseObject({
  accountId: z.string(),
  matchers: z.array(z.string()),
})

export type AsanaSourceConfig = { accountId: string; projectGid: string }
export const AsanaSourceConfigSchema: z.ZodType<AsanaSourceConfig> = z.looseObject({
  accountId: z.string(),
  projectGid: z.string(),
})

export type SyncCursor = {
  accountId: string
  sourceKind: PmSourceKind
  scope: string
  value: string
  updatedAt: number
  /** Gmail: the mailbox's own address from `users/me/profile`, cached so polls need not ask again (preflight R12). */
  ownAddress?: string
}
export const SyncCursorSchema: z.ZodType<SyncCursor> = z.looseObject({
  accountId: z.string(),
  sourceKind: PmSourceKindSchema,
  scope: z.string(),
  value: z.string(),
  updatedAt: z.number(),
  ownAddress: z.string().optional(),
})

export type Tier = 'high' | 'medium' | 'low'
export const TierSchema = z.enum(['high', 'medium', 'low'])

/** `id` is `r:{recordId}` or `k:{knowledgeId}`. */
export type Evidence = { id: string; label: string; date: number; text: string; source: KnowledgeSourceInput }
export const EvidenceSchema: z.ZodType<Evidence> = z.looseObject({
  id: z.string(),
  label: z.string(),
  date: z.number(),
  text: z.string(),
  source: KnowledgeSourceInputSchema,
})

export type ClientDraftState = 'proposed' | 'written' | 'undone' | 'sent' | 'dismissed'
export type ClientDraft = {
  id: string
  scopeId: string
  accountId: string
  threadId: string
  inboundMessageId: string
  to: string
  subject: string
  inReplyTo?: string
  text: string
  answer: string
  evidence: Evidence[]
  gmailDraftId?: string
  gmailMessageId?: string
  state: ClientDraftState
  reviewEntryId?: string
  createdAt: number
}
export const ClientDraftSchema: z.ZodType<ClientDraft> = z.looseObject({
  id: z.string(),
  scopeId: z.string(),
  accountId: z.string(),
  threadId: z.string(),
  inboundMessageId: z.string(),
  to: z.string(),
  subject: z.string(),
  inReplyTo: z.string().optional(),
  text: z.string(),
  answer: z.string(),
  evidence: z.array(EvidenceSchema),
  gmailDraftId: z.string().optional(),
  gmailMessageId: z.string().optional(),
  state: z.enum(['proposed', 'written', 'undone', 'sent', 'dismissed']),
  reviewEntryId: z.string().optional(),
  createdAt: z.number(),
})

/** `'choose-model'`: a local-only source, or no usable model (preflight R9). */
export type ClientQuestionKind = 'which-client' | 'which-answer' | 'which-project' | 'choose-model'
export type ClientQuestionCandidate = {
  value: string
  date?: number
  sourceLabel: string
  scopeId?: string
  evidenceIds?: string[]
}
export type ClientQuestion = {
  id: string
  kind: ClientQuestionKind
  sourceId?: string
  scopeId: string | null
  accountId: string
  threadId: string
  subject: string
  from: string
  summary: string
  candidates: ClientQuestionCandidate[]
  domain?: string
  sessionId?: string
  reviewEntryId?: string
  state: 'open' | 'answered'
  createdAt: number
}
export const ClientQuestionSchema: z.ZodType<ClientQuestion> = z.looseObject({
  id: z.string(),
  kind: z.enum(['which-client', 'which-answer', 'which-project', 'choose-model']),
  sourceId: z.string().optional(),
  scopeId: z.string().nullable(),
  accountId: z.string(),
  threadId: z.string(),
  subject: z.string(),
  from: z.string(),
  summary: z.string(),
  candidates: z.array(
    z.looseObject({
      value: z.string(),
      date: z.number().optional(),
      sourceLabel: z.string(),
      scopeId: z.string().optional(),
      evidenceIds: z.array(z.string()).optional(),
    })
  ),
  domain: z.string().optional(),
  sessionId: z.string().optional(),
  reviewEntryId: z.string().optional(),
  state: z.enum(['open', 'answered']),
  createdAt: z.number(),
})
