import { z } from 'zod'
import type { KnowledgeSource } from './knowledge'

export const SOURCE_KINDS = ['folder', 'gmail', 'asana', 'codex-threads', 'documents'] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

export const ConnectedSourceSchema = z.object({
  id: z.string(),
  kind: z.enum(SOURCE_KINDS),
  scopeId: z.string(),
  label: z.string(),
  backgroundReview: z.boolean().default(false),
  localOnly: z.boolean().default(false),
  config: z.record(z.string(), z.unknown()).default({}),
  connectedAt: z.number(),
  lastSyncAt: z.number().optional(),
  lastReviewAt: z.number().optional(),
  /**
   * When the user removed the source (S11). Set during the 5 s undo window and kept if the app quits meanwhile, so the
   * next launch finishes the removal. A pending source is hidden from lists and no job of it runs.
   */
  removalPendingAt: z.number().optional(),
})
export type ConnectedSource = z.infer<typeof ConnectedSourceSchema>

/** Parses stored sources, dropping invalid rows one by one. */
export function parseSources(raw: unknown): ConnectedSource[] {
  if (!Array.isArray(raw)) return []
  const sources: ConnectedSource[] = []
  for (const row of raw) {
    const parsed = ConnectedSourceSchema.safeParse(row)
    if (parsed.success) sources.push(parsed.data)
  }
  return sources
}

// ref: folder = display path, documents = collection name, gmail/asana = account address or name.
export type SourceDraft = {
  kind: SourceKind
  label: string
  ref?: string
  config: Record<string, unknown>
  draftBindingId?: string
  createdAccountId?: string
}

export type SourceItem = { ref: string; label: string; text: string; updatedAt?: number }

export const KNOWLEDGE_SOURCE_KIND: Record<SourceKind, KnowledgeSource['kind']> = {
  folder: 'file',
  gmail: 'email',
  asana: 'task',
  'codex-threads': 'chat',
  documents: 'file',
}

export type CodexThreadsDetection = { found: boolean; threadCount: number; displayPath: string }
export type CodexThreadSummary = { id: string; title: string; updatedAt: number }
export type CodexThread = CodexThreadSummary & { text: string; truncated: boolean }
