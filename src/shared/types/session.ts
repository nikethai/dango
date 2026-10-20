import type { LanguageModelUsage } from 'ai'
import { z } from 'zod'
import { SessionSettingsSchema } from '../types/settings'
import { ModelProviderEnum } from './provider'

// Re-export for backward compatibility
export { ModelProviderEnum } from './provider'

// Token cache key schema
export const TokenCacheKeySchema = z.enum([
  'default',
  'deepseek',
  'default_reasoning',
  'deepseek_reasoning',
  'default_preview',
  'deepseek_preview',
])
export type TokenCacheKey = z.infer<typeof TokenCacheKeySchema>

// Export the enum values directly for easy access
export const TOKEN_CACHE_KEYS = TokenCacheKeySchema.enum

// Token count map schema - use passthrough to allow any string keys for backward compatibility
export const TokenCountMapSchema = z.record(z.string(), z.number())

export type TokenCountMap = z.infer<typeof TokenCountMapSchema>

// Token calculated at schema - timestamp for each tokenizer type
export const TokenCalculatedAtSchema = z
  .object({
    default: z.number().optional(),
    deepseek: z.number().optional(),
    default_reasoning: z.number().optional(),
    deepseek_reasoning: z.number().optional(),
    default_preview: z.number().optional(),
    deepseek_preview: z.number().optional(),
  })
  .optional()

export type TokenCalculatedAt = z.infer<typeof TokenCalculatedAtSchema>

// Search result schemas
export const SearchResultItemSchema = z.object({
  title: z.string(),
  link: z.string(),
  snippet: z.string(),
  rawContent: z.string().nullable().optional(),
})

export const SearchResultSchema = z.object({
  items: z.array(SearchResultItemSchema),
})

export interface SearchCitation {
  index: number
  url: string
  title: string
  snippet?: string
  favicon?: string
  source: 'builtin' | 'gemini-grounding' | 'openclaw' | 'mcp'
  accessedAt: number
  relevanceScore?: number
}

export const SearchCitationSchema: z.ZodType<SearchCitation> = z.object({
  index: z.number(),
  url: z.string(),
  title: z.string(),
  snippet: z.string().optional().catch(undefined),
  favicon: z.string().optional().catch(undefined),
  source: z.enum(['builtin', 'gemini-grounding', 'openclaw', 'mcp']),
  accessedAt: z.number(),
  relevanceScore: z.number().optional().catch(undefined),
})

export interface GroundingMetadata {
  webSearchQueries?: string[]
  retrievalQueries?: string[]
  searchEntryPoint?: {
    renderedContent?: string
  }
  groundingChunks?: Array<{
    web?: {
      uri: string
      title?: string
    }
  }>
  groundingSupports?: Array<{
    segment?: {
      startIndex?: number
      endIndex?: number
      text?: string
    }
    groundingChunkIndices?: number[]
    confidenceScores?: number[]
  }>
}

export const GroundingMetadataSchema: z.ZodType<GroundingMetadata> = z
  .object({
    webSearchQueries: z.array(z.string()).optional().catch(undefined),
    retrievalQueries: z.array(z.string()).optional().catch(undefined),
    searchEntryPoint: z
      .object({
        renderedContent: z.string().optional().catch(undefined),
      })
      .optional()
      .catch(undefined),
    groundingChunks: z
      .array(
        z.object({
          web: z
            .object({
              uri: z.string(),
              title: z.string().optional().catch(undefined),
            })
            .optional()
            .catch(undefined),
        })
      )
      .optional()
      .catch(undefined),
    groundingSupports: z
      .array(
        z.object({
          segment: z
            .object({
              startIndex: z.number().optional().catch(undefined),
              endIndex: z.number().optional().catch(undefined),
              text: z.string().optional().catch(undefined),
            })
            .optional()
            .catch(undefined),
          groundingChunkIndices: z.array(z.number()).optional().catch(undefined),
          confidenceScores: z.array(z.number()).optional().catch(undefined),
        })
      )
      .optional()
      .catch(undefined),
  })
  .passthrough()

