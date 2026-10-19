import * as Sentry from '@sentry/react'
import { getModel } from '@shared/models'
import {
  AIProviderNoImplementedPaintError,
  ApiError,
  BaseError,
  NetworkError,
  ProviderAPIError,
} from '@shared/models/errors'
import { createMessage, type Message } from '@shared/types'
import { countMessageWords } from '@shared/utils/message'
import { createModelDependencies } from '@/adapters'
import { checkSessionOverflowFast } from '@/packages/context-management'
import { getModelDisplayName } from '@/packages/model-setting-utils'
import { isPlanModeOn } from '@/packages/plan/planSteps'
import { estimateTokensFromMessages } from '@/packages/token'
import platform from '@/platform'
import * as chatStore from '../chatStore'
import { getAllMessageList } from '../sessionHelpers'
import { settingsStore } from '../settingsStore'
import { messageQueueStore } from './messageQueue'
import { cancelRateLimitRetry } from './rate-limit-retry'
import { getSessionWebBrowsing } from './session-web-browsing'

/**
 * (legacy comment removed)
 * @param sessionId
 * @param msg
 */
export async function insertMessage(sessionId: string, msg: Message) {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return
  }
  msg.wordCount = countMessageWords(msg)
  msg.tokenCount = estimateTokensFromMessages([msg])
  return await chatStore.insertMessage(session.id, msg)
}

/**
 * Batched variant of insertMessage — appends user turn + assistant placeholder in one
 * transaction so they render together instead of shoving each other down frame-by-frame.
 */
export async function insertMessages(sessionId: string, msgs: Message[]) {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return
  }
  for (const msg of msgs) {
    msg.wordCount = countMessageWords(msg)
    msg.tokenCount = estimateTokensFromMessages([msg])
  }
  return await chatStore.insertMessages(session.id, msgs)
}

/**
 * (legacy comment removed)
 * @param sessionId
 * @param msg
 * @param afterMsgId
 */
export async function insertMessageAfter(sessionId: string, msg: Message, afterMsgId: string) {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return
  }
  msg.wordCount = countMessageWords(msg)
  msg.tokenCount = estimateTokensFromMessages([msg])

  await chatStore.insertMessage(sessionId, msg, afterMsgId)
}

/**
 * (legacy comment removed)
 * @param sessionId
 * @param updated
 * @param refreshCounting
 */
export async function modifyMessage(
  sessionId: string,
  updated: Message,
  refreshCounting?: boolean,
  updateOnlyCache?: boolean
) {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return
  }
  if (refreshCounting) {
    updated.wordCount = countMessageWords(updated)
    updated.tokenCount = estimateTokensFromMessages([updated])
    updated.tokenCountMap = undefined
  }

  // Cache-only stream paints must not rewrite timestamp every frame — that churns
  // React Query identity + Virtuoso remeasure and makes the scrollbar flicker.
  // Persist / final settle still bump timestamp for recency ordering.
  if (!updateOnlyCache) {
    updated.timestamp = Date.now()
  } else if (updated.timestamp == null) {
    // Preserve existing timestamp when stream patches omit it (identity-stable).
    // Leave as-is if already set on the patch object.
  }
  if (updateOnlyCache) {
    await chatStore.updateMessageCache(sessionId, updated.id, updated)
  } else {
    await chatStore.updateMessage(sessionId, updated.id, updated)
  }
}

/**
 * (legacy comment removed)
 * @param sessionId
 * @param messageId
 */
export async function removeMessage(sessionId: string, messageId: string) {
  await chatStore.removeMessage(sessionId, messageId)
}

/**
 * (legacy comment removed)
 * @param params
 */
