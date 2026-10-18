import { z } from 'zod'

// Roadmap "Shared types", slice 4 (OKF-ready per ADR 0014), plus the fields slice 4 adds.

export type KnowledgeKind = 'fact' | 'decision' | 'preference'
// id: stable within its item (s1, s2…, never reused); the OKF source id. sourceId: the connected source it came from.
export type KnowledgeSource = {
  id: string
  kind: 'file' | 'commit' | 'chat' | 'email' | 'task' | 'url' | 'user'
  label: string
  ref?: string
  removed?: boolean
  sourceId?: string
}
// What other slices pass; the store assigns ids.
export type KnowledgeSourceInput = Omit<KnowledgeSource, 'id'> & { id?: string }
export type KnowledgeEvent = {
  at: number
  by: 'user' | 'background-review' | 'chat' | 'migration'
  action: 'proposed' | 'approved' | 'edited' | 'superseded' | 'removed' | 'moved' | 'kept-both'
  note?: string
}
export type KnowledgeRevision = {
  id: string
  text: string
  condition?: string
  parentId?: string
  by: KnowledgeEvent['by']
  createdAt: number
  approval?: { by: 'user'; at: number; contentHash: string }
}
export type KnowledgeItem = {
  id: string
  scopeId: string
  kind: KnowledgeKind
  text: string
  sources: KnowledgeSource[]
  status: 'approved' | 'superseded' | 'removed'
  supersededBy?: string
  condition?: string
  history: KnowledgeEvent[]
  revisions: KnowledgeRevision[]
  approvedRevisionId: string
  staleAfter?: string
  createdAt: number
  updatedAt: number
  /** Everywhere items this scope item wins over. */
  overrides?: string[]
  /** The last health notice filed, so each `staleAfter` value or revision id is filed once. */
  healthNotice?: { reason: 'stale' | 'unverified'; key: string }
  /** The proposal this item was approved from. */
  proposalId?: string
}
export type KnowledgeProposal = {
  id: string
  scopeId: string
  kind: KnowledgeKind
  text: string
  sources: KnowledgeSourceInput[]
  origin: 'chat' | 'background-review' | 'user'
  conflictsWith?: string[]
  createdAt: number
  sessionId?: string
  messageId?: string
  deferred?: boolean
  overrides?: string[]
  checkedAt?: number
}

export type KnowledgeConflict = {
  id: string
  scopeId: string
  proposalId: string
  itemIds: string[]
  state: 'open' | 'resolved' | 'dismissed'
  createdAt: number
  resolvedAt?: number
}
export type KnowledgeUseRef = { type: 'chat' | 'draft' | 'change'; id: string; label: string }
export type KnowledgeUse = { itemId: string; scopeId: string; ref: KnowledgeUseRef; at: number }
export type DontSuggestEntry = { id: string; scopeId: string; text: string; textKey: string; addedAt: number }
export type KnowledgeDismissal = { textKey: string; scopeId: string; at: number }
export type KnowledgeState = {
  version: 1
  items: KnowledgeItem[]
  proposals: KnowledgeProposal[]
  conflicts: KnowledgeConflict[]
  uses: KnowledgeUse[]
  dontSuggest: DontSuggestEntry[]
  dismissals: KnowledgeDismissal[]
}

// Loose objects: a window running an older build keeps fields added later when it rewrites a record.
const KindSchema = z.enum(['fact', 'decision', 'preference'])
const BySchema = z.enum(['user', 'background-review', 'chat', 'migration'])
const SourceKindSchema = z.enum(['file', 'commit', 'chat', 'email', 'task', 'url', 'user'])

const SourceInputShape = {
  kind: SourceKindSchema,
  label: z.string(),
  ref: z.string().optional(),
  removed: z.boolean().optional(),
  sourceId: z.string().optional(),
}

export const KnowledgeSourceSchema: z.ZodType<KnowledgeSource> = z.looseObject({ id: z.string(), ...SourceInputShape })
export const KnowledgeSourceInputSchema: z.ZodType<KnowledgeSourceInput> = z.looseObject({
  id: z.string().optional(),
  ...SourceInputShape,
})