// Message file schemas
export const MessageFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  fileType: z.string(),
  url: z.string().optional(),
  storageKey: z.string().optional(),
  chatboxAIFileUUID: z.string().optional(),
  tokenCountMap: TokenCountMapSchema.optional().catch(undefined),
  tokenCalculatedAt: TokenCalculatedAtSchema,
  lineCount: z.number().optional(),
  byteLength: z.number().optional(),
  /** document (default) vs video frame-sampling attachments */
  mediaKind: z.enum(['document', 'video']).optional(),
  durationSec: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  posterStorageKey: z.string().optional(),
  /** Auto-sampled frame picture storage keys for this attachment */
  sampledFrameKeys: z.array(z.string()).optional(),
  /** Timestamps (sec) aligned with sampledFrameKeys */
  sampledFrameTimestamps: z.array(z.number()).optional(),
})

export const MessageLinkSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  storageKey: z.string().optional(),
  chatboxAILinkUUID: z.string().optional(),
  tokenCountMap: TokenCountMapSchema.optional(),
  tokenCalculatedAt: TokenCalculatedAtSchema,
  lineCount: z.number().optional(),
  byteLength: z.number().optional(),
  /** OG / video thumbnail stored as blob key for UI preview */
  imageStorageKey: z.string().optional(),
})

export const MessagePictureSchema = z.object({
  url: z.string().optional(),
  storageKey: z.string().optional(),
  loading: z.boolean().optional(),
})

export const MessageRoleEnum = {
  System: 'system',
  User: 'user',
  Assistant: 'assistant',
  Tool: 'tool',
} as const

export type MessageRole = (typeof MessageRoleEnum)[keyof typeof MessageRoleEnum]

// Message content part schemas
export const MessageTextPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
})

export const MessageImagePartSchema = z.object({
  type: z.literal('image'),
  storageKey: z.string(),
  ocrResult: z.string().optional(),
})

export const MessageInfoPartSchema = z.object({
  type: z.literal('info'),
  text: z.string(),
  values: z.record(z.string(), z.unknown()).optional(),
})

export const MessageReasoningPartSchema = z.object({
  type: z.literal('reasoning'),
  text: z.string(),
  startTime: z.number().optional(),
  duration: z.number().optional(),
})

export const MessageToolCallPartSchema = z.object({
  type: z.literal('tool-call'),
  state: z.enum(['call', 'result', 'error']),
  toolCallId: z.string(),
  toolName: z.string(),
  args: z.unknown(),
  result: z.unknown().optional(),
})

export const MessagePlanPartSchema = z.object({
  type: z.literal('plan'),
  planText: z.string(),
  // Written: 'pending' | 'approved' | 'rejected' only, so builds before slice 6a (a three-value enum, no .catch) still
  // parse synced and imported sessions. 'revised' is read for safety only (an early 6a build wrote it); write a
  // revised plan as 'rejected' + `revised: true`, and read it through isRevisedPlan().
  status: z.enum(['pending', 'approved', 'rejected', 'revised']).default('pending'),
  revised: z.boolean().optional(), // with status 'rejected': superseded by a newer version after Request changes
  version: z.number().int().positive().optional(), // absent = 1
  startedAt: z.number().optional(), // set when the plan is approved and starts running
  finishedAt: z.number().optional(), // set when the run ends on its own; a stopped run has none
  runStartedAt: z.number().optional(), // start of the current run after Continue; absent = startedAt
  runMs: z.number().optional(), // time of earlier, stopped runs, so a resumed plan's timer skips the stopped time
})

// Plan phase for 2-phase agent execution
export const PlanPhaseEnum = z.enum(['planning', 'awaiting_approval', 'executing'])
export type PlanPhase = z.infer<typeof PlanPhaseEnum>

export const MessageContentPartSchema = z.discriminatedUnion('type', [
  MessageTextPartSchema,
  MessageImagePartSchema,
  MessageInfoPartSchema,
  MessageReasoningPartSchema,
  MessageToolCallPartSchema,
  MessagePlanPartSchema,
])