export async function submitNewUserMessage(
  sessionId: string,
  params: {
    newUserMsg: Message
    needGenerating: boolean
    onUserMessageReady?: () => void
    /** Drain path: user row already inserted while a prior turn was generating */
    userAlreadyInserted?: boolean
  }
) {
  // A new send replaces a waiting rate-limit retry: it must never fire into the new turn.
  cancelRateLimitRetry(sessionId)
  // Import generate lazily to avoid circular dependency
  // generate will be moved to generation.ts in US-006, then this import will change
  const { generate } = await import('../sessionActions.js')

  const session = await chatStore.getSession(sessionId)
  const settings = await chatStore.getSessionSettings(sessionId)
  if (!session || !settings) {
    return
  }

  // While a reply is streaming, still show the user turn in the thread immediately,
  // then schedule generation for after the active turn finishes.
  if (!params.userAlreadyInserted && getAllMessageList(session).some((message) => message.generating)) {
    await insertMessage(sessionId, params.newUserMsg)
    messageQueueStore.getState().enqueueMessage(sessionId, params.newUserMsg, params.needGenerating, {
      userAlreadyInserted: true,
    })
    params.onUserMessageReady?.()
    try {
      const scrollActions = await import('../scrollActions')
      scrollActions.scrollToBottom('auto')
    } catch {
      // non-fatal
    }
    return
  }

  // Fast synchronous overflow check using cached token counts — no modal, no blocking.
  // Full compaction (with modal/summarization) is deferred to post-response in generate().
  let truncateTokenLimit: number | undefined
  if (session.type === 'chat' || session.type === undefined) {
    const globalSettings = settingsStore.getState().getSettings()
    const quickCheck = checkSessionOverflowFast(session, globalSettings)
    if (quickCheck.isOverflow && quickCheck.truncateTokenLimit) {
      truncateTokenLimit = quickCheck.truncateTokenLimit
      // Reserve space for the outgoing user message so the truncation budget
      // accounts for tokens that will be added after this check.
      const userMsgTokens = estimateTokensFromMessages([params.newUserMsg])
      truncateTokenLimit = Math.max(0, truncateTokenLimit - userMsgTokens)
    }
  }

  // Invoke callback after compaction succeeds, before user message is inserted
  // This allows caller to clear draft at the right time
  params.onUserMessageReady?.()

  const { newUserMsg, needGenerating } = params
  const webBrowsing = getSessionWebBrowsing(sessionId, settings.provider)

  // Pin optimistic assistant ASAP so the thread never looks dead while room setup runs.
  // Multi-agent rooms create their own assistant rows — we remove this placeholder if needed.
  let newAssistantMsg = createMessage('assistant', '')
  if (newUserMsg.files && newUserMsg.files.length > 0) {
    if (!newAssistantMsg.status) {
      newAssistantMsg.status = []
    }
    newAssistantMsg.status.push({
      type: 'sending_file',
      mode: 'local',
    })
  }
  if (newUserMsg.links && newUserMsg.links.length > 0) {
    if (!newAssistantMsg.status) {
      newAssistantMsg.status = []
    }
    newAssistantMsg.status.push({
      type: 'loading_webpage',
      mode: 'local',
    })
  }

  // Insert the user turn and the assistant Thinking placeholder in ONE transaction so
  // they paint in the same frame. Two separate inserts let the user bubble land a beat
  // after Thinking and shove it down — the jerk seen while the model is thinking.
  // This runs before the heavy room-setup dynamic imports so first paint stays instant.
  let earlyAssistantInserted = false
  if (needGenerating) {
    newAssistantMsg.generating = true
    // Live-lock ASAP so Stop never flashes Send before generate() marks the target.
    const { markSessionGenerationLive } = await import('./session-live-generation')
    markSessionGenerationLive(sessionId, newAssistantMsg.id)
    if (!params.userAlreadyInserted) {
      await insertMessages(sessionId, [newUserMsg, newAssistantMsg])
    } else {
      await insertMessage(sessionId, newAssistantMsg)
    }
    earlyAssistantInserted = true
    try {
      const scrollActions = await import('../scrollActions')
      scrollActions.scrollToBottom('auto')
    } catch {
      // non-fatal
    }
  } else if (!params.userAlreadyInserted) {
    await insertMessage(sessionId, newUserMsg)
  }

  const globalSettings = settingsStore.getState().getSettings()

  // Resolve agent room membership early (team multi-agent)
  const { resolveSpeakers } = await import('@shared/agent-room')
  const { applyRoomMembership, runAgentRoomDiscussion, shouldRunMultiAgentRoom } = await import('./multi-agent-room')
  const { clearTeamRoomState } = await import('./team-room-state')
  const { getBuiltInCopilotById } = await import('@/hooks/useCopilots')

  clearTeamRoomState(sessionId)

  const roomAfterMembership = await applyRoomMembership(sessionId, newUserMsg.mentionedAgentIds)
  const speakers = resolveSpeakers(roomAfterMembership, newUserMsg.mentionedAgentIds)
  const isMultiAgentRoom = needGenerating && shouldRunMultiAgentRoom(newUserMsg.mentionedAgentIds, roomAfterMembership)

  if (isMultiAgentRoom) {
    // Room discussion owns assistant turns — drop the solo placeholder
    if (earlyAssistantInserted) {
      const { clearSessionGenerationLive } = await import('./session-live-generation')
      clearSessionGenerationLive(sessionId, newAssistantMsg.id)
      await removeMessage(sessionId, newAssistantMsg.id)
      earlyAssistantInserted = false
    }
  } else if (speakers.length === 1 && earlyAssistantInserted) {
    // Label single-agent speaker on the assistant bubble (built-in + custom agents)
    const speakerId = speakers[0]
    const { resolveAgentMeta } = await import('@/packages/agents')
    const meta = resolveAgentMeta(speakerId)
    newAssistantMsg = {
      ...newAssistantMsg,
      agentId: speakerId,
      name: meta?.name ?? getBuiltInCopilotById(speakerId)?.name,
    }
    await modifyMessage(sessionId, newAssistantMsg)
  }

  try {
    // (legacy comment removed)
    // (legacy comment removed)
    const dependencies = await createModelDependencies()
    const model = getModel(settings, globalSettings, { uuid: '' }, dependencies)
    if (webBrowsing && platform.type === 'web' && !model.isSupportToolUse()) {
      throw ProviderAPIError.fromCodeName('model_not_support_web_browsing_2', 'model_not_support_web_browsing_2')
    }

    // Files and links are now preprocessed in InputBox with storage keys, so no need to process them here
    // Just verify they have storage keys
    if (newUserMsg.files?.length) {
      const missingStorageKeys = newUserMsg.files.filter((f) => !f.storageKey)
      if (missingStorageKeys.length > 0) {
        console.warn('Files without storage keys found:', missingStorageKeys)
      }
    }
    if (newUserMsg.links?.length) {
      const missingStorageKeys = newUserMsg.links.filter((l) => !l.storageKey)
      if (missingStorageKeys.length > 0) {
        console.warn('Links without storage keys found:', missingStorageKeys)
      }
    }
  } catch (err: unknown) {
    // (legacy comment removed)
    const error = !(err instanceof Error) ? new Error(`${err}`) : err
    if (
      !(
        error instanceof ApiError ||
        error instanceof NetworkError ||
        error instanceof AIProviderNoImplementedPaintError
      )
    ) {
      Sentry.captureException(error) // unexpected error should be reported
    }
    let errorCode: number | undefined
    if (err instanceof BaseError) {
      errorCode = err.code
    }

    newAssistantMsg = {
      ...newAssistantMsg,
      generating: false,
      cancel: undefined,
      model: await getModelDisplayName(settings, globalSettings, 'chat'),
      contentParts: [{ type: 'text', text: '' }],
      errorCode,
      error: `${error.message}`, // (legacy)
      status: [],
    }
    if (earlyAssistantInserted) {
      await modifyMessage(sessionId, newAssistantMsg)
    } else if (needGenerating && !isMultiAgentRoom) {
      await insertMessage(sessionId, newAssistantMsg)
    }
    return // ，
  }
  // (legacy comment removed)
  if (needGenerating) {
    let freshSession = await chatStore.getSession(sessionId)
    // Plan mode lives in the chat's settings; the legacy top-level field is still read for old payloads.
    const planModeOn = freshSession
      ? isPlanModeOn(freshSession) || Boolean(freshSession.agentMode && freshSession.planMode)
      : false
    if (freshSession && planModeOn && !freshSession.planPhase) {
      freshSession = await chatStore.updateSession(sessionId, { planPhase: 'planning' })
    }

    if (isMultiAgentRoom) {
      await runAgentRoomDiscussion(sessionId, {
        mentionedAgentIds: newUserMsg.mentionedAgentIds,
        truncateTokenLimit,
      })
      return
    }

    await generate(sessionId, newAssistantMsg, {
      operationType: 'send_message',
      truncateTokenLimit,
      prefetchedSession: freshSession ?? undefined,
      prefetchedSettings: settings,
      speakerAgentId: speakers[0],
    })
  }
}

export function continueActiveSessionTasks(sessionId: string) {
  return submitNewUserMessage(sessionId, {
    newUserMsg: createMessage(
      'user',
      'Continue the active task plan. First inspect the current tasks, then resume the next appropriate pending task. Update task statuses before responding.'
    ),
    needGenerating: true,
  })
}
