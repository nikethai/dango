import NiceModal from '@ebay/nice-modal-react'
import type { CompactionPoint, Message, Session, SessionSettings, Settings } from '@shared/types'
import { createMessage } from '@shared/types'
import { shouldPreserveReasoningInContext } from '@shared/utils/reasoning-replay'
import type { ContextOverflowAction } from '@/modals/ContextOverflow'
import { summaryLocalOnlyMarks } from '@/packages/model-calls/toolsets/pm-pilot-history'
import { getTokenizerType } from '@/packages/token-estimation'
import { setCompactionUIState } from '@/stores/atoms/compactionAtoms'
import * as chatStore from '@/stores/chatStore'
import queryClient from '@/stores/queryClient'
import { settingsStore } from '@/stores/settingsStore'
import { sumCachedTokensFromMessages } from '../token'
import { checkOverflow, type OverflowCheckResult } from './compaction-detector'
import { buildContextForAI } from './context-builder'
import {
  type ContextTokensCacheValue,
  getContextMessagesForTokenEstimation,
  getContextTokensCacheKey,
  getLatestCompactionBoundaryId,
} from './context-tokens'
import { generateSummaryWithStream } from './summary-generator'

function getModelContextWindowFromSettings(
  providerId: string | undefined,
  modelId: string | undefined,
  settings: Settings
): number | undefined {
  if (!providerId || !modelId) return undefined
  const providerSettings = settings.providers?.[providerId]
  const model = providerSettings?.models?.find((m) => m.modelId === modelId)
  return model?.contextWindow
}

const ongoingCompactions = new Set<string>()

export interface CompactionOptions {
  force?: boolean
}

export interface CompactionResult {
  success: boolean
  compacted: boolean
  error?: Error
  summaryMessageId?: string
  overflowAction?: 'truncate' | 'continue'
  truncateTokenLimit?: number
}

export function isAutoCompactionEnabled(sessionSettings?: SessionSettings, globalSettings?: Settings): boolean {
  if (sessionSettings?.autoCompaction !== undefined) {
    return sessionSettings.autoCompaction
  }
  return globalSettings?.autoCompaction ?? true
}

export function isCompactionInProgress(sessionId: string): boolean {
  return ongoingCompactions.has(sessionId)
}

/**
 * Fast synchronous overflow check using only cached token counts.
 * Does NOT show modals, make LLM calls, or trigger computation.
 * Use this pre-send to get a quick truncation budget; defer full
 * compaction (with modal/summarization) to post-response.
 */
export function checkSessionOverflowFast(
  session: Session,
  globalSettings: Settings
): { isOverflow: boolean; truncateTokenLimit?: number } {
  if (!isAutoCompactionEnabled(session.settings, globalSettings)) {
    return { isOverflow: false }
  }

  const providerId = session.settings?.provider ?? globalSettings.defaultChatModel?.provider
  const modelId = session.settings?.modelId ?? globalSettings.defaultChatModel?.model
  if (!modelId) return { isOverflow: false }

  // Use only cached token counts from messages — never triggers async computation
  const mergedSettings = { ...globalSettings, ...session.settings } as SessionSettings
  const contextMessages = getContextMessagesForTokenEstimation(session, { settings: mergedSettings })
  const model = providerId && modelId ? { provider: providerId, modelId } : undefined
  const estimatedTokens = sumCachedTokensFromMessages(
    contextMessages,
    model,
    shouldPreserveReasoningInContext(mergedSettings, globalSettings)
  )

  const contextWindow = getModelContextWindowFromSettings(providerId, modelId, globalSettings)
  const result = checkOverflow({
    tokens: estimatedTokens,
    modelId,
    settings: { compactionThreshold: globalSettings.compactionThreshold },
    contextWindow,
  })

  if (result.isOverflow) {
    return { isOverflow: true, truncateTokenLimit: result.thresholdTokens ?? estimatedTokens }
  }
  return { isOverflow: false }
}

export async function needsCompaction(sessionId: string): Promise<boolean> {
  return (await checkSessionOverflow(sessionId)).isOverflow
}