export const MessageContentPartsSchema = z.array(MessageContentPartSchema)

export const StreamTextResultSchema = z.object({
  text: z.string().optional(),
  contentParts: MessageContentPartsSchema,
  reasoningContent: z.string().optional(),
  usage: z.custom<LanguageModelUsage>().optional(),
  finishReason: z.string().optional(),
  citations: z.array(SearchCitationSchema).optional().catch(undefined),
  searchQuery: z.string().optional().catch(undefined),
  searchProvider: z.string().optional().catch(undefined),
  groundingMetadata: GroundingMetadataSchema.optional().catch(undefined),
})

// Tool and provider schemas
export const ToolUseScopeSchema = z.enum(['web-browsing', 'knowledge-base', 'read-file'])

export const ModelProviderSchema = z.union([z.nativeEnum(ModelProviderEnum), z.string()])

// Message status schemas
export const MessageStatusSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('sending_file'),
    mode: z.enum(['local', 'advanced']).optional(),
  }),
  z.object({
    type: z.literal('loading_webpage'),
    mode: z.enum(['local', 'advanced']).optional(),
  }),
  z.object({
    type: z.literal('retrying'),
    attempt: z.number(),
    maxAttempts: z.number(),
    error: z.string().optional(),
  }),
])

// Main Message schema
// Define a custom function type for cancel
const CancelFunctionSchema = z.custom<(() => void) | undefined>(
  (val) => val === undefined || typeof val === 'function',
  { message: 'Must be a function or undefined' }
)

const MessageUsageSchema = z.object({
  inputTokens: z.number().optional().catch(undefined),
  /**
  The number of output (completion) tokens used.
     */
  outputTokens: z.number().optional().catch(undefined),
  /**
  The total number of tokens as reported by the provider.
  This number might be different from the sum of `inputTokens` and `outputTokens`
  and e.g. include reasoning tokens or other overhead.
     */
  totalTokens: z.number().optional().catch(undefined),
  /**
  The number of reasoning tokens used.
     */
  reasoningTokens: z.number().optional().catch(undefined),
  /**
  The number of cached input tokens.
     */
  cachedInputTokens: z.number().optional().catch(undefined),
})

export const MessageFeedbackSchema = z.object({
  rating: z.enum(['up', 'down']),
  text: z.string().optional(),
  timestamp: z.number(),
})

export const MessageArtifactTypeSchema = z.enum(['html', 'mermaid', 'markdown', 'svg', 'code'])

export const MessageArtifactSchema = z.object({
  id: z.string(),
  /**
   * html/svg = sandboxed preview; markdown/mermaid = rendered preview; code = highlighted source.
   * Unknown legacy values fall back so old html/mermaid sessions still load.
   */
  type: z.union([MessageArtifactTypeSchema, z.string()]).catch('html'),
  title: z.string().optional(),
  language: z.string().optional(),
  content: z.string(),
  version: z.number().optional(),
  previousVersionId: z.string().optional(),
  timestamp: z.number(),
})

export const MemoryAttachmentSchema = z.object({
  id: z.string(),
  content: z.string(),
  tags: z.array(z.string()).default([]),
})

/** Composer/history quote of another message (full or selection). */
export const MessageQuoteAttachmentSchema = z.object({
  sourceMessageId: z.string().optional(),
  sourceRole: z.enum(['system', 'user', 'assistant', 'tool']).optional(),
  text: z.string(),
  isPartial: z.boolean().default(false),
  createdAt: z.number().optional(),
})