const EventSchema: z.ZodType<KnowledgeEvent> = z.looseObject({
  at: z.number(),
  by: BySchema,
  action: z.enum(['proposed', 'approved', 'edited', 'superseded', 'removed', 'moved', 'kept-both']),
  note: z.string().optional(),
})

const RevisionSchema: z.ZodType<KnowledgeRevision> = z.looseObject({
  id: z.string(),
  text: z.string(),
  condition: z.string().optional(),
  parentId: z.string().optional(),
  by: BySchema,
  createdAt: z.number(),
  approval: z.looseObject({ by: z.literal('user'), at: z.number(), contentHash: z.string() }).optional(),
})

export const KnowledgeItemSchema: z.ZodType<KnowledgeItem> = z.looseObject({
  id: z.string(),
  scopeId: z.string(),
  kind: KindSchema,
  text: z.string(),
  sources: z.array(KnowledgeSourceSchema),
  status: z.enum(['approved', 'superseded', 'removed']),
  supersededBy: z.string().optional(),
  condition: z.string().optional(),
  history: z.array(EventSchema),
  revisions: z.array(RevisionSchema),
  approvedRevisionId: z.string(),
  staleAfter: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  overrides: z.array(z.string()).optional(),
  healthNotice: z.looseObject({ reason: z.enum(['stale', 'unverified']), key: z.string() }).optional(),
  proposalId: z.string().optional(),
})

export const KnowledgeProposalSchema: z.ZodType<KnowledgeProposal> = z.looseObject({
  id: z.string(),
  scopeId: z.string(),
  kind: KindSchema,
  text: z.string(),
  sources: z.array(KnowledgeSourceInputSchema),
  origin: z.enum(['chat', 'background-review', 'user']),
  conflictsWith: z.array(z.string()).optional(),
  createdAt: z.number(),
  sessionId: z.string().optional(),
  messageId: z.string().optional(),
  deferred: z.boolean().optional(),
  overrides: z.array(z.string()).optional(),
  checkedAt: z.number().optional(),
})

export const KnowledgeConflictSchema: z.ZodType<KnowledgeConflict> = z.looseObject({
  id: z.string(),
  scopeId: z.string(),
  proposalId: z.string(),
  itemIds: z.array(z.string()),
  state: z.enum(['open', 'resolved', 'dismissed']),
  createdAt: z.number(),
  resolvedAt: z.number().optional(),
})

export const KnowledgeUseSchema: z.ZodType<KnowledgeUse> = z.looseObject({
  itemId: z.string(),
  scopeId: z.string(),
  ref: z.looseObject({ type: z.enum(['chat', 'draft', 'change']), id: z.string(), label: z.string() }),
  at: z.number(),
})

export const DontSuggestEntrySchema: z.ZodType<DontSuggestEntry> = z.looseObject({
  id: z.string(),
  scopeId: z.string(),
  text: z.string(),
  textKey: z.string(),
  addedAt: z.number(),
})

export const KnowledgeDismissalSchema: z.ZodType<KnowledgeDismissal> = z.looseObject({
  textKey: z.string(),
  scopeId: z.string(),
  at: z.number(),
})

/** An array that is `[]` when missing or malformed, and drops bad records one at a time. */
function recordsOf<T>(schema: z.ZodType<T>) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((rows) =>
      rows.flatMap((row) => {
        const parsed = schema.safeParse(row)
        return parsed.success ? [parsed.data] : []
      })
    )
}

export const KnowledgeStateSchema = z
  .object({
    version: z.literal(1).catch(1),
    items: recordsOf(KnowledgeItemSchema),
    proposals: recordsOf(KnowledgeProposalSchema),
    conflicts: recordsOf(KnowledgeConflictSchema),
    uses: recordsOf(KnowledgeUseSchema),
    dontSuggest: recordsOf(DontSuggestEntrySchema),
    dismissals: recordsOf(KnowledgeDismissalSchema),
  })
  .catch(() => emptyKnowledgeState())

export function emptyKnowledgeState(): KnowledgeState {
  return { version: 1, items: [], proposals: [], conflicts: [], uses: [], dontSuggest: [], dismissals: [] }
}