/**
 * Returns the full overflow check result for a session.
 * Returns isOverflow=false if compaction is disabled or model is unknown.
 */
async function checkSessionOverflow(sessionId: string): Promise<OverflowCheckResult> {
  const noOverflow: OverflowCheckResult = {
    isOverflow: false,
    contextWindow: null,
    thresholdTokens: null,
    currentTokens: 0,
  }

  // ===== Keep existing early returns (do not modify) =====
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    console.log('[DEBUG needsCompaction] session not found')
    return noOverflow
  }

  const globalSettings = settingsStore.getState().getSettings()

  if (!isAutoCompactionEnabled(session.settings, globalSettings)) {
    console.log('[DEBUG needsCompaction] auto compaction disabled')
    return noOverflow
  }

  const providerId = session.settings?.provider ?? globalSettings.defaultChatModel?.provider
  const modelId = session.settings?.modelId ?? globalSettings.defaultChatModel?.model
  if (!modelId) {
    console.log('[DEBUG needsCompaction] no modelId')
    return noOverflow
  }

  // ===== NEW: Get merged settings =====
  const mergedSettings = await chatStore.getSessionSettings(sessionId)
  const maxContextMessageCount = mergedSettings.maxContextMessageCount ?? Number.MAX_SAFE_INTEGER

  // ===== NEW: Construct cache key =====
  const contextMessages = getContextMessagesForTokenEstimation(session, { settings: mergedSettings })
  const model = providerId && modelId ? { provider: providerId, modelId } : undefined
  const tokenizerType = getTokenizerType(model)
  const includeReasoningInAssistantMessages = shouldPreserveReasoningInContext(mergedSettings, globalSettings)

  const cacheKey = getContextTokensCacheKey({
    sessionId,
    maxContextMessageCount,
    latestContextMessageId: contextMessages[contextMessages.length - 1]?.id ?? null,
    latestCompactionBoundaryId: getLatestCompactionBoundaryId(session.compactionPoints),
    tokenizerType,
    includeReasoningInAssistantMessages,
  })

  // ===== NEW: Read from cache =====
  const cachedResult = queryClient.getQueryData<ContextTokensCacheValue>(cacheKey)
  if (!cachedResult) {
    // L2 cache miss: Use L1 cache aggregation (do NOT trigger calculation tasks)
    const estimatedTokens = sumCachedTokensFromMessages(contextMessages, model, includeReasoningInAssistantMessages)
    queryClient.setQueryData(cacheKey, {
      contextTokens: estimatedTokens,
      messageCount: contextMessages.length,
      timestamp: Date.now(),
    })
    const contextWindow = getModelContextWindowFromSettings(providerId, modelId, globalSettings)
    return checkOverflow({
      tokens: estimatedTokens,
      modelId,
      settings: { compactionThreshold: globalSettings.compactionThreshold },
      contextWindow,
    })
  }

  // ===== Keep existing: checkOverflow call (only replace tokens source) =====
  const contextWindow = getModelContextWindowFromSettings(providerId, modelId, globalSettings)
  return checkOverflow({
    tokens: cachedResult.contextTokens, // ← Changed: from cache
    modelId,
    settings: { compactionThreshold: globalSettings.compactionThreshold },
    contextWindow,
  })
}