export const MessageSchema = z.object({
  id: z.string(),
  role: z.nativeEnum(MessageRoleEnum),
  name: z.string().optional(),
  cancel: CancelFunctionSchema.optional(),
  generating: z.boolean().optional(),
  aiProvider: z.union([ModelProviderSchema, z.string()]).optional(),
  model: z.string().optional(),
  style: z.string().optional(),
  files: z.array(MessageFileSchema).optional(),
  links: z.array(MessageLinkSchema).optional(),
  reasoningContent: z.string().optional().describe('deprecated, moved to contentParts'),
  contentParts: MessageContentPartsSchema,
  isStreamingMode: z.boolean().optional(),
  errorCode: z.number().optional(),
  error: z.string().optional(),
  errorExtra: z.record(z.string(), z.unknown()).optional(),
  status: z.array(MessageStatusSchema).optional(),
  wordCount: z.number().optional(),
  tokenCount: z.number().optional(), // output token count
  tokensUsed: z.number().optional(), // deprecated, use `usage` instead
  usage: MessageUsageSchema.optional().catch(undefined),
  timestamp: z.number().optional(),
  firstTokenLatency: z.number().optional(),
  /** How long the answer took, from the run's start to the finished answer (ms). Errors carry none. */
  durationMs: z.number().optional().catch(undefined),
  /** ER4 "Answer without tools": this user message's turn runs with no tools (set before sending, never mid-turn). */
  toolsOff: z.boolean().optional().catch(undefined),
  tokenSpeed: z.number().optional(), // final tokens/sec after streaming completes
  finishReason: z.string().optional(),
  citations: z.array(SearchCitationSchema).optional().catch(undefined),
  searchQuery: z.string().optional().catch(undefined),
  searchProvider: z.string().optional().catch(undefined),
  groundingMetadata: GroundingMetadataSchema.optional().catch(undefined),
  /**
   * Follow-up suggestion chips generated for this assistant message.
   * `undefined` — not attempted yet (a model call is still needed).
   * `[]` — attempted but no usable suggestions (persisted so it is never retried on reload).
   */
  followUpSuggestions: z.array(z.string()).optional().catch(undefined),
  tokenCountMap: TokenCountMapSchema.optional(), // estimate token count as input
  tokenCalculatedAt: TokenCalculatedAtSchema,
  updatedAt: z.number().optional(),
  isSummary: z.boolean().optional(), // Marks message as a compaction summary
  feedback: MessageFeedbackSchema.optional().catch(undefined),
  artifacts: z.array(MessageArtifactSchema).optional().catch(undefined),
  /** Memories explicitly attached to this user turn from the composer. */
  memoryAttachments: z.array(MemoryAttachmentSchema).optional().catch(undefined),
  /**
   * Slice 10: the PM pilot question whose Needs you chat (CH6) this assistant message opens. It quotes client mail, so a
   * cloud chat turn sends a placeholder in its place while that question's source stays on this device (ADR 0003).
   */
  pmQuestionId: z.string().optional().catch(undefined),
  /** Quoted message (full or selection) attached to this user turn. */
  quoteAttachment: MessageQuoteAttachmentSchema.optional().catch(undefined),
  /** Explicit skill package ids selected via $ tags / chips on this user message */
  skillIds: z.array(z.string()).optional().catch(undefined),
  /** Skills that were actually activated for this turn (assistant message) */
  skillActivations: z
    .array(
      z.object({
        skillId: z.string(),
        name: z.string(),
        mode: z.enum(['explicit', 'session', 'auto']),
      })
    )
    .optional()
    .catch(undefined),
  /** Explicit command package ids selected via / tags / chips on this user message */
  commandIds: z.array(z.string()).optional().catch(undefined),
  /** Commands activated for this turn (assistant message) */
  commandActivations: z
    .array(
      z.object({
        commandId: z.string(),
        name: z.string(),
        mode: z.literal('explicit'),
      })
    )
    .optional()
    .catch(undefined),
  /** Agent persona id that produced this assistant message (multi-agent room speaker) */
  agentId: z.string().optional().catch(undefined),
  /** Agent persona ids @-mentioned on this user message */
  mentionedAgentIds: z.array(z.string()).optional().catch(undefined),
  /** Connected-account ids selected via # chips on this user message (labels only in context). */
  credentialIds: z.array(z.string()).optional().catch(undefined),
  /**
   * Multi-agent room turn kind.
   * - turn: short discussion message
   * - synthesis: on-demand Team answer
   * - plan / do / review / deliver: Work mode phases
   */
  roomRole: z.enum(['turn', 'synthesis', 'plan', 'do', 'review', 'deliver']).optional().catch(undefined),
  /** 1-based discussion round for roomRole turn */
  roomRound: z.number().int().positive().optional().catch(undefined),
  /** Approved knowledge item ids this answer was given with (the built-in item excluded). */
  knowledgeIds: z.array(z.string()).optional().catch(undefined),
  /** Swarm run this turn belongs to (plan, do, deliver and run notes share one runId). `note`: the could-not-plan note. */
  swarm: z
    .object({
      runId: z.string(),
      taskTitle: z.string().optional(),
      stoppedEarly: z.boolean().optional(),
      note: z.boolean().optional(),
    })
    .optional()
    .catch(undefined),
})

