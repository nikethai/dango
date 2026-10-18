import { z } from 'zod'

export type ReviewKind = 'proposal' | 'done' | 'needs-you' | 'conflict' | 'change' | 're-check'
export type ReviewRefType =
  | 'proposal'
  | 'conflict'
  | 'change'
  | 'job'
  | 'draft'
  | 'question'
  | 'setup'
  | 'chat'
  | 'knowledge'
export type ReviewRef = { type: ReviewRefType; id: string }
export type ReviewState = 'open' | 'done' | 'dismissed'
export type ReviewOption = { id: string; text: string; source?: string }
export type ReviewEntry = {
  id: string
  kind: ReviewKind
  scopeId: string
  source?: string
  text: string
  sub?: string
  ref: ReviewRef
  state: ReviewState
  createdAt: number
  undoUntil?: number
  risk?: 'safe' | 'risky'
  actionLabel?: string
  options?: ReviewOption[]
  resolvedAt?: number
  /** The chat the entry came from (Change entries from a finished plan); its opener navigates there. */
  chatId?: string
}
export type ReviewEntryInput = Omit<ReviewEntry, 'id' | 'state' | 'createdAt'> &
  Partial<Pick<ReviewEntry, 'id' | 'state' | 'createdAt'>>

// Loose objects: a window running an older build keeps fields added by later slices when it rewrites a row.
export const ReviewEntrySchema: z.ZodType<ReviewEntry> = z.looseObject({
  id: z.string(),
  kind: z.enum(['proposal', 'done', 'needs-you', 'conflict', 'change', 're-check']),
  scopeId: z.string(),
  source: z.string().optional(),
  text: z.string(),
  sub: z.string().optional(),
  ref: z.looseObject({
    type: z.enum(['proposal', 'conflict', 'change', 'job', 'draft', 'question', 'setup', 'chat', 'knowledge']),
    id: z.string(),
  }),
  state: z.enum(['open', 'done', 'dismissed']),
  createdAt: z.number(),
  undoUntil: z.number().optional(),
  risk: z.enum(['safe', 'risky']).optional(),
  actionLabel: z.string().optional(),
  options: z.array(z.looseObject({ id: z.string(), text: z.string(), source: z.string().optional() })).optional(),
  resolvedAt: z.number().optional(),
  chatId: z.string().optional(),
})

export const WAITING_KINDS: readonly ReviewKind[] = ['needs-you', 'proposal', 'conflict']
export const REVIEW_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