export async function runCompactionWithUIState(
  sessionId: string,
  options: CompactionOptions = {}
): Promise<CompactionResult> {
  if (!options.force) {
    const overflowResult = await checkSessionOverflow(sessionId)
    if (!overflowResult.isOverflow) {
      return { success: true, compacted: false }
    }

    // Determine how to handle the overflow based on global settings
    const globalSettings = settingsStore.getState().getSettings()
    const behavior = globalSettings.contextOverflowBehavior ?? 'ask'

    if (behavior === 'ask') {
      // Show the modal and wait for user choice
      const action: ContextOverflowAction = await NiceModal.show('context-overflow', {
        currentTokens: overflowResult.currentTokens,
        thresholdTokens: overflowResult.thresholdTokens ?? overflowResult.currentTokens,
        contextWindow: overflowResult.contextWindow ?? overflowResult.currentTokens,
      })

      if (action === 'continue') {
        return { success: true, compacted: false, overflowAction: 'continue' }
      }
      if (action === 'truncate') {
        return {
          success: true,
          compacted: false,
          overflowAction: 'truncate',
          truncateTokenLimit: overflowResult.thresholdTokens ?? overflowResult.currentTokens,
        }
      }
      // action === 'compact' → fall through to run compaction below
    } else if (behavior === 'truncate') {
      // Silently truncate by token budget
      return {
        success: true,
        compacted: false,
        overflowAction: 'truncate',
        truncateTokenLimit: overflowResult.thresholdTokens ?? overflowResult.currentTokens,
      }
    }
    // behavior === 'auto-compact' → fall through to run compaction below
  }

  setCompactionUIState(sessionId, { status: 'running', error: null, streamingText: '' })

  const result = await runCompactionWithStreaming(sessionId)

  if (result.success) {
    setCompactionUIState(sessionId, { status: 'idle', error: null, streamingText: '' })
  } else {
    setCompactionUIState(sessionId, {
      status: 'failed',
      error: result.error?.message ?? 'Compaction failed',
      streamingText: '',
    })
  }

  return result
}

async function runCompactionWithStreaming(sessionId: string): Promise<CompactionResult> {
  if (ongoingCompactions.has(sessionId)) {
    return { success: true, compacted: false }
  }

  ongoingCompactions.add(sessionId)

  try {
    const session = await chatStore.getSession(sessionId)
    if (!session) {
      return { success: false, compacted: false, error: new Error('Session not found') }
    }

    const globalSettings = settingsStore.getState().getSettings()

    const modelId = session.settings?.modelId ?? globalSettings.defaultChatModel?.model
    if (!modelId) {
      return { success: true, compacted: false }
    }

    // Apply maxContextMessageCount to summary input
    const mergedSettings = await chatStore.getSessionSettings(sessionId)
    const maxContextMessageCount = mergedSettings.maxContextMessageCount ?? Number.MAX_SAFE_INTEGER
    const currentContext = getContextMessagesForTokenEstimation(session, { settings: mergedSettings })

    const summaryResult = await generateSummaryWithStream({
      messages: currentContext,
      sessionSettings: session.settings,
      onStreamUpdate: (text) => {
        setCompactionUIState(sessionId, { streamingText: text })
      },
    })

    if (!summaryResult.success || !summaryResult.summary) {
      return {
        success: false,
        compacted: false,
        error: summaryResult.error ?? new Error('Failed to generate summary'),
      }
    }

    const summaryMessage = createMessage('assistant', summaryResult.summary)
    summaryMessage.isSummary = true
    // A summary of a Needs you chat, or of a chat that used a local-only recall (slice 10), may quote client mail: it
    // keeps the marks, so a cloud turn holds it back, even once those messages are compacted away (`cloudSafeMessages`).
    Object.assign(summaryMessage, summaryLocalOnlyMarks(currentContext))

    const lastNonSummaryMessage = [...session.messages].reverse().find((m) => !m.isSummary)
    if (!lastNonSummaryMessage) {
      return { success: false, compacted: false, error: new Error('No messages to compact') }
    }

    const newCompactionPoint: CompactionPoint = {
      summaryMessageId: summaryMessage.id,
      boundaryMessageId: lastNonSummaryMessage.id,
      createdAt: Date.now(),
    }

    await chatStore.updateSessionWithMessages(sessionId, (currentSession) => {
      if (!currentSession) {
        throw new Error('Session not found during update')
      }

      const updatedMessages: Message[] = [...currentSession.messages, summaryMessage]
      const updatedCompactionPoints: CompactionPoint[] = [
        ...(currentSession.compactionPoints ?? []),
        newCompactionPoint,
      ]

      return {
        ...currentSession,
        messages: updatedMessages,
        compactionPoints: updatedCompactionPoints,
      }
    })

    return {
      success: true,
      compacted: true,
      summaryMessageId: summaryMessage.id,
    }
  } catch (error) {
    return {
      success: false,
      compacted: false,
      error: error instanceof Error ? error : new Error(String(error)),
    }
  } finally {
    ongoingCompactions.delete(sessionId)
  }
}