// Compaction point schema (for context management)
export const CompactionPointSchema = z.object({
  summaryMessageId: z.string(),
  boundaryMessageId: z.string(),
  createdAt: z.number(),
})

// Session schemas
export const SessionTypeSchema = z.enum(['chat', 'picture'])

export const MessageForkListSchema = z.object({
  id: z.string(),
  messages: z.array(MessageSchema),
})

export const MessageForkSchema = z.object({
  position: z.number(),
  lists: z.array(MessageForkListSchema),
  createdAt: z.number(),
})

export const SessionThreadSchema = z.object({
  id: z.string(),
  name: z.string(),
  messages: z.array(MessageSchema),
  createdAt: z.number(),
  compactionPoints: z.array(CompactionPointSchema).optional(),
})

export const FolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  emoji: z.string().optional(),
  /** @deprecated Prefer defaultAgentId; kept for migration dual-read */
  defaultCopilotId: z.string().optional(),
  /** Default agent persona for sessions created in this folder */
  defaultAgentId: z.string().optional(),
  order: z.number(),
})

/** Portable Project metadata. Same fields as Folder; contains no filesystem root. */
export const ProjectSchema = FolderSchema
export type Project = z.infer<typeof ProjectSchema>

export const SessionSchema = z.object({
  id: z.string(),
  type: SessionTypeSchema.optional(),
  name: z.string(),
  picUrl: z.string().optional(),
  messages: z.array(MessageSchema),
  starred: z.boolean().optional(),
  hidden: z.boolean().optional(), // Hidden from session list (e.g., migrated picture sessions)
  /** @deprecated Prefer agentIds; dual-written as agentIds[0] for one release */
  copilotId: z.string().optional(),
  /** Room members: agent persona ids in this session (Slack-style multi-agent) */
  agentIds: z.array(z.string()).optional().catch(undefined),
  /** Team room mode: discuss (default), work pipeline, or swarm task board */
  roomMode: z.enum(['discuss', 'work', 'swarm']).optional().catch(undefined),
  /** Preferred lead agent for Team answer / Work execute (defaults to first speaker) */
  roomLeadId: z.string().optional().catch(undefined),
  folderId: z.string().optional(),
  /** Canonical Project assignment. Dual-written with folderId for one compatibility release. */
  projectId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  archived: z.boolean().optional(),
  assistantAvatarKey: z.string().optional(),
  agentMode: z.boolean().optional(),
  /**
   * Legacy reconnect hint only. Never authority. Tombstoned on move/unbind/reconnect.
   * @deprecated Native picker binding is the only authorization path.
   */
  workspaceRoot: z.string().optional(),
  /** Arm Dango isolated browser tools for this chat (desktop). */
  browserArmed: z.boolean().optional().catch(undefined),
  /** Arm computer use (observe/act) for this chat (desktop). */
  computerArmed: z.boolean().optional().catch(undefined),
  planMode: z.boolean().optional(),
  planPhase: PlanPhaseEnum.optional(),
  settings: SessionSettingsSchema.optional(),
  threads: z.array(SessionThreadSchema).optional(),
  threadName: z.string().optional(),
  messageForksHash: z.record(z.string(), MessageForkSchema).optional(),
  compactionPoints: z.array(CompactionPointSchema).optional(),
  /** Session-pinned skill package ids (always activated when enabled) */
  pinnedSkillIds: z.array(z.string()).optional().catch(undefined),
  /** When true/undefined, host may auto-select skills for a turn */
  autoSkills: z.boolean().optional().catch(undefined),
  /**
   * Session-sticky connected accounts for this chat.
   * Combined with message.credentialIds (message wins for that turn).
   * Never stores secrets — ids only.
   */
  credentialIds: z.array(z.string()).optional().catch(undefined),
  continuationLineage: z
    .object({
      importedSourceId: z.string(),
      importedConversationId: z.string(),
      selectedMessageIds: z.array(z.string()),
      targetProvider: z.string().optional(),
      targetModelId: z.string().optional(),
      createdAt: z.number(),
      omittedCount: z.number(),
      omittedReasons: z.array(z.string()),
      sourceMissing: z.boolean().optional(),
      firstHandoffPending: z.boolean().optional(),
      pendingExcerpts: z
        .array(
          z.object({
            conversationTitle: z.string(),
            messageId: z.string(),
            role: z.string(),
            text: z.string(),
          })
        )
        .optional(),
    })
    .optional()
    .catch(undefined),
})

