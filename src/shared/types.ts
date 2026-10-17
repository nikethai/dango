import { v4 as uuidv4 } from 'uuid'
import {
  type CompactionPoint,
  type Message,
  type MessageRole,
  MessageRoleEnum,
  type Session,
  type SessionThread,
  type TokenCountMap,
} from './types/session'
import type { DocumentParserConfig, DocumentParserType } from './types/settings'

export type Updater<T extends object> = Partial<T> | UpdaterFn<T>
export type UpdaterFn<T extends object> = (data: T | null | undefined) => T

export type MessageTokenCountResult = { id: string; tokenCountMap: TokenCountMap; reused: boolean }

export type SettingWindowTab = 'ai' | 'display' | 'chat' | 'advanced' | 'extension' | 'mcp'

export type ExportChatScope = 'all_threads' | 'current_thread'

export type ExportChatFormat = 'Markdown' | 'TXT' | 'HTML'

export function isChatSession(session: Session) {
  return session.type === 'chat' || !session.type
}
export function isPictureSession(session: Session) {
  return session.type === 'picture'
}

export function createMessage(role: MessageRole = MessageRoleEnum.User, content: string = ''): Message {
  return {
    id: uuidv4(),
    contentParts: content ? [{ type: 'text', text: content }] : [],
    role: role,
    timestamp: Date.now(),
  }
}

export type Language =
  | 'en'
  | 'zh-Hans'
  | 'zh-Hant'
  | 'ja'
  | 'ko'
  | 'ru'
  | 'de'
  | 'fr'
  | 'pt-PT'
  | 'es'
  | 'ar'
  | 'it-IT'
  | 'sv'
  | 'nb-NO'

export interface Config {
  uuid: string
}

export interface SponsorAd {
  text: string
  url: string
}

export interface SponsorAboutBanner {
  type: 'picture' | 'picture-text'
  name: string
  pictureUrl: string
  link: string
  title: string
  description: string
}

export interface CopilotModelSettings {
  temperature?: number
  topP?: number
  maxTokens?: number
}

export const COPILOT_MAX_STEPS_MIN = 1
export const COPILOT_MAX_STEPS_MAX = 25
export const COPILOT_MAX_STEPS_DEFAULT = 5

export interface CopilotToolAccess {
  mode: 'allowlist' | 'denylist'
  tools: string[]
  /** When false, excludes all MCP tools. Defaults to true. */
  includeMcp?: boolean
}

export type CopilotHook =
  | { type: 'inject-context'; content: string }
  | { type: 'inject-datetime' }
  | { type: 'inject-system-info' }
  | { type: 'web-fetch'; url: string; extractAs: 'text' | 'json' }
  | { type: 'validate-format'; format: 'markdown' | 'json' | 'code' }

export interface CopilotDetail {
  id: string
  name: string
  picUrl?: string
  emojiAvatar?: string
  prompt: string
  builtIn?: boolean
  demoQuestion?: string
  demoAnswer?: string
  starred?: boolean
  usedCount: number
  shared?: boolean
  modelSettings?: CopilotModelSettings
  /** Maximum autonomous tool-use steps in agent mode (1-25, default 5). */
  maxSteps?: number
  /** Tool access control for this copilot. */
  toolAccess?: CopilotToolAccess
  /** Pre-turn and post-turn hook actions. */
  hooks?: {
    preTurn?: CopilotHook[]
    postTurn?: CopilotHook[]
  }
}

/** Product name: Agent (persona). Alias of CopilotDetail during rename migration. */
export type AgentDetail = CopilotDetail

/** Team-room multi-agent caps. */
export const MAX_ROOM_AGENTS = 3
/** Default discuss rounds after a user message (back-and-forth). */
export const MAX_ROOM_ROUNDS = 2
/** Hard cap when user taps Keep discussing (includes initial rounds). */
export const MAX_ROOM_KEEP_DISCUSS_ROUNDS = 3
/** Headroom for up to MAX_ROOM_AGENTS speakers × rounds. */
export const MAX_AGENT_TURNS_PER_USER_MSG = 6
/** Soft cap for tasks created during a Swarm plan/execute run. */
export const MAX_SWARM_TASKS = 12
/**
 * Budget for Swarm agent turns per user message:
 * 1 plan (+ optional retry) + ≤ MAX_SWARM_TASKS execute + 1 deliver.
 */