export const SessionMetaSchema = SessionSchema.pick({
  id: true,
  name: true,
  starred: true,
  hidden: true,
  folderId: true,
  projectId: true,
  tags: true,
  archived: true,
  assistantAvatarKey: true,
  picUrl: true,
  type: true,
}).extend({
  /** Last activity time for rail Recents / day groups (from latest message timestamp). */
  updatedAt: z.number().optional(),
})

export const SessionThreadBriefSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number().optional(),
  createdAtLabel: z.string().optional(),
  firstMessageId: z.string(),
  messageCount: z.number(),
})

// Export types inferred from schemas
export type SearchResultItem = z.infer<typeof SearchResultItemSchema>
export type SearchResult = z.infer<typeof SearchResultSchema>
export type MessageFile = z.infer<typeof MessageFileSchema>
export type MessageLink = z.infer<typeof MessageLinkSchema>
export type MessagePicture = z.infer<typeof MessagePictureSchema>
export type MessageTextPart = z.infer<typeof MessageTextPartSchema>
export type MessageImagePart = z.infer<typeof MessageImagePartSchema>
export type MessageInfoPart = z.infer<typeof MessageInfoPartSchema>
export type MessageReasoningPart = z.infer<typeof MessageReasoningPartSchema>
export type MessageToolCallPart<Args = unknown, Result = unknown> = z.infer<typeof MessageToolCallPartSchema> & {
  args: Args
  result?: Result
}
export type MessageContentParts = z.infer<typeof MessageContentPartsSchema>
export type StreamTextResult = z.infer<typeof StreamTextResultSchema>
export type ToolUseScope = z.infer<typeof ToolUseScopeSchema>
export type ModelProvider = z.infer<typeof ModelProviderSchema>
export type MessageStatus = z.infer<typeof MessageStatusSchema>
export type MessageFeedback = z.infer<typeof MessageFeedbackSchema>
export type MessageArtifact = z.infer<typeof MessageArtifactSchema>
export type MemoryAttachment = z.infer<typeof MemoryAttachmentSchema>
export type MessageQuoteAttachment = z.infer<typeof MessageQuoteAttachmentSchema>
export type Message = z.infer<typeof MessageSchema>
export type SessionType = z.infer<typeof SessionTypeSchema>
export type CompactionPoint = z.infer<typeof CompactionPointSchema>
export type Folder = z.infer<typeof FolderSchema>
export type Session = z.infer<typeof SessionSchema>
export type SessionMeta = z.infer<typeof SessionMetaSchema>
export type SessionThread = z.infer<typeof SessionThreadSchema>
export type SessionThreadBrief = z.infer<typeof SessionThreadBriefSchema>
export type MessagePlanPart = z.infer<typeof MessagePlanPartSchema>