export const MAX_SWARM_TURNS = MAX_SWARM_TASKS + 3

export interface PromptPreset {
  id: string
  name: string
  content: string
  category?: string
  tags?: string[]
}

export interface Toast {
  id: string
  content: string
  duration?: number
}

export interface RemoteConfig {
  setting_chatboxai_first: boolean
  current_version: string
  product_ids: number[]
  knowledge_base_models?: {
    embedding: string
    vision: string
    rerank: string
  }
}

export type ChatboxAIModel = 'chatboxai-3.5' | 'chatboxai-4' | string

export function copyMessage(source: Message): Message {
  return {
    ...source,
    cancel: undefined,
    id: uuidv4(),
  }
}

export function copyMessagesWithMapping(messages: Message[]): {
  messages: Message[]
  idMapping: Map<string, string>
} {
  const idMapping = new Map<string, string>()
  const newMessages = messages.map((msg) => {
    const newMsg = copyMessage(msg)
    idMapping.set(msg.id, newMsg.id)
    return newMsg
  })
  return { messages: newMessages, idMapping }
}

export function copyThreads(source?: SessionThread[], idMapping?: Map<string, string>): SessionThread[] | undefined {
  if (!source) {
    return undefined
  }
  return source.map((thread) => {
    // Use copyMessagesWithMapping for thread messages
    const { messages: newMessages, idMapping: threadIdMapping } = copyMessagesWithMapping(thread.messages)

    // Combine external mapping (if provided) with thread mapping
    const combinedMapping = idMapping ? new Map([...idMapping, ...threadIdMapping]) : threadIdMapping

    // Map compactionPoints (if they exist)
    const newCompactionPoints = thread.compactionPoints
      ?.map((cp) => {
        const newSummaryId = combinedMapping.get(cp.summaryMessageId)
        const newBoundaryId = combinedMapping.get(cp.boundaryMessageId)
        // Skip compactionPoints with unmapped IDs
        if (!newSummaryId || !newBoundaryId) {
          console.warn('[copyThreads] Skipping compactionPoint with unmapped IDs', cp)
          return null
        }
        return {
          ...cp,
          summaryMessageId: newSummaryId,
          boundaryMessageId: newBoundaryId,
        }
      })
      .filter((cp): cp is NonNullable<typeof cp> => cp !== null)

    return {
      ...thread,
      messages: newMessages,
      createdAt: Date.now(),
      id: uuidv4(),
      // Preserve undefined if no compactionPoints, empty array if had some but all were invalid
      compactionPoints: newCompactionPoints?.length ? newCompactionPoints : thread.compactionPoints ? [] : undefined,
    }
  })
}

// RAG related types
export type KnowledgeBaseProviderMode = 'chatbox-ai' | 'custom'

export interface KnowledgeBase {
  id: number
  name: string
  embeddingModel: string
  rerankModel: string
  visionModel?: string
  providerMode?: KnowledgeBaseProviderMode
  documentParser?: DocumentParserConfig
  createdAt: number
}

export interface KnowledgeBaseFile {
  id: number
  kb_id: number
  filename: string
  filepath: string
  mime_type: string
  file_size: number
  chunk_count: number
  total_chunks: number
  status: string
  error: string
  createdAt: number
  parsed_remotely: number
  parser_type?: DocumentParserType
}

export interface KnowledgeBaseSearchResult {
  id: number
  score: number
  text: string
  fileId: number
  filename: string
  mimeType: string
  chunkIndex: number
}

export type FileMeta = {
  name: string
  path: string
  type: string
  size: number
  /** UTF-8 text when the HTML file picker has no disk path (Tauri webview). */
  content?: string
  /** Raw bytes (PDF) when the HTML picker has no disk path. */
  contentBase64?: string
}

export * from './types/image-generation'
export * from './types/session'
export * from './types/scope'
export * from './types/settings'
export * from './types/skills'
export * from './types/commands'
export * from './types/hooks'
export * from './types/memory'
export * from './types/workspace'
