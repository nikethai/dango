import * as Sentry from '@sentry/react'
import { buildFirstHandoffStreamOverrides, markHandoffConsumed } from '@shared/imported-history'
import { getModel } from '@shared/models'
import { AIProviderNoImplementedPaintError, ApiError, BaseError, NetworkError, OCRError } from '@shared/models/errors'
import type { OnResultChangeWithCancel } from '@shared/models/types'
import {
  COPILOT_MAX_STEPS_DEFAULT,
  type CompactionPoint,
  type CopilotHook,
  type CopilotToolAccess,
  createMessage,
  MAX_SWARM_TASKS,
  type Message,
  type MessageImagePart,
  type MessagePicture,
  ModelProviderEnum,
  type PlanPhase,
  type Session,
  type SessionSettings,
  type SessionType,
  type Settings,
  type StreamTextResult,
} from '@shared/types'
import { cloneMessage, getMessageText, mergeMessages } from '@shared/utils/message'
import type { ToolSet } from 'ai'
import i18next from 'i18next'
import { getDefaultStore } from 'jotai'
import { createModelDependencies } from '@/adapters'
import { getLogger } from '@/lib/utils'
import { getAgentDetailById } from '@/packages/agents'
import * as appleAppStore from '@/packages/apple_app_store'
import { buildCommandContextBlocks, resolveCommandActivations } from '@/packages/commands'
import { buildContextForAI } from '@/packages/context-management'
import {
  buildAttachmentWrapperPrefix,
  buildAttachmentWrapperSuffix,
  buildVideoAttachmentWrapper,
  MAX_INLINE_FILE_LINES,
  PREVIEW_LINES,
} from '@/packages/context-management/attachment-payload'
import { buildUntrustedImportedContextBlock } from '@/packages/imported-context'
import { prependUntrustedBlockToPrompt } from '@/packages/imported-history/continue-session'
import { generateImage, streamText } from '@/packages/model-calls'
import { classifyModelError } from '@/packages/model-errors/classify'
import { getModelDisplayName } from '@/packages/model-setting-utils'
import { isApprovedPlanRun } from '@/packages/plan/planSteps'
import { buildSkillContextBlocks, resolveSkillActivations, selectCatalogForInject } from '@/packages/skills'
import { estimateTokensFromMessages } from '@/packages/token'
import { getVideoLimits } from '@/packages/video'
import platform from '@/platform'
import { getEffectiveProjectId } from '@/projects/project-context'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { mergeCommandsList, refreshAgentCommands, userCommandsAtom } from '@/stores/commandsStore'
import { mergeSkillsList, refreshAgentSkills, userSkillsAtom } from '@/stores/skillsStore'
import { flushSessionTasks, formatActiveTaskContext, taskStore } from '@/stores/taskStore'
import {
  buildEmptyCompletionError,
  shouldContinueForVisibleAnswer,
  withFallbackAnswerParts,
} from '@/utils/message-stream-ui'
import { trackEvent } from '@/utils/track'
import { CHATBOX_BUILD_PLATFORM } from '@/variables'
import * as chatStore from '../chatStore'
import { settingsStore } from '../settingsStore'
import { uiStore } from '../uiStore'
import { createNewFork, findMessageLocation } from './forks'
import {
  clearGenerationCancel,
  clearGenerationCancelled,
  isSessionGenerationActive,
  registerGenerationCancel,
  wasGenerationCancelled,
} from './generation-cancel'
import { messageQueueStore } from './messageQueue'
import { insertMessageAfter, modifyMessage, submitNewUserMessage } from './messages'
import {
  canResumePlan,
  finishExecutedPlan,
  nextPlanVersion,
  planResumePrompt,
  planResumeRefusal,
  recordFinishedPlan,
  resumedRunParts,
  withResumedParts,
} from './plan-lifecycle'
import { cancelRateLimitRetry, rateLimitAnswered, scheduleRateLimitRetry } from './rate-limit-retry'
import {
  clearSessionGenerationLive,
  isSessionGenerationLive,
  markSessionGenerationLive,
} from './session-live-generation'
import { getSessionWebBrowsing } from './session-web-browsing'
import { buildVisibleAnswerContinuePrompt, mergeContinuedContentParts } from './tool-only-continue'
import { isToolsOffTurn } from './tools-off'

export { getSessionWebBrowsing }
export { cancelSessionGeneration, clearGenerationCancel } from './generation-cancel'

import {
  COMFYUI_AGENT_DEFAULT_NORMALIZATION_PROMPT,
  COMFYUI_AGENT_DEFAULT_RESEARCH_DOMAINS,
} from '@shared/providers/definitions/comfyui'
import type { MessagePlanPart, MessageToolCallPart } from '@shared/types'
import { runCompactionWithUIState } from '@/packages/context-management'

// Agent-only modules (toolsets, copilot hooks, agentImageFlow) are loaded
// dynamically inside the corresponding agent-mode code paths so they can be
// tree-shaken from the Android bundle. CHATBOX_BUILD_PLATFORM === 'android'
// gates ensure the dynamic imports never execute on mobile.
const isAgentEnabled = CHATBOX_BUILD_PLATFORM !== 'android'
const knowledgeLog = getLogger('knowledge')
const planDecisionInFlight = new Set<string>()

function getMessageFromSession(session: Session, messageId: string): Message | null {
  const location = findMessageLocation(session, messageId)
  return location ? location.list[location.index] : null
}

/** The rejection an aborted fetch or stream ends with (a DOMException or an Error named AbortError). */
function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}

function getPlanPart(message: Message): MessagePlanPart | null {
  return message.contentParts.find((part): part is MessagePlanPart => part.type === 'plan') ?? null
}

function withPlanPart(
  contentParts: Message['contentParts'],
  planPart: MessagePlanPart | undefined
): Message['contentParts'] {
  if (!planPart) return contentParts
  const withoutPlan = contentParts.filter((part) => part.type !== 'plan')
  return [...withoutPlan, planPart]
}

/** The model a single turn answers with instead of the chat's (Redo ▾). */
export type ModelOverride = { provider: string; modelId: string }

type PlanDecisionFields = Partial<Pick<MessagePlanPart, 'startedAt' | 'revised' | 'runStartedAt'>>

function withPlanFields(
  message: Message,
  fields: PlanDecisionFields & Partial<Pick<MessagePlanPart, 'status'>>
): Message {
  let found = false
  const contentParts = message.contentParts.map((part) => {
    if (part.type !== 'plan') return part
    found = true
    return { ...part, ...fields }
  })
  if (!found) {
    throw new Error('The proposed plan is no longer available.')
  }
  return { ...message, contentParts }
}

function withPlanStatus(message: Message, status: MessagePlanPart['status'], extra?: PlanDecisionFields): Message {
  return withPlanFields(message, { ...extra, status })
}

/**
 * A plan run is about to start (Run plan or Continue): the message reads as generating from the same write, so the card
 * shows running at once instead of "Plan stopped" with Continue while generate() sets up.
 */
const startingRun = (message: Message): Message => ({ ...message, generating: true })

/** The run never started (a step before generate() threw): put the message back to not generating. */
async function abandonStartingRun(sessionId: string, message: Message) {
  try {
    await modifyMessage(sessionId, { ...message, generating: false }, true)
  } catch {
    // non-fatal: the session may be gone
  }
}

async function updatePendingPlanStatus(
  sessionId: string,
  messageId: string,
  status: Extract<MessagePlanPart['status'], 'approved' | 'rejected'>,
  extra?: PlanDecisionFields,
  opts?: { startRun?: boolean }
): Promise<{ message: Message; plan: MessagePlanPart }> {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    throw new Error('The session is no longer available.')
  }
  const message = getMessageFromSession(session, messageId)
  if (!message || message.generating) {
    throw new Error('The proposed plan is no longer available.')
  }
  const plan = getPlanPart(message)
  if (!plan || plan.status !== 'pending') {
    throw new Error('This plan has already been decided.')
  }
  const decided = withPlanStatus(message, status, extra)
  const updatedMessage = opts?.startRun ? startingRun(decided) : decided
  await modifyMessage(sessionId, updatedMessage, true)
  return { message: updatedMessage, plan }
}

export async function approveAndExecutePlan(sessionId: string, messageId: string) {
  const key = `${sessionId}:${messageId}`
  if (planDecisionInFlight.has(key)) return
  planDecisionInFlight.add(key)
  try {
    const { message: approved } = await updatePendingPlanStatus(
      sessionId,
      messageId,
      'approved',
      { startedAt: Date.now() },
      { startRun: true }
    )
    let session: Session | null | undefined
    let message: Message | null = null
    try {
      await chatStore.updateSession(sessionId, { planPhase: 'executing' })
      session = await chatStore.getSession(sessionId)
      message = session ? getMessageFromSession(session, messageId) : null
      if (!session || !message) {
        throw new Error('The approved plan could not be resumed.')
      }
    } catch (error) {
      await abandonStartingRun(sessionId, approved)
      throw error
    }
    await generate(sessionId, message, { operationType: 'send_message', prefetchedSession: session })
  } finally {
    planDecisionInFlight.delete(key)
  }
}

/**
 * Continue on a stopped plan: the same plan message runs again in the execution phase, keeping the stopped run's visible
 * work, so the card goes running → finished (or stopped again) and the finish and Change rules apply to this plan.
 */
export async function resumeStoppedPlan(sessionId: string, messageId: string) {
  const key = `${sessionId}:${messageId}`
  if (planDecisionInFlight.has(key)) return
  planDecisionInFlight.add(key)
  try {
    const session = await chatStore.getSession(sessionId)
    if (!session) throw new Error(i18next.t('This plan can no longer be continued.'))
    const message = getMessageFromSession(session, messageId)
    // The execution phase (and keeping the plan part) needs plan mode in an agent chat, as when the plan was approved.
    const settings = await chatStore.getSessionSettings(sessionId)
    const refusal = planResumeRefusal(session, messageId, {
      // Setup-aware: another turn is live from send, before its stream registers an abort.
      generationActive: isSessionGenerationActive(sessionId) || isSessionGenerationLive(sessionId),
      planModeOn: Boolean(session.agentMode && settings?.planMode),
    })
    if (refusal || !message) throw new Error(refusal ?? i18next.t('This plan can no longer be continued.'))
    // This run's start: the timer counts it on top of the stopped runs (runMs); startedAt still scopes the tasks.
    const resuming = startingRun(withPlanFields(message, { runStartedAt: Date.now() }))
    await modifyMessage(sessionId, resuming, true)
    let fresh: Session
    try {
      await chatStore.updateSession(sessionId, { planPhase: 'executing' })
      fresh = (await chatStore.getSession(sessionId)) ?? session
    } catch (error) {
      await abandonStartingRun(sessionId, resuming)
      throw error
    }
    const target = getMessageFromSession(fresh, messageId) ?? resuming
    await generate(sessionId, target, {
      operationType: 'send_message',
      prefetchedSession: fresh,
      prefetchedSettings: settings,
      resumePlanRun: true,
    })
  } finally {
    planDecisionInFlight.delete(key)
  }
}

export async function rejectPlan(sessionId: string, messageId: string) {
  const key = `${sessionId}:${messageId}`
  if (planDecisionInFlight.has(key)) return
  planDecisionInFlight.add(key)
  try {
    await updatePendingPlanStatus(sessionId, messageId, 'rejected')
    await chatStore.updateSession(sessionId, { planPhase: undefined })
  } finally {
    planDecisionInFlight.delete(key)
  }
}

export async function requestPlanChanges(sessionId: string, messageId: string, feedback: string) {
  const trimmedFeedback = feedback.trim()
  if (!trimmedFeedback) {
    throw new Error('Describe the changes you want before requesting a revision.')
  }

  const key = `${sessionId}:${messageId}`
  if (planDecisionInFlight.has(key)) return
  planDecisionInFlight.add(key)
  try {
    // Superseded by the next version, not rejected: the card folds it as "Plan v{{version}}". Stored as 'rejected' +
    // `revised: true` so builds before 6a (which drop a session whose plan status they don't know) still read it.
    const { plan } = await updatePendingPlanStatus(sessionId, messageId, 'rejected', { revised: true })
    await chatStore.updateSession(sessionId, { planPhase: 'planning' })
    await submitNewUserMessage(sessionId, {
      newUserMsg: createMessage(
        'user',
        `Please revise the proposed plan based on this feedback. Do not execute the task yet.\n\n## Previous plan\n${plan.planText}\n\n## Feedback\n${trimmedFeedback}`
      ),
      needGenerating: true,
    })
  } finally {
    planDecisionInFlight.delete(key)
  }
}

function buildAgentImageFlowInstruction(settings: Settings): string | undefined {
  const comfyuiSettings = settings.providers?.[ModelProviderEnum.ComfyUI]
  if (!comfyuiSettings?.agentImageFlowEnabled) {
    return undefined
  }

  const domains = comfyuiSettings.agentImageResearchDomains?.length
    ? comfyuiSettings.agentImageResearchDomains
    : COMFYUI_AGENT_DEFAULT_RESEARCH_DOMAINS
  const normalizationPrompt =
    comfyuiSettings.agentImageNormalizationPrompt || COMFYUI_AGENT_DEFAULT_NORMALIZATION_PROMPT

  return [
    '## COMFYUI AGENT IMAGE FLOW',
    'You are allowed to perform a research-to-image workflow for anime art references.',
    `Research only these domains: ${domains.join(', ')}.`,
    'Always call `web_search` with `includeDomains` set to exactly that list. Use concise English search queries focused on current or trending anime art styles.',
    'When promising results are found, use `parse_link` on the strongest links. If parsing fails or content is sparse, fall back to the available snippets.',
    'Extract only reusable visual traits. Do not keep character names, franchise names, artist names, copyrighted identifiers, or body-specific traits.',
    `Normalization rules: ${normalizationPrompt}`,
    'When you are ready, call `generate_image` with the final normalized comma-separated tags. Do not ask the user for confirmation.',
  ].join('\n')
}

function getTextFromContentParts(contentParts: Message['contentParts']): string {
  return contentParts
    .filter((part): part is Extract<Message['contentParts'][number], { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim()
}

function hasGenerateImageToolCall(contentParts: Message['contentParts']): boolean {
  return contentParts.some((part) => part.type === 'tool-call' && part.toolName === 'generate_image')
}

async function maybeAutoStartAgentImageFlow(
  contentParts: Message['contentParts']
): Promise<MessageToolCallPart | null> {
  if (hasGenerateImageToolCall(contentParts)) {
    return null
  }
  if (!isAgentEnabled) {
    return null
  }

  const { extractDanbooruTagListFromText } = await import('./agentImageFlow')
  const inferredPrompt = extractDanbooruTagListFromText(getTextFromContentParts(contentParts))
  if (!inferredPrompt) {
    return null
  }

  const toolCallId = `generate_image_fallback_${Date.now()}`

  try {
    const { startComfyUIAgentGeneration } = await import('@/packages/model-calls/toolsets/generate-image')
    const generationResult = await startComfyUIAgentGeneration({
      prompt: inferredPrompt,
    })

    return {
      type: 'tool-call',
      state: 'result',
      toolCallId,
      toolName: 'generate_image',
      args: {
        prompt: inferredPrompt,
      },
      result: generationResult,
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(`${error}`)
    return {
      type: 'tool-call',
      state: 'error',
      toolCallId,
      toolName: 'generate_image',
      args: {
        prompt: inferredPrompt,
      },
      result: {
        name: err.name,
        message: err.message,
        stack: err.stack,
      },
    }
  }
}

// Planning phase system prompt instruction
const PLANNING_SYSTEM_PROMPT = `
You are in PLANNING MODE. Your task is to analyze the user's request and create a structured execution plan.

## Your Output Format
You MUST output a MessagePlanPart with your plan. The plan should:
1. Break down the task into clear, actionable steps
2. Identify which tools will be needed for each step
3. Consider potential risks or issues
4. Be specific enough for execution

## Tools Available in Planning Mode
You have access to **read-only** tools only:
- web_search / parse_link (when browsing is enabled)
- read_file / search_file_content for **uploaded chat attachments** (fileKey) when present
- knowledge_base search when a knowledge base is selected

You do **NOT** have create_file, edit_file, delete_file, or a terminal in planning mode.
After the user approves the plan, execution may stage project file proposals for Change Review (desktop, when a Project folder is bound). Generic shell and terminal tools stay unavailable.

## Important
- Do NOT execute the task - only create a plan
- Be thorough in your analysis
- Consider edge cases and error handling
- Output your plan in a structured format

When you have completed your plan, include it in your response as a plan part.
`

/**
 * Construct read-only tools for planning phase.
 * Only includes: web_search, read_file, search_file_content, and knowledge_base tools.
 * MCP tools are excluded from planning phase.
 */
async function getReadOnlyToolsForPlanning(
  knowledgeBase?: Pick<{ id: number; name: string }, 'id' | 'name'>
): Promise<{ tools: ToolSet; instructions: string }> {
  const tools: ToolSet = {}
  let instructions = PLANNING_SYSTEM_PROMPT

  // Plan mode is agent-only; on Android the toolsets aren't bundled.
  if (!isAgentEnabled) {
    return { tools, instructions }
  }

  // Lazy-load agent toolsets so they're tree-shaken on Android.
  const [websearchToolSetModule, fileToolSetModule, kbModule] = await Promise.all([
    import('@/packages/model-calls/toolsets/web-search'),
    import('@/packages/model-calls/toolsets/file'),
    import('@/packages/model-calls/toolsets/knowledge-base'),
  ])
  const websearchToolSet = websearchToolSetModule.default
  const fileToolSet = fileToolSetModule.default
  const { getToolSet } = kbModule

  // Add web search tools
  if (websearchToolSet?.tools) {
    if (websearchToolSet.tools.web_search) {
      tools.web_search = websearchToolSet.tools.web_search
    }
    if (websearchToolSet.tools.parse_link) {
      tools.parse_link = websearchToolSet.tools.parse_link
    }
  }

  // Attachment read tools only (no create/edit/delete) — honest for planning
  const attachmentTools =
    fileToolSetModule.attachmentFileTools ?? fileToolSetModule.attachmentFileToolSet?.tools ?? fileToolSet?.tools
  if (attachmentTools?.read_file) {
    tools.read_file = attachmentTools.read_file
  }
  if (attachmentTools?.search_file_content) {
    tools.search_file_content = attachmentTools.search_file_content
  }

  // Add knowledge base tools
  let kbInstructions = ''
  if (knowledgeBase) {
    try {
      const kbToolSet = await getToolSet(knowledgeBase.id, knowledgeBase.name)
      if (kbToolSet?.tools) {
        Object.assign(tools, kbToolSet.tools)
      }
      kbInstructions = kbToolSet?.description ?? ''
    } catch (err) {
      console.error('Failed to load knowledge base toolset for planning:', err)
    }
  }

  // Build instructions string — attachment description only (never workspace write docs)
  if (websearchToolSet?.description) {
    instructions += '\n\n' + websearchToolSet.description
  }
  const attachmentDescription =
    fileToolSetModule.attachmentFileToolSetDescription ??
    fileToolSetModule.attachmentFileToolSet?.description ??
    fileToolSet?.description
  if (attachmentDescription) {
    instructions += '\n\n' + attachmentDescription
  }
  if (kbInstructions) {
    instructions += '\n\n' + kbInstructions
  }

  return { tools, instructions }
}

/**
 * Run overflow handling and return truncateTokenLimit if applicable.
 * Used by regenerate flows to apply the same truncation as send-message.
 */
export async function getOverflowTruncateLimit(sessionId: string): Promise<number | undefined> {
  const session = await chatStore.getSession(sessionId)
  if (!session || (session.type !== 'chat' && session.type !== undefined)) {
    return undefined
  }
  const compactionResult = await runCompactionWithUIState(sessionId)
  if (!compactionResult.success) {
    throw compactionResult.error ?? new Error('Compaction failed')
  }
  return compactionResult.truncateTokenLimit
}

/**
 * Retrieve agent model-settings overrides (built-in, local custom, remote catalog).
 */
function getCopilotSettings(copilotId: string | undefined): {
  temperature?: number
  topP?: number
  maxTokens?: number
  maxSteps?: number
  toolAccess?: CopilotToolAccess
  hooks?: { preTurn?: CopilotHook[]; postTurn?: CopilotHook[] }
} | null {
  if (!copilotId) return null
  const detail = getAgentDetailById(copilotId)
  if (!detail) return null
  return { ...detail.modelSettings, maxSteps: detail.maxSteps, toolAccess: detail.toolAccess, hooks: detail.hooks }
}

/**
 * Track generation event
 */
function trackGenerateEvent(
  sessionId: string,
  settings: SessionSettings,
  globalSettings: Settings,
  sessionType: SessionType | undefined,
  options?: { operationType?: 'send_message' | 'regenerate' }
) {
  // Get a more meaningful provider identifier
  let providerIdentifier = settings.provider
  if (settings.provider?.startsWith('custom-provider-')) {
    // For custom providers, use apiHost as identifier
    const providerSettings = globalSettings.providers?.[settings.provider]
    if (providerSettings?.apiHost) {
      try {
        const url = new URL(providerSettings.apiHost)
        providerIdentifier = `custom:${url.hostname}`
      } catch {
        providerIdentifier = `custom:${providerSettings.apiHost}`
      }
    } else {
      providerIdentifier = 'custom:unknown'
    }
  }

  const webBrowsing = getSessionWebBrowsing(sessionId, settings.provider)

  trackEvent('generate', {
    provider: providerIdentifier,
    model: settings.modelId || 'unknown',
    operation_type: options?.operationType || 'unknown',
    web_browsing_enabled: webBrowsing ? 'true' : 'false',
    session_type: sessionType || 'chat',
  })
}

/**
 * Create n empty picture messages (loading state, for placeholders)
 * @param n Number of empty messages
 * @returns
 */
export function createLoadingPictures(n: number): MessagePicture[] {
  const ret: MessagePicture[] = []
  for (let i = 0; i < n; i++) {
    ret.push({ loading: true })
  }
  return ret
}

/** Drain send-queue after a generation settles (or early-exits that still free the session). */
async function processSessionMessageQueue(sessionId: string, shouldProcess: boolean) {
  if (!shouldProcess) {
    return
  }
  // Run full compaction check in background after response is shown to user.
  runCompactionWithUIState(sessionId).catch((err) => {
    console.warn('[generate] Post-response compaction failed:', err)
  })

  while (messageQueueStore.getState().getQueuedCount(sessionId) > 0) {
    const nextQueuedMessage = messageQueueStore.getState().dequeueMessage(sessionId)
    if (!nextQueuedMessage) {
      break
    }

    await submitNewUserMessage(sessionId, {
      newUserMsg: nextQueuedMessage.message,
      needGenerating: nextQueuedMessage.needGenerating,
      userAlreadyInserted: nextQueuedMessage.userAlreadyInserted,
    })

    if (nextQueuedMessage.needGenerating) {
      break
    }
  }
}

/**
 * Execute message generation, will modify message state
 * @param sessionId
 * @param targetMsg
 * @returns
 */
export async function generate(
  sessionId: string,
  targetMsg: Message,
  options?: {
    operationType?: 'send_message' | 'regenerate'
    truncateTokenLimit?: number
    prefetchedSession?: Session
    prefetchedSettings?: SessionSettings
    /** Explicit speaker persona (multi-agent room or @ single agent) */
    speakerAgentId?: string
    /** Inject team-room protocol; tools off except do/deliver phases */
    roomMulti?: boolean
    /** Multi-agent turn kind: discuss / team answer / work phases */
    roomRole?: 'turn' | 'synthesis' | 'plan' | 'do' | 'review' | 'deliver'
    /** Team room mode (discuss / work / swarm) for protocol + tool policy */
    roomMode?: 'discuss' | 'work' | 'swarm'
    /** Display names of all room participants for protocol text */
    participantNames?: string[]
    /** 1-based discuss round (for protocol) */
    roomRound?: number
    /** Stance label: Proposer / Critic / Integrator */
    stanceLabel?: string
    /** Lead name for work/team-answer protocols */
    leadName?: string
    /** Swarm execute: assigned task id / title for protocol */
    taskId?: string
    taskTitle?: string
    /** Swarm plan: "Name (id: …)" directory for assigneeAgentId */
    participantDirectory?: string
    /** Swarm deliver after the user pressed Stop: answer from the work so far. */
    swarmStoppedEarly?: boolean
    /** Skip processing message queue after this turn (intermediate multi-agent turns) */
    skipQueuedMessages?: boolean
    /** Continue a stopped plan run in place: keep its visible work and tell the model where it stopped. */
    resumePlanRun?: boolean
    /** Answer this turn with another model (Redo ▾). Never written to the chat's settings. */
    modelOverride?: ModelOverride
  }
) {
  // Any new turn in this chat (send, Retry, Redo, Run plan, Continue, edit and resend) replaces a waiting rate-limit
  // retry: it must never fire into the new turn (ER3).
  cancelRateLimitRetry(sessionId)
  // Long-run notifications time the run itself (send, regenerate, plan run, resume), not the message's age.
  const runStartedAt = Date.now()
  // Process the send-queue unless multi-agent intermediate turns opt out, or plan mode
  // is waiting for user approval. Use finally so early exits still drain.
  let shouldProcessQueuedMessages = !options?.skipQueuedMessages
  let activeExecutionPlan: MessagePlanPart | undefined
  // An execution run (approve or Continue set planPhase 'executing') clears the phase however it ends.
  const executionRun = isApprovedPlanRun(targetMsg)
  let managesPlanPhase = executionRun
  const releaseExecutionPhase = async () => {
    if (!executionRun) return
    try {
      await chatStore.updateSession(sessionId, { planPhase: undefined })
    } catch {
      // non-fatal: the session may be gone
    }
  }
  // Get dependent data — use pre-fetched values when available to avoid redundant async lookups
  const session = options?.prefetchedSession ?? (await chatStore.getSession(sessionId))
  const settings = options?.prefetchedSettings ?? (await chatStore.getSessionSettings(sessionId))
  const globalSettings = settingsStore.getState().getSettings()
  const configs = await platform.getConfig()
  if (!session || !settings) {
    await releaseExecutionPhase()
    // A caller that marked the message generating (Run plan, Continue) must not leave it spinning.
    if (session && targetMsg.generating) {
      try {
        await modifyMessage(sessionId, { ...targetMsg, generating: false }, true)
      } catch {
        // non-fatal
      }
    }
    return
  }

  // Overlay agent/copilot model settings. Prefer explicit speaker → message.agentId → room primary.
  const speakerAgentId = options?.speakerAgentId ?? targetMsg.agentId ?? session.agentIds?.[0] ?? session.copilotId
  const copilotOverrides = getCopilotSettings(speakerAgentId)
  const overlaidSettings: SessionSettings = copilotOverrides
    ? {
        ...settings,
        temperature: copilotOverrides.temperature ?? settings.temperature,
        topP: copilotOverrides.topP ?? settings.topP,
        maxTokens: copilotOverrides.maxTokens ?? settings.maxTokens,
      }
    : settings
  // Redo ▾ answers this one turn with the picked model; the chat's stored settings keep their own.
  const modelOverride = options?.modelOverride
  const effectiveSettings: SessionSettings = modelOverride
    ? { ...overlaidSettings, provider: modelOverride.provider, modelId: modelOverride.modelId }
    : overlaidSettings

  // Track generation event
  trackGenerateEvent(sessionId, effectiveSettings, globalSettings, session.type, options)

  // Optional hard-stop when the local monthly cap is already exceeded
  try {
    const budgetCfg = globalSettings.usageBudget
    if (budgetCfg?.enabled && budgetCfg.pauseWhenExceeded) {
      const { providerUsageService, evaluateBudget, shouldHardStopSend } = await import('@/packages/usage-tracking')
      await providerUsageService.init()
      const period = budgetCfg.period
      const pid = String(effectiveSettings.provider ?? '')
      const evalResult = evaluateBudget({
        config: budgetCfg,
        globalLocal: providerUsageService.getLocalSnapshot(period),
        providerLocal: pid ? providerUsageService.getLocalSnapshot(period, pid) : undefined,
        providerId: pid || undefined,
      })
      if (shouldHardStopSend(budgetCfg, evalResult)) {
        clearSessionGenerationLive(sessionId, targetMsg.id)
        targetMsg = {
          ...targetMsg,
          generating: false,
          cancel: undefined,
          error: `Send blocked: ${evalResult.message}. Disable hard-stop in Settings → Usage, or raise your monthly cap.`,
          // Not the provider's error: the notice points to Usage, never to Retry.
          errorExtra: { kind: 'budget' },
          status: [],
        }
        await modifyMessage(sessionId, targetMsg, true)
        await releaseExecutionPhase()
        await processSessionMessageQueue(sessionId, shouldProcessQueuedMessages)
        return
      }
    }
  } catch {
    // non-fatal — never block chat on budget evaluation failure
  }

  // Reset message state to initial state
  targetMsg = {
    ...targetMsg,
    // FIXME: For picture message generation, need to show placeholder
    // pictures: session.type === 'picture' ? createLoadingPictures(settings.imageGenerateNum) : targetMsg.pictures,
    cancel: undefined,
    aiProvider: effectiveSettings.provider,
    model: await getModelDisplayName(effectiveSettings, globalSettings, session.type || 'chat'),
    style: session.type === 'picture' ? effectiveSettings.dalleStyle : undefined,
    generating: true,
    errorCode: undefined,
    error: undefined,
    errorExtra: undefined,
    status: [],
    firstTokenLatency: undefined,
    // Set isStreamingMode once during Message initialization (constant property)
    isStreamingMode: effectiveSettings.stream !== false,
  }

  // UI live-lock: Stop/statusline stay continuous for whole multi-step turn.
  markSessionGenerationLive(sessionId, targetMsg.id)
  await modifyMessage(sessionId, targetMsg)
  // Pin once at stream start only (not every stream paint).
  try {
    const scrollActions = await import('../scrollActions')
    scrollActions.scrollToBottom('auto')
  } catch {
    // non-fatal
  }

  // Re-fetch session after insert/modify so multi-agent turns always see the new message.
  // Using the pre-modify snapshot can miss just-inserted assistant rows (silent empty turns).
  const sessionForMessages = (await chatStore.getSession(sessionId)) ?? session
  let messages = sessionForMessages.messages
  let targetMsgIx = messages.findIndex((m) => m.id === targetMsg.id)
  if (targetMsgIx < 0) {
    if (sessionForMessages.threads) {
      for (const t of sessionForMessages.threads) {
        messages = t.messages
        targetMsgIx = messages.findIndex((m) => m.id === targetMsg.id)
        if (targetMsgIx >= 0) {
          break
        }
      }
    }
    if (targetMsgIx < 0) {
      clearSessionGenerationLive(sessionId, targetMsg.id)
      targetMsg = {
        ...targetMsg,
        generating: false,
        cancel: undefined,
        error: 'Failed to locate assistant message in session',
      }
      await modifyMessage(sessionId, targetMsg, true)
      await releaseExecutionPhase()
      await processSessionMessageQueue(sessionId, shouldProcessQueuedMessages)
      return
    }
  }

  // ER4 "Answer without tools": decided before sending (InputBox), only honoured here; no ability check mid-turn.
  const toolsOffForTurn = isToolsOffTurn(messages, targetMsg.id)

  // Shared stream UI coalescing — visible to catch so error path can cancel pending writes.
  // ~32ms (~30fps) is smoother token growth than 50ms without the 16ms Virtuoso thrash.
  const STREAM_UI_MIN_MS = 32
  const persistInterval = 2000
  let lastPersistTimestamp = Date.now()
  let lastStreamUiWriteAt = 0
  let streamUiTimer: ReturnType<typeof setTimeout> | null = null
  let streamWriteChain: Promise<void> = Promise.resolve()
  let pendingStreamMsg: Message | null = null
  const writePendingStreamMsg = async () => {
    const msg = pendingStreamMsg
    if (!msg) return
    pendingStreamMsg = null
    lastStreamUiWriteAt = Date.now()
    const shouldPersist = Date.now() - lastPersistTimestamp >= persistInterval
    await modifyMessage(sessionId, msg, false, !shouldPersist)
    if (shouldPersist) {
      lastPersistTimestamp = Date.now()
    }
  }
  const flushStreamUi = (msg: Message) => {
    pendingStreamMsg = msg
    const now = Date.now()
    if (now - lastStreamUiWriteAt < STREAM_UI_MIN_MS) {
      if (streamUiTimer == null) {
        streamUiTimer = setTimeout(() => {
          streamUiTimer = null
          streamWriteChain = streamWriteChain.then(() => writePendingStreamMsg())
        }, STREAM_UI_MIN_MS)
      }
      return streamWriteChain
    }
    if (streamUiTimer != null) {
      clearTimeout(streamUiTimer)
      streamUiTimer = null
    }
    streamWriteChain = streamWriteChain.then(() => writePendingStreamMsg())
    return streamWriteChain
  }
  const settleStreamUi = async (msg: Message) => {
    // Flush any coalesced patch first so we never paint "finished + empty" then pop content.
    if (streamUiTimer != null) {
      clearTimeout(streamUiTimer)
      streamUiTimer = null
    }
    if (pendingStreamMsg) {
      streamWriteChain = streamWriteChain.then(() => writePendingStreamMsg())
    }
    await streamWriteChain
    pendingStreamMsg = null
    await modifyMessage(sessionId, msg, true)
    // Do not pin scroll on settle — Virtuoso followOutput already sticks when at bottom;
    // an extra scrollToBottom fought remeasure and jerked the bar.
  }

  try {
    const dependencies = await createModelDependencies()
    const { refreshXaiAuthIfNeeded } = await import('@/utils/xai-auth-refresh')
    const { refreshOpenAICodexAuthIfNeeded } = await import('@/utils/openai-codex-auth-refresh')
    const { refreshGeminiAntigravityAuthIfNeeded } = await import('@/utils/gemini-antigravity-auth-refresh')
    let authReadySettings = await refreshXaiAuthIfNeeded(globalSettings, effectiveSettings.provider)
    authReadySettings = await refreshOpenAICodexAuthIfNeeded(authReadySettings, effectiveSettings.provider)
    authReadySettings = await refreshGeminiAntigravityAuthIfNeeded(authReadySettings, effectiveSettings.provider)
    const model = getModel(effectiveSettings, authReadySettings, configs, dependencies)
    const sessionKnowledgeBaseMap = uiStore.getState().sessionKnowledgeBaseMap
    const knowledgeBase = sessionKnowledgeBaseMap[sessionId]
    const agentImageFlowInstructions =
      isAgentEnabled && session.agentMode ? buildAgentImageFlowInstruction(globalSettings) : undefined
    const firstHandoff = buildFirstHandoffStreamOverrides(session.continuationLineage)
    const webBrowsing = firstHandoff
      ? false
      : getSessionWebBrowsing(sessionId, effectiveSettings.provider) || Boolean(agentImageFlowInstructions)
    const useGeminiGrounding =
      webBrowsing &&
      effectiveSettings.provider === ModelProviderEnum.Gemini &&
      globalSettings.extension.webSearch.useGoogleGroundingForGemini !== false
    // Multi-agent room discussion: no tool loops (v1)
    const roomMulti = Boolean(options?.roomMulti)
    // Always cap tool steps. Undefined used to become Number.MAX_SAFE_INTEGER in the model
    // layer — models with tools (memory, MCP, web) could loop forever ("Using tools…" hang).
    // Default maxSteps is only 5 — too small for browser/computer multi-step loops.
    // When browser/computer is armed, raise the floor from settings (or product minimums).
    const COMPUTER_USE_MIN_STEPS = 16
    const BROWSER_USE_MIN_STEPS = 12
    let maxSteps =
      !roomMulti && isAgentEnabled && session.agentMode
        ? (copilotOverrides?.maxSteps ?? COPILOT_MAX_STEPS_DEFAULT)
        : COPILOT_MAX_STEPS_DEFAULT
    if (session.browserArmed && !roomMulti) {
      const configuredBrowserSteps = globalSettings.extension?.browserAgent?.maxStepsPerTurn
      const browserFloor =
        typeof configuredBrowserSteps === 'number' && configuredBrowserSteps > 0
          ? configuredBrowserSteps
          : BROWSER_USE_MIN_STEPS
      maxSteps = Math.max(maxSteps ?? COPILOT_MAX_STEPS_DEFAULT, browserFloor, BROWSER_USE_MIN_STEPS)
    }
    if (session.computerArmed && !roomMulti) {
      maxSteps = Math.max(maxSteps ?? COPILOT_MAX_STEPS_DEFAULT, COMPUTER_USE_MIN_STEPS)
    }
    switch (session.type) {
      // Chat message generation
      case 'chat':
      case undefined: {
        const startTime = Date.now()
        let firstTokenLatency: number | undefined
        let lastTokenSpeed: number | undefined
        let promptMsgs = await genMessageContext(
          effectiveSettings,
          messages.slice(0, targetMsgIx),
          model.isSupportToolUse('read-file'),
          { compactionPoints: session.compactionPoints, truncateTokenLimit: options?.truncateTokenLimit }
        )
        if (firstHandoff && session.continuationLineage?.pendingExcerpts?.length) {
          const block = buildUntrustedImportedContextBlock({
            sourceProvider: 'chatgpt',
            sourceLabel: session.name,
            excerpts: session.continuationLineage.pendingExcerpts,
          })
          promptMsgs = prependUntrustedBlockToPrompt(promptMsgs, block.text)
        }

        if (effectiveSettings.provider === ModelProviderEnum.OpenClaw) {
          // OpenClaw manages its own session prompt. Drop persisted chat-level system messages,
          // but keep runtime instructions injected below (pre-hooks, planning, tool prompts).
          promptMsgs = promptMsgs.filter((message) => message.role !== 'system')
        }

        // Per-speaker agent system prompt (persona + optional room protocol)
        // Uses same catalog as @ picker (built-in + local + remote)
        if (speakerAgentId && effectiveSettings.provider !== ModelProviderEnum.OpenClaw) {
          const agentDetail = getAgentDetailById(speakerAgentId)
          const speakerName = agentDetail?.name || targetMsg.name || speakerAgentId
          const names = options?.participantNames?.length ? options.participantNames : [speakerName]
          const roomRole = options?.roomRole ?? targetMsg.roomRole
          if (agentDetail?.prompt || roomMulti) {
            const { buildProtocolForRoomRole, buildRoomContinuePrompt } = await import('@shared/agent-room')
            let protocol = ''
            if (roomMulti) {
              const role = roomRole ?? 'turn'
              protocol = buildProtocolForRoomRole(role, speakerName, names, {
                roomRound: options?.roomRound ?? targetMsg.roomRound,
                stanceLabel: options?.stanceLabel,
                leadName: options?.leadName,
                roomMode: options?.roomMode,
                taskId: options?.taskId,
                taskTitle: options?.taskTitle,
                participantDirectory: options?.participantDirectory,
                stoppedEarly: options?.swarmStoppedEarly,
              })
            }
            const persona = agentDetail?.prompt?.trim() || `You are "${speakerName}", a helpful AI participant.`
            // Prefer mermaid fences for diagrams (app renders + zooms them; ASCII text blocks do not)
            const { MERMAID_DIAGRAM_GUIDANCE } = await import('@shared/mermaid-diagram-guidance')
            const baseSystem = [persona, protocol].filter(Boolean).join('\n\n')
            const systemText =
              baseSystem.includes('## Diagrams') || baseSystem.includes('```mermaid')
                ? baseSystem
                : `${baseSystem}\n\n${MERMAID_DIAGRAM_GUIDANCE}`
            // Replace leading session system message with this speaker's persona
            if (promptMsgs[0]?.role === 'system') {
              promptMsgs = [createMessage('system', systemText), ...promptMsgs.slice(1)]
            } else {
              promptMsgs = [createMessage('system', systemText), ...promptMsgs]
            }
            // Label history assistants with catalog names for multi-agent context
            promptMsgs = promptMsgs.map((m) => {
              if (m.role === 'assistant' && m.agentId && !m.name) {
                const named = getAgentDetailById(m.agentId)
                return named ? { ...m, name: named.name } : m
              }
              return m
            })

            // Multi-agent: history often ends on assistant after prior speakers. Providers
            // (esp. Gemini) frequently return empty completions unless the last message is user.
            if (roomMulti) {
              const lastPrompt = promptMsgs[promptMsgs.length - 1]
              if (lastPrompt?.role === 'assistant') {
                const role = roomRole ?? 'turn'
                promptMsgs = [
                  ...promptMsgs,
                  createMessage(
                    'user',
                    buildRoomContinuePrompt(speakerName, role, {
                      roomMode: options?.roomMode,
                      taskTitle: options?.taskTitle,
                      stoppedEarly: options?.swarmStoppedEarly,
                    })
                  ),
                ]
              }
            }
          }
        }

        // Global always-on SessionStart (once) + PreTurn, then agent/copilot pre hooks
        // (skip multi-agent room for cost/noise)
        if (!roomMulti) {
          try {
            const { runHooks } = await import('@/packages/hooks')
            const { mergeHooksList, refreshAgentHooks, pushHookAudit, loadHookOverrides, claimSessionStart } =
              await import('@/stores/hooksStore')
            await refreshAgentHooks()
            const overrides = await loadHookOverrides()
            const globalHooks = mergeHooksList(overrides)
            const shellEnabled = false

            if (claimSessionStart(sessionId)) {
              const sessionStart = await runHooks({
                event: 'SessionStart',
                hooks: globalHooks,
                shellEnabled,
                sessionId,
                onRun: pushHookAudit,
              })
              if (sessionStart.injectText) {
                promptMsgs.unshift(createMessage('system', sessionStart.injectText))
              }
            }

            const globalPre = await runHooks({
              event: 'PreTurn',
              hooks: globalHooks,
              shellEnabled,
              sessionId,
              onRun: pushHookAudit,
            })
            if (globalPre.injectText) {
              promptMsgs.unshift(createMessage('system', globalPre.injectText))
            }
          } catch {
            // non-fatal
          }
        }
        const preHookContext =
          !roomMulti && isAgentEnabled && copilotOverrides?.hooks?.preTurn
            ? await (await import('@/packages/copilot-hooks')).executePreHooks(copilotOverrides.hooks.preTurn)
            : ''
        if (preHookContext) {
          promptMsgs.unshift(createMessage('system', preHookContext))
        }

        // Check for existing plan in targetMsg (for 2-phase execution)
        const existingPlanPart = targetMsg.contentParts.find((part): part is MessagePlanPart => part.type === 'plan')
        const isExecutionPhase = existingPlanPart?.status === 'approved'
        activeExecutionPlan = isExecutionPhase ? existingPlanPart : undefined

        // If we have an approved plan, inject it into the prompt for context
        if (isExecutionPhase && existingPlanPart) {
          const workspaceHint =
            'Project files require a native Open Folder binding. Pasted paths cannot authorize access. Generic project shell is unavailable.'
          const planInjection = createMessage(
            'system',
            `## APPROVED EXECUTION PLAN\n\n${existingPlanPart.planText}\n\nProceed with executing this plan using all available tools.\n\n${workspaceHint}`
          )
          promptMsgs.unshift(planInjection)
        }

        // Continue on a stopped plan: the stopped run's work stays on screen, and the model sees it and where it stopped.
        const resumedParts =
          options?.resumePlanRun && isExecutionPhase && canResumePlan(existingPlanPart)
            ? resumedRunParts(targetMsg.contentParts)
            : []
        // Only the main stream gets the resume turns; the closing-answer stream already sends the message's parts.
        const mainPromptMsgs =
          resumedParts.length > 0
            ? [...promptMsgs, { ...targetMsg, contentParts: resumedParts }, createMessage('user', planResumePrompt())]
            : promptMsgs
        // Knowledge and memory rank against the person's last turn, not the resume note.
        const lastUserTurn = [...promptMsgs].reverse().find((m) => m.role === 'user')
        const resumeQuery =
          resumedParts.length > 0 && lastUserTurn ? getMessageText(lastUserTurn, false, false).trim() : undefined

        const modifyMessageCache: OnResultChangeWithCancel = async (updated) => {
          if (updated.tokenSpeed !== undefined) {
            lastTokenSpeed = updated.tokenSpeed
          }
          // Register abort in module Map — cancel fn is stripped on JSON persist / cross-window.
          if (updated.cancel) {
            registerGenerationCancel(sessionId, targetMsg.id, updated.cancel)
          }
          // Merge first, then measure — textLength from pre-merge targetMsg lagged by one callback
          // and delayed status clear / firstTokenLatency after the first readable content.
          const nextContentParts = updated.contentParts
            ? withPlanPart(updated.contentParts, activeExecutionPlan)
            : targetMsg.contentParts
          const mergedPreview = { ...targetMsg, contentParts: nextContentParts }
          const textLength = getMessageText(mergedPreview, true, true).length
          if (!firstTokenLatency && textLength > 0) {
            firstTokenLatency = Date.now() - startTime
          }
          // Direct field merge instead of pickBy(updated, identity) + spread.
          // pickBy with identity drops falsy values (0, false, '') which is a silent bug;
          // explicit assignment is both faster and more correct.
          targetMsg = {
            ...targetMsg,
            // Hard-keep generating true on every stream paint — cache merges must never flash idle.
            generating: true,
            contentParts: nextContentParts,
            cancel: updated.cancel ?? targetMsg.cancel,
            status: textLength > 0 ? [] : targetMsg.status,
            firstTokenLatency,
            tokenSpeed: lastTokenSpeed,
          }
          // Throttled UI/cache writes; storage still flushes on interval inside flushStreamUi
          await flushStreamUi(targetMsg)
        }

        // 2-phase execution: if planMode and not yet approved, generate plan first
        // Team room: full tools on do/deliver; swarm plan = task tools only; else tools-off
        const { roomAllowsArmedTools, roomRoleAllowsTaskToolsOnly, roomRoleAllowsTools } = await import(
          '@shared/agent-room'
        )
        const roomRoleForTools = options?.roomRole ?? targetMsg.roomRole
        const roomModeForTools = options?.roomMode
        const roomToolsAllowed = Boolean(roomMulti && roomRoleAllowsTools(roomRoleForTools))
        const roomTaskToolsOnly = Boolean(roomMulti && roomRoleAllowsTaskToolsOnly(roomRoleForTools, roomModeForTools))
        const isPlanMode = Boolean(!roomMulti && isAgentEnabled && session.agentMode && effectiveSettings.planMode)
        const isPendingPlan = existingPlanPart?.status === 'pending'
        managesPlanPhase = isPlanMode || executionRun

        // Determine which tools to use based on phase
        let toolsToUse: ToolSet | undefined
        let planningToolsInstructions = ''
        const executionAgentImageFlowInstructions =
          toolsOffForTurn || (roomMulti && !roomToolsAllowed) || !(!isPlanMode || isExecutionPhase)
            ? undefined
            : agentImageFlowInstructions

        if (isPlanMode && !isExecutionPhase) {
          // Planning phase: use read-only tools
          const readonlyTools = await getReadOnlyToolsForPlanning(
            knowledgeBase ? { id: knowledgeBase.id, name: knowledgeBase.name } : undefined
          )
          toolsToUse = readonlyTools.tools
          planningToolsInstructions = readonlyTools.instructions
        }
        // Room multi without tools: empty object = no tools (undefined still attaches MCP/web).
        if (roomMulti && !roomToolsAllowed && !roomTaskToolsOnly) {
          toolsToUse = {}
        }
        // Swarm plan: only checklist tools so lead cannot free-run MCP/web as "plan"
        if (roomTaskToolsOnly) {
          const taskTracking = await import('@/packages/model-calls/toolsets/task-tracking')
          toolsToUse = { ...taskTracking.CANONICAL_TASK_TOOLS } as ToolSet
          // stream-text skips default task instructions when custom tools are passed
          await taskStore.getState().hydrateSessionTasks(sessionId)
          planningToolsInstructions =
            (taskTracking.default?.description || '') +
            formatActiveTaskContext(taskStore.getState().getSessionTasks(sessionId))
        }
        // Answer without tools: empty object = no tools (undefined still attaches MCP), and no tool instructions.
        if (toolsOffForTurn) {
          toolsToUse = {}
          planningToolsInstructions = ''
        }

        // Inject planning tools instructions into system prompt if in planning phase
        if (planningToolsInstructions) {
          const planningSystemMsg = createMessage('system', planningToolsInstructions)
          promptMsgs.unshift(planningSystemMsg)
        }

        // Skills: progressive catalog + activated bodies (explicit $ / pin / auto)
        // Ensure agent folders have been scanned at least once this session.
        try {
          await refreshAgentSkills()
        } catch {
          // non-fatal — builtins + user skills still work
        }
        try {
          await refreshAgentCommands()
        } catch {
          // non-fatal
        }
        const priorUserMsg = [...messages.slice(0, targetMsgIx)].reverse().find((m) => m.role === 'user')
        const storedUserSkills = getDefaultStore().get(userSkillsAtom)
        const skillPackages = mergeSkillsList(Array.isArray(storedUserSkills) ? storedUserSkills : [])
        const skillActivations = firstHandoff?.skipSkillContext
          ? []
          : resolveSkillActivations({
              skills: skillPackages,
              explicitSkillIds: priorUserMsg?.skillIds,
              pinnedSkillIds: session.pinnedSkillIds,
              userText: priorUserMsg ? getMessageText(priorUserMsg) : '',
              autoSkills: session.autoSkills,
            })
        const skillById = new Map(skillPackages.map((s) => [s.id, s]))
        const skillCatalog = selectCatalogForInject(skillPackages, skillActivations)
        const skillContext = firstHandoff?.skipSkillContext
          ? ''
          : buildSkillContextBlocks(skillCatalog, skillActivations, skillById)
        if (skillContext) {
          promptMsgs.unshift(createMessage('system', skillContext))
        }

        // Commands: explicit / tags only (never auto)
        const storedUserCommands = getDefaultStore().get(userCommandsAtom)
        const commandPackages = mergeCommandsList(Array.isArray(storedUserCommands) ? storedUserCommands : [])
        const commandActivations = resolveCommandActivations({
          commands: commandPackages,
          explicitCommandIds: priorUserMsg?.commandIds,
        })
        const commandById = new Map(commandPackages.map((c) => [c.id, c]))
        const commandContext = firstHandoff?.skipCommandContext
          ? ''
          : buildCommandContextBlocks(commandActivations, commandById)
        if (commandContext) {
          promptMsgs.unshift(createMessage('system', commandContext))
        }

        // Connected accounts: labels/ids only — never secrets (message chips > session sticky)
        try {
          const { ensureIntegrationsStoreInit, integrationsStore } = await import('@/stores/integrationsStore')
          const { buildIntegrationsContextBlock } = await import('@shared/integrations')
          await ensureIntegrationsStoreInit()
          const catalog = integrationsStore.getState().catalog
          const turnCredentialIds = priorUserMsg?.credentialIds?.length
            ? priorUserMsg.credentialIds
            : session.credentialIds?.length
              ? session.credentialIds
              : undefined
          const integrationsContext = firstHandoff?.skipIntegrationsContext
            ? ''
            : buildIntegrationsContextBlock(catalog, {
                credentialIds: turnCredentialIds,
              })
          if (integrationsContext) {
            promptMsgs.unshift(createMessage('system', integrationsContext))
          }
        } catch {
          // non-fatal — tools may still resolve defaults
        }

        // Show skill/command chips on normal replies, team answer, or work deliverable
        const showSkillChips =
          skillActivations.length > 0 &&
          (!roomMulti ||
            options?.roomRole === 'synthesis' ||
            options?.roomRole === 'do' ||
            options?.roomRole === 'deliver' ||
            !options?.roomRole)
        const showCommandChips =
          commandActivations.length > 0 &&
          (!roomMulti ||
            options?.roomRole === 'synthesis' ||
            options?.roomRole === 'do' ||
            options?.roomRole === 'deliver' ||
            !options?.roomRole)
        if (showSkillChips || showCommandChips) {
          targetMsg = {
            ...targetMsg,
            ...(showSkillChips ? { skillActivations } : {}),
            ...(showCommandChips ? { commandActivations } : {}),
          }
          await modifyMessage(sessionId, targetMsg, false, true)
        }

        // Agent coding tools: solo agent execute, or team Work/Swarm do/deliver with agentMode
        const isAgentExecuteTurn =
          (!roomMulti && isAgentEnabled && Boolean(session.agentMode) && (!isPlanMode || isExecutionPhase)) ||
          (roomToolsAllowed && isAgentEnabled && Boolean(session.agentMode))

        // Room chat with no tools: strip web/KB and single-step. Swarm plan keeps multi-step for create_task×N.
        const roomBlocksExternalTools = roomMulti && !roomToolsAllowed
        const roomMaxSteps = roomTaskToolsOnly
          ? Math.min(maxSteps ?? COPILOT_MAX_STEPS_DEFAULT, MAX_SWARM_TASKS + 4)
          : roomBlocksExternalTools
            ? 1
            : maxSteps

        // What the stream last showed, as streamText would return it when stopped (see the catch below).
        let lastStreamedParts: Message['contentParts'] = []
        const { result, knowledgeIds } = await streamText(model, {
          sessionId: session.id,
          knowledgeScopeId: getEffectiveProjectId(session) ?? null,
          scopeId: getEffectiveProjectId(session),
          knowledgeQuery: resumeQuery,
          messages: mainPromptMsgs,
          sessionSettings: effectiveSettings,
          onResultChangeWithCancel: (updated) => {
            if (updated.contentParts) lastStreamedParts = updated.contentParts
            return modifyMessageCache(resumedParts.length > 0 ? withResumedParts(resumedParts, updated) : updated)
          },
          onStatusChange: (status) => {
            targetMsg = {
              ...targetMsg,
              status: status ? [status] : [],
            }
            void modifyMessage(sessionId, targetMsg, false, true)
          },
          providerOptions: effectiveSettings.providerOptions,
          // Discuss/plan/review: pure chat. Work/Swarm do/deliver: allow tools/web like solo agent.
          // Swarm plan: task tools only (no KB/web).
          knowledgeBase: firstHandoff || roomBlocksExternalTools || toolsOffForTurn ? undefined : knowledgeBase,
          webBrowsing: firstHandoff || roomBlocksExternalTools || toolsOffForTurn ? false : webBrowsing,
          nativeWebSearch:
            firstHandoff || roomBlocksExternalTools || toolsOffForTurn
              ? undefined
              : useGeminiGrounding
                ? 'gemini-grounding'
                : undefined,
          agentImageFlowInstructions: executionAgentImageFlowInstructions,
          // Default chat image generate/edit (provider-neutral) when tools are available.
          enableImageGenerationTool:
            !firstHandoff && !roomBlocksExternalTools && !toolsOffForTurn && model.isSupportToolUse(),
          imageGenerationMessageId: targetMsg.id,
          agentCoding: await (async () => {
            const enabled = !firstHandoff && !toolsOffForTurn && isAgentExecuteTurn
            const projectId = session.projectId || session.folderId
            let capabilityId: string | undefined
            let rootGeneration: string | undefined
            const { getProjectWorkspaceFlags } = await import('@/projects/flags')
            const { platformCapabilities } = await import('@/platform')
            if (
              enabled &&
              projectId &&
              platform.restoreProjectBinding &&
              platformCapabilities.supportsProjectWorkspace
            ) {
              try {
                const desc = await platform.restoreProjectBinding(projectId)
                if (desc?.status === 'ready' && desc.capabilityId) {
                  capabilityId = desc.capabilityId
                  rootGeneration = desc.rootGeneration
                  if (desc.trust?.instructions === 'allowed') {
                    const { loadTrustedProjectInstructions, formatInstructionContext } = await import(
                      '@/projects/project-instructions'
                    )
                    const sources = await loadTrustedProjectInstructions({
                      capabilityId,
                      instructionsTrust: desc.trust.instructions,
                    })
                    const text = formatInstructionContext(sources)
                    if (text) {
                      promptMsgs.unshift(createMessage('system', text))
                    }
                  }
                }
              } catch {
                // chat-only / missing binding
              }
            }
            return {
              enabled,
              workspaceRoot: undefined,
              capabilityId,
              projectId,
              rootGeneration,
              mutationEnabled: getProjectWorkspaceFlags().mutationEnabled,
              sessionId: session.id,
              turnId: targetMsg.id,
            }
          })(),
          // Browser / computer: desktop + master settings + session arm; Discuss/non-do-deliver off (D10)
          browserAgent: (() => {
            // Only a room run gates them; a solo answer in a chat with several agents keeps them (Swarm off).
            const roomAllowed = roomAllowsArmedTools({
              roomMulti,
              roomMode: options?.roomMode ?? session.roomMode,
              roomToolsAllowed,
              roomBlocksExternalTools,
            })
            return {
              armed: !firstHandoff && !toolsOffForTurn && Boolean(session.browserArmed) && roomAllowed,
              sessionId,
              workspaceRoot: undefined,
              runId: targetMsg.id,
              roomAllowed,
            }
          })(),
          computerUse: (() => {
            // Only a room run gates them; a solo answer in a chat with several agents keeps them (Swarm off).
            const roomAllowed = roomAllowsArmedTools({
              roomMulti,
              roomMode: options?.roomMode ?? session.roomMode,
              roomToolsAllowed,
              roomBlocksExternalTools,
            })
            return {
              armed: !firstHandoff && !toolsOffForTurn && Boolean(session.computerArmed) && roomAllowed,
              sessionId,
              // Act tools only when computerArmed (observe+act share arm; master setting gates tools)
              allowAct: !firstHandoff && !toolsOffForTurn && Boolean(session.computerArmed),
              roomAllowed,
            }
          })(),
          maxSteps: firstHandoff || toolsOffForTurn ? 1 : roomMaxSteps,
          tools: firstHandoff || toolsOffForTurn ? {} : toolsToUse,
          toolAccess: firstHandoff ? firstHandoff.toolAccess : copilotOverrides?.toolAccess,
          memory: speakerAgentId
            ? {
                agentId: speakerAgentId,
                agentName: getAgentDetailById(speakerAgentId)?.name || targetMsg.name || speakerAgentId,
                userQuery: resumeQuery,
              }
            : resumeQuery
              ? { userQuery: resumeQuery }
              : undefined,
        }).catch((error: unknown) => {
          // streamText resolves with the partial answer when Stop aborts it; a stream that rejects with an AbortError
          // after Stop is the same Stop, so the run settles as stopped (plan time kept, Continue offered), not failed.
          if (isAbortError(error) && wasGenerationCancelled(sessionId, targetMsg.id)) {
            const stopped: StreamTextResult = { contentParts: lastStreamedParts }
            return { result: stopped, knowledgeIds: [] as string[] }
          }
          throw error
        })
        // Read now: a visible-answer continue below registers a new abort function, which clears the Stop mark;
        // the continue stream's own Stop is read after it (finishExecutedPlan takes both).
        const stoppedDuringStream = wasGenerationCancelled(sessionId, targetMsg.id)

        // The approved knowledge this answer was given with: kept on the message and recorded as a use.
        targetMsg = { ...targetMsg, knowledgeIds }
        if (knowledgeIds.length) {
          void import('@/packages/knowledge/uses')
            .then(({ recordKnowledgeUse }) =>
              recordKnowledgeUse(knowledgeIds, { type: 'chat', id: session.id, label: session.name })
            )
            .catch((error) => knowledgeLog.error('Failed to record knowledge use:', error))
        }

        // Knowledge proposals from this turn (non-blocking): they wait under the answer and in Review.
        void import('@/packages/knowledge/chat-proposer')
          .then(({ proposeFromChatTurn }) =>
            proposeFromChatTurn({
              sessionId,
              sessionName: session.name,
              messageId: targetMsg.id,
              scopeId: getEffectiveProjectId(session) ?? null,
              messages: [...messages.slice(0, targetMsgIx + 1), targetMsg],
              sessionSettings: effectiveSettings,
            })
          )
          .catch((error) => knowledgeLog.error('Failed to propose knowledge from chat:', error))

        if (firstHandoff && session.continuationLineage) {
          const consumed = markHandoffConsumed({ ...session.continuationLineage, pendingExcerpts: undefined })
          await chatStore.updateSessionWithMessages(sessionId, (current) => {
            if (!current) {
              throw new Error(`Session ${sessionId} not found`)
            }
            return { ...current, continuationLineage: consumed }
          })
        }

        // Extract plan text from result if in planning phase
        const planTextFromResult = result.text ?? ''

        // Determine final plan status
        // If we already had an approved plan, keep it approved (execution phase)
        // If we just got a pending plan, mark it pending
        // If we're in execution phase with no existing plan, no plan part needed
        let finalPlanPart: MessagePlanPart | undefined
        if (isExecutionPhase) {
          // Keep the approved plan, with or without plan mode (it may be off by now; dropping the part would lose the
          // plan); finishedAt is decided after the closing-answer stream below.
          finalPlanPart = existingPlanPart
        } else if (isPlanMode) {
          if (!isPendingPlan) {
            // New pending plan from this generation
            finalPlanPart = {
              type: 'plan',
              planText: planTextFromResult,
              status: 'pending',
              version: nextPlanVersion(messages, targetMsg.id),
            }
          } else {
            // This shouldn't happen - pending plan should already exist
            finalPlanPart = existingPlanPart
          }
        }

        // Build final content parts - remove any existing plan part and add the final one
        let finalContentParts: Message['contentParts'] = targetMsg.contentParts.filter((part) => part.type !== 'plan')
        // Backfill from result.text when streaming left contentParts empty (common on some providers)
        const hasTextPart = finalContentParts.some((p) => p.type === 'text' && p.text?.trim())
        if (!hasTextPart && result.text?.trim()) {
          finalContentParts = [{ type: 'text', text: result.text }, ...finalContentParts]
        }
        // Room multi: strip model-echoed "**Name:**" prefixes (UI already shows speaker header)
        if (roomMulti && (targetMsg.name || speakerAgentId)) {
          const speakerLabel = targetMsg.name || speakerAgentId || ''
          const prefixRe = new RegExp(
            `^\\*\\*\\s*${speakerLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*\\*\\*\\s*`,
            'i'
          )
          finalContentParts = finalContentParts.map((part) => {
            if (part.type !== 'text' || !part.text) return part
            return { ...part, text: part.text.replace(prefixRe, '') }
          })
        }
        if (finalPlanPart) {
          finalContentParts.push(finalPlanPart)
        }

        // Thought-in-tools (Gemini) often has the conclusion only in reasoning.
        // Lift it into a trailing answer so settle is not Worked-strip-only.
        let streamResult = result
        finalContentParts = withFallbackAnswerParts(finalContentParts)
        if (shouldContinueForVisibleAnswer(finalContentParts, streamResult.finishReason)) {
          const firstParts = finalContentParts
          const { result: continueResult } = await streamText(model, {
            sessionId: session.id,
            knowledgeScopeId: getEffectiveProjectId(session) ?? null,
            scopeId: getEffectiveProjectId(session),
            messages: [
              ...promptMsgs,
              { ...targetMsg, contentParts: firstParts },
              createMessage('user', buildVisibleAnswerContinuePrompt(firstParts)),
            ],
            sessionSettings: effectiveSettings,
            onResultChangeWithCancel: (updated) => {
              const next = updated.contentParts
                ? { ...updated, contentParts: mergeContinuedContentParts(firstParts, updated.contentParts) }
                : updated
              return modifyMessageCache(next)
            },
            onStatusChange: (status) => {
              targetMsg = {
                ...targetMsg,
                status: status ? [status] : [],
              }
              void modifyMessage(sessionId, targetMsg, false, true)
            },
            providerOptions: effectiveSettings.providerOptions,
            maxSteps: 1,
            tools: {},
            webBrowsing: false,
            enableImageGenerationTool: false,
          })
          finalContentParts = withFallbackAnswerParts(
            mergeContinuedContentParts(firstParts, continueResult.contentParts || [])
          )
          if (!hasTextPart && continueResult.text?.trim()) {
            const hasTextAfter = finalContentParts.some((p) => p.type === 'text' && p.text?.trim())
            if (!hasTextAfter) {
              finalContentParts = [{ type: 'text', text: continueResult.text }, ...finalContentParts]
            }
          }
          streamResult = {
            ...streamResult,
            ...continueResult,
            contentParts: finalContentParts,
          }
        }

        // The run is over (main and closing-answer streams): a finished plan gets finishedAt, a stopped one none.
        if (isExecutionPhase && existingPlanPart) {
          finalPlanPart = finishExecutedPlan(existingPlanPart, {
            stoppedDuringStream,
            stoppedDuringContinue: wasGenerationCancelled(sessionId, targetMsg.id),
            now: Date.now(),
          })
          finalContentParts = withPlanPart(finalContentParts, finalPlanPart)
        }

        // Thought-only / dropped SSE still errors. Model tool-calls are visible work, not empty.
        const emptyCompletionError = buildEmptyCompletionError(finalContentParts, streamResult.finishReason)

        // Paint answer + generating=false first — never block the "done" state on image-flow I/O.
        clearGenerationCancel(sessionId, targetMsg.id)
        clearGenerationCancelled(sessionId, targetMsg.id)
        clearSessionGenerationLive(sessionId, targetMsg.id)
        // Release browser run mutex so the next turn can use tools (keep host/process warm).
        void import('@/packages/browser/lock')
          .then(({ releaseBrowserLock }) => releaseBrowserLock(sessionId, targetMsg.id))
          .catch(() => {})
        targetMsg = {
          ...targetMsg,
          generating: false,
          cancel: undefined,
          contentParts: finalContentParts,
          tokensUsed:
            targetMsg.tokensUsed ??
            streamResult.usage?.totalTokens ??
            estimateTokensFromMessages([...promptMsgs, targetMsg]),
          status: [],
          finishReason: streamResult.finishReason,
          usage: streamResult.usage,
          tokenSpeed: lastTokenSpeed ?? targetMsg.tokenSpeed,
          // Persist search citations extracted from tool calls or Gemini grounding
          citations: streamResult.citations ?? targetMsg.citations,
          searchQuery: streamResult.searchQuery ?? targetMsg.searchQuery,
          searchProvider: streamResult.searchProvider ?? targetMsg.searchProvider,
          groundingMetadata: streamResult.groundingMetadata ?? targetMsg.groundingMetadata,
          error: emptyCompletionError,
          // Only a finished answer shows how long it took; an empty completion is an error (R11).
          durationMs: emptyCompletionError ? undefined : Date.now() - runStartedAt,
        }
        await settleStreamUi(targetMsg)
        if (!emptyCompletionError) {
          // Answered: the next rate limit starts the schedule again, and a waiting Needs you for this chat is done,
          // except after one room turn (another agent may still be limited; the room run settles it when it ends).
          void rateLimitAnswered(sessionId, targetMsg.id, {
            roomTurn: Boolean(options?.roomMulti || targetMsg.roomRole),
          }).catch(() => {})
        }
        // The answer and the plan part (with finishedAt) are saved: from here the error path must keep this plan,
        // and nothing below may turn a finished turn into an error or file a second Change.
        if (isExecutionPhase) activeExecutionPlan = finalPlanPart
        try {
          // Optional image-flow append after the reply is already visible
          if (executionAgentImageFlowInstructions) {
            try {
              const fallbackGenerateImagePart = await maybeAutoStartAgentImageFlow(finalContentParts)
              if (fallbackGenerateImagePart) {
                targetMsg = {
                  ...targetMsg,
                  contentParts: [...(targetMsg.contentParts || []), fallbackGenerateImagePart],
                }
                await modifyMessage(sessionId, targetMsg, true)
              }
            } catch {
              // non-fatal
            }
          }

          await flushSessionTasks(sessionId)

          // Provider usage status: local rollup + clear exhausted on success
          try {
            const { providerUsageService } = await import('@/packages/usage-tracking')
            await providerUsageService.init()
            await providerUsageService.recordFromMessage(targetMsg, settingsStore.getState().usagePricingOverrides)
            const pid = String(effectiveSettings.provider ?? targetMsg.aiProvider ?? '')
            if (pid) {
              await providerUsageService.clearExhausted(pid)
              const budgetHit = await providerUsageService.evaluateAndMaybeNotify(settingsStore.getState(), pid)
              if (budgetHit?.shouldToast) {
                const { add: addToast } = await import('@/stores/toastActions')
                addToast(budgetHit.message)
              }
            }
          } catch {
            // non-fatal
          }

          // Local OS notification when unfocused (never includes message content)
          if (!roomMulti) {
            try {
              const { notifySystemEvent } = await import('@/packages/notifications')
              const sessionName = (await chatStore.getSession(sessionId))?.name || session.name || undefined
              void notifySystemEvent({
                kind: 'long_run_done',
                sessionId,
                sessionName,
                startedAt: runStartedAt,
              })
            } catch {
              // non-fatal
            }
          }

          if (isExecutionPhase) {
            try {
              await chatStore.updateSession(sessionId, { planPhase: undefined })
            } catch (error) {
              // The phase release failing must not cost the finished plan its Change entry.
              console.warn('[plan] Could not clear the execution phase', error)
            }
            // A finished plan with staged edits files one Change in Review (a stopped run has no finishedAt).
            if (finalPlanPart?.finishedAt !== undefined) {
              try {
                const current = (await chatStore.getSession(sessionId)) ?? session
                await recordFinishedPlan(current, targetMsg.id, finalPlanPart)
              } catch (error) {
                console.warn('[plan] Could not file the Change entry', error)
              }
            }
          }

          // Global PostTurn hooks, then agent/copilot post hooks
          if (!roomMulti) {
            const outputText =
              streamResult.text?.trim() ||
              finalContentParts
                .filter(
                  (part): part is Extract<(typeof finalContentParts)[number], { type: 'text' }> => part.type === 'text'
                )
                .map((part) => part.text)
                .join('\n')
                .trim()
            try {
              const { runHooks } = await import('@/packages/hooks')
              const { mergeHooksList, pushHookAudit, loadHookOverrides } = await import('@/stores/hooksStore')
              const overrides = await loadHookOverrides()
              const globalHooks = mergeHooksList(overrides)
              await runHooks({
                event: 'PostTurn',
                hooks: globalHooks,
                shellEnabled: false,
                sessionId,
                workspaceRoot: undefined,
                output: outputText,
                onRun: pushHookAudit,
              })
            } catch {
              // non-fatal
            }
            if (isAgentEnabled && copilotOverrides?.hooks?.postTurn) {
              const { executePostHooks } = await import('@/packages/copilot-hooks')
              await executePostHooks(copilotOverrides.hooks.postTurn, outputText)
            }
          }
        } catch (error) {
          // Post-turn work (tasks flush, usage, plan bookkeeping, hooks) never rewrites the settled message.
          console.warn('[generate] Post-turn work failed after the answer was saved', error)
        }

        // In plan mode with pending plan, don't process queued messages yet - wait for approval
        if (isPlanMode && !isExecutionPhase && !isPendingPlan) {
          // Planning phase just completed with pending plan - wait for user approval
          await chatStore.updateSession(sessionId, { planPhase: 'awaiting_approval' })
          shouldProcessQueuedMessages = false
          break
        }

        shouldProcessQueuedMessages = !options?.skipQueuedMessages
        break
      }
      // Picture message generation
      case 'picture': {
        // Take the most recent user message before the current message as prompt
        const userMessage = messages.slice(0, targetMsgIx).findLast((m) => m.role === 'user')
        if (!userMessage) {
          // Should not happen - user message not found
          throw new Error('No user message found')
        }

        const insertImage = async (image: MessageImagePart) => {
          targetMsg.contentParts.push(image)
          targetMsg.status = []
          await modifyMessage(sessionId, targetMsg, true)
        }
        await generateImage(
          model,
          {
            message: userMessage,
            num: effectiveSettings.imageGenerateNum || 1,
          },
          async (picBase64) => {
            const storageKey = StorageKeyGenerator.picture(`${session.id}:${targetMsg.id}`)
            // Image needs to be stored in indexedDB, if using OpenAI's image link directly, the link will expire over time
            await storage.setBlob(storageKey, picBase64)
            await insertImage({ type: 'image', storageKey })
          }
        )
        clearGenerationCancel(sessionId, targetMsg.id)
        clearGenerationCancelled(sessionId, targetMsg.id)
        clearSessionGenerationLive(sessionId, targetMsg.id)
        targetMsg = {
          ...targetMsg,
          generating: false,
          cancel: undefined,
          status: [],
        }
        await modifyMessage(sessionId, targetMsg, true)
        try {
          const { notifySystemEvent } = await import('@/packages/notifications')
          void notifySystemEvent({
            kind: 'long_run_done',
            sessionId,
            sessionName: session.name || undefined,
            startedAt: runStartedAt,
          })
        } catch {
          // non-fatal
        }
        shouldProcessQueuedMessages = true
        break
      }
      default:
        throw new Error(`Unknown session type: ${session.type}, generate failed`)
    }
    appleAppStore.tickAfterMessageGenerated()
  } catch (err: unknown) {
    const error = !(err instanceof Error) ? new Error(`${err}`) : err
    const isExpectedOCRError = error instanceof OCRError && error.cause instanceof BaseError
    if (
      !(
        error instanceof ApiError ||
        error instanceof NetworkError ||
        error instanceof AIProviderNoImplementedPaintError ||
        isExpectedOCRError
      )
    ) {
      Sentry.captureException(error) // unexpected error should be reported
    }
    let errorCode: number | undefined
    if (err instanceof BaseError) {
      errorCode = err.code
    }
    const ocrError = error instanceof OCRError ? error : undefined
    const causeError = ocrError?.cause
    // HTTP status and Retry-After of the failed call: they sort the error by its fix (bad key, credit, rate limit).
    const apiError = error instanceof ApiError ? error : causeError instanceof ApiError ? causeError : undefined
    clearGenerationCancel(sessionId, targetMsg.id)
    clearGenerationCancelled(sessionId, targetMsg.id)
    clearSessionGenerationLive(sessionId, targetMsg.id)
    void import('@/packages/browser/lock')
      .then(({ releaseBrowserLock }) => releaseBrowserLock(sessionId, targetMsg.id))
      .catch(() => {})
    targetMsg = {
      ...targetMsg,
      contentParts: withPlanPart(targetMsg.contentParts, activeExecutionPlan),
      generating: false,
      cancel: undefined,
      errorCode: ocrError ? (causeError instanceof BaseError ? causeError.code : errorCode) : errorCode,
      error: `${error.message}`,
      // Only a finished answer has a duration.
      durationMs: undefined,
      errorExtra: {
        aiProvider: ocrError ? ocrError.ocrProvider : effectiveSettings.provider,
        host:
          error instanceof NetworkError ? error.host : causeError instanceof NetworkError ? causeError.host : undefined,
        responseBody: apiError?.responseBody,
        ...(apiError?.status !== undefined ? { status: apiError.status } : {}),
        ...(apiError?.retryAfterMs !== undefined ? { retryAfterMs: apiError.retryAfterMs } : {}),
        // A retry of a failed Redo ▾ answers with the same picked model.
        ...(modelOverride ? { modelOverride } : {}),
      },
      status: [],
    }
    // Drop any in-flight stream patch so it cannot overwrite the error state
    await settleStreamUi(targetMsg)

    // Rate limited: retry on schedule, then ask in Review (ER3). A plan run or a room turn needs its own run options,
    // which a bare retry would lose: it goes to Review at once (R18, R20).
    if (classifyModelError(targetMsg) === 'rate-limit') {
      const ownRun = executionRun || Boolean(activeExecutionPlan) || Boolean(options?.roomMulti || targetMsg.roomRole)
      try {
        scheduleRateLimitRetry(sessionId, targetMsg, { autoRetry: !ownRun })
      } catch {
        // non-fatal: the notice still offers Retry
      }
    }

    // Mark provider plan exhausted on quota errors (best-effort)
    try {
      const pid = String(effectiveSettings.provider ?? '')
      if (pid) {
        const { providerUsageService } = await import('@/packages/usage-tracking')
        await providerUsageService.handleGenerationError({
          providerId: pid,
          modelId: effectiveSettings.modelId,
          message: error.message,
          responseBody: apiError?.responseBody,
          errorCode,
        })
      }
    } catch {
      // non-fatal
    }

    if (managesPlanPhase) {
      await chatStore.updateSession(sessionId, { planPhase: undefined })
    }
    shouldProcessQueuedMessages = !options?.skipQueuedMessages
  }

  await processSessionMessageQueue(sessionId, shouldProcessQueuedMessages)
}

/**
 * Insert and generate a new message below the target message
 * @param sessionId Session ID
 * @param msgId Message ID
 */
type GenerateMoreOptions = {
  modelOverride?: ModelOverride
  /** Redo of a Swarm answer: the new answer stays in that run so it keeps folding with it. */
  swarm?: Message['swarm']
}

export async function generateMore(sessionId: string, msgId: string, options?: GenerateMoreOptions) {
  const newAssistantMsg = createMessage('assistant', '')
  newAssistantMsg.generating = true // prevent estimating token count before generating done
  if (options?.swarm) newAssistantMsg.swarm = options.swarm
  await insertMessageAfter(sessionId, newAssistantMsg, msgId)
  const truncateTokenLimit = await getOverflowTruncateLimit(sessionId)
  await generate(sessionId, newAssistantMsg, {
    operationType: 'regenerate',
    truncateTokenLimit,
    modelOverride: options?.modelOverride,
  })
}

export async function generateMoreInNewFork(sessionId: string, msgId: string) {
  await createNewFork(sessionId, msgId)
  await generateMore(sessionId, msgId)
}

type GenerateMoreFn = (sessionId: string, msgId: string, options?: GenerateMoreOptions) => Promise<void>

export async function regenerateInNewFork(
  sessionId: string,
  msg: Message,
  options?: { runGenerateMore?: GenerateMoreFn; modelOverride?: ModelOverride }
) {
  const runGenerateMore = options?.runGenerateMore ?? generateMore
  const modelOverride = options?.modelOverride
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return
  }
  const location = findMessageLocation(session, msg.id)
  if (!location) {
    const truncateTokenLimit = await getOverflowTruncateLimit(sessionId)
    await generate(sessionId, msg, { operationType: 'regenerate', truncateTokenLimit, modelOverride })
    return
  }
  const previousMessageIndex = location.index - 1
  if (previousMessageIndex < 0) {
    // If target message is the first message, regenerate directly
    const truncateTokenLimit = await getOverflowTruncateLimit(sessionId)
    await generate(sessionId, msg, { operationType: 'regenerate', truncateTokenLimit, modelOverride })
    return
  }
  const forkMessage = location.list[previousMessageIndex]
  await createNewFork(sessionId, forkMessage.id)
  const moreOptions: GenerateMoreOptions = {
    ...(modelOverride ? { modelOverride } : {}),
    ...(msg.swarm ? { swarm: msg.swarm } : {}),
  }
  return Object.keys(moreOptions).length > 0
    ? runGenerateMore(sessionId, forkMessage.id, moreOptions)
    : runGenerateMore(sessionId, forkMessage.id)
}

/**
 * Build message context for prompt
 * Process message list, including:
 * - Use buildContextForAI to build context based on compaction points (if provided)
 * - Limit context message count based on maxContextMessageCount
 * - Add ATTACHMENT_FILE tag for file attachments
 * - Add ATTACHMENT_FILE tag for link attachments
 *
 * @param settings Session settings
 * @param msgs Original message list
 * @param modelSupportToolUseForFile Whether model supports file reading tool (if supported, file content is not directly included)
 * @param options Optional configuration
 * @param options.storageAdapter Optional storage adapter for reading file content (defaults to storage.getBlob)
 * @param options.compactionPoints Optional compaction points for building context from compression point
 * @returns Processed message list
 */
export async function genMessageContext(
  settings: SessionSettings,
  msgs: Message[],
  modelSupportToolUseForFile: boolean,
  options?: {
    storageAdapter?: { getBlob: (key: string) => Promise<string> }
    compactionPoints?: CompactionPoint[]
    truncateTokenLimit?: number
  }
) {
  const storageAdapter = options?.storageAdapter
  const compactionPoints = options?.compactionPoints
  const truncateTokenLimit = options?.truncateTokenLimit
  const storageGetBlob = storageAdapter?.getBlob ?? ((key: string) => storage.getBlob(key).catch(() => ''))
  const {
    // openaiMaxContextTokens,
    maxContextMessageCount,
  } = settings
  if (msgs.length === 0) {
    throw new Error('No messages to replay')
  }
  if (maxContextMessageCount === undefined) {
    throw new Error('maxContextMessageCount is not set')
  }

  // Step 1: Apply compaction-based context building if compactionPoints are provided
  // This will return messages starting from the latest compaction point (with summary prepended)
  // and apply tool-call cleanup for older messages
  let contextMessages = msgs
  if (compactionPoints && compactionPoints.length > 0) {
    contextMessages = buildContextForAI({
      messages: msgs,
      compactionPoints,
      keepToolCallRounds: 2,
      sessionSettings: settings,
    })
  }

  // Pre-fetch all blob contents in parallel to avoid N+1 sequential fetches
  // Skip video blobs (large binary data URLs) — videos only need metadata tags
  const allStorageKeys = new Set<string>()
  for (const msg of contextMessages) {
    if (msg.files) {
      for (const file of msg.files) {
        if (file.storageKey && file.mediaKind !== 'video') {
          allStorageKeys.add(file.storageKey)
        }
      }
    }
    if (msg.links) {
      for (const link of msg.links) {
        if (link.storageKey) {
          allStorageKeys.add(link.storageKey)
        }
      }
    }
  }
  const blobContents = new Map<string, string>()
  if (allStorageKeys.size > 0) {
    const keys = Array.from(allStorageKeys)
    const contents = await Promise.all(keys.map((key) => storageGetBlob(key)))
    keys.forEach((key, index) => {
      const content = contents[index]
      if (content !== null) {
        blobContents.set(key, content)
      }
    })
  }

  const head = contextMessages[0]?.role === 'system' ? contextMessages[0] : undefined
  const workingMsgs = head ? contextMessages.slice(1) : contextMessages

  let _totalLen = head ? (head.tokenCount ?? estimateTokensFromMessages([head])) : 0
  const prompts: Message[] = []
  for (let i = workingMsgs.length - 1; i >= 0; i--) {
    let msg = workingMsgs[i]
    // Skip error messages
    if (msg.error || msg.errorCode) {
      continue
    }
    const baseSize = (msg.tokenCount ?? estimateTokensFromMessages([msg])) + 20 // 20 as estimated error compensation
    // When truncating, always add attachment payload estimates since msg.tokenCount
    // may be stale or text-only and not reflect freshly attached files/links.
    let attachmentTokens = 0
    if (truncateTokenLimit !== undefined) {
      if (msg.files) {
        for (const file of msg.files) {
          if (file.storageKey) {
            const content = blobContents.get(file.storageKey)
            if (content) {
              attachmentTokens += Math.ceil(content.length / 4) // rough ~4 chars per token
            }
          }
        }
      }
      if (msg.links) {
        for (const link of msg.links) {
          if (link.storageKey) {
            const content = blobContents.get(link.storageKey)
            if (content) {
              attachmentTokens += Math.ceil(content.length / 4)
            }
          }
        }
      }
    }
    const size = baseSize + attachmentTokens
    // Only OpenAI supports context tokens limit
    if (settings.provider === 'openai') {
      // if (size + totalLen > openaiMaxContextTokens) {
      //     break
      // }
    }
    if (
      maxContextMessageCount < Number.MAX_SAFE_INTEGER &&
      prompts.length >= maxContextMessageCount + 1 // +1 to keep user's last input message
    ) {
      break
    }
    // Token-budget truncation: stop adding older messages when we'd exceed the limit
    if (truncateTokenLimit !== undefined && prompts.length > 0 && _totalLen + size > truncateTokenLimit) {
      break
    }

    let attachmentIndex = 1
    if (msg.files && msg.files.length > 0) {
      const videoLimits = getVideoLimits(platform.formFactor === 'desktop' ? 'desktop' : 'mobile')
      for (const file of msg.files) {
        if (!file.storageKey) {
          continue
        }

        // Video attachments: metadata only (frames already in contentParts as images)
        if (file.mediaKind === 'video') {
          msg = cloneMessage(msg)
          const attachment = buildVideoAttachmentWrapper({
            attachmentIndex: attachmentIndex++,
            fileName: file.name,
            fileKey: file.storageKey,
            durationSec: file.durationSec,
            byteLength: file.byteLength,
            width: file.width,
            height: file.height,
            sampledFrameCount: file.sampledFrameKeys?.length ?? 0,
            maxFramesPerTurn: videoLimits.maxFramesPerVideoPerTurn,
            toolEnabled: modelSupportToolUseForFile,
          })
          msg = mergeMessages(msg, createMessage(msg.role, attachment))
          continue
        }

        msg = cloneMessage(msg)
        const content = blobContents.get(file.storageKey) ?? ''
        if (content) {
          const fileLines = content.split('\n').length
          const shouldUseToolForThisFile = modelSupportToolUseForFile && fileLines > MAX_INLINE_FILE_LINES

          const prefix = buildAttachmentWrapperPrefix({
            attachmentIndex: attachmentIndex++,
            fileName: file.name,
            fileKey: file.storageKey,
            fileLines,
            fileSize: content.length,
          })

          let contentToAdd = content
          let isTruncated = false
          if (shouldUseToolForThisFile) {
            const lines = content.split('\n')
            contentToAdd = lines.slice(0, PREVIEW_LINES).join('\n')
            isTruncated = true
          }

          const suffix = buildAttachmentWrapperSuffix({
            isTruncated,
            previewLines: isTruncated ? PREVIEW_LINES : undefined,
            totalLines: isTruncated ? fileLines : undefined,
            fileKey: isTruncated ? file.storageKey : undefined,
          })

          const attachment = prefix + contentToAdd + '\n' + suffix
          msg = mergeMessages(msg, createMessage(msg.role, attachment))
        }
      }
    }
    if (msg.links && msg.links.length > 0) {
      for (const link of msg.links) {
        if (link.storageKey) {
          msg = cloneMessage(msg)
          const content = blobContents.get(link.storageKey) ?? ''
          if (content) {
            const linkLines = content.split('\n').length
            const shouldUseToolForThisLink = modelSupportToolUseForFile && linkLines > MAX_INLINE_FILE_LINES

            const prefix = buildAttachmentWrapperPrefix({
              attachmentIndex: attachmentIndex++,
              fileName: link.title,
              fileKey: link.storageKey,
              fileLines: linkLines,
              fileSize: content.length,
            })

            let contentToAdd = content
            let isTruncated = false
            if (shouldUseToolForThisLink) {
              const lines = content.split('\n')
              contentToAdd = lines.slice(0, PREVIEW_LINES).join('\n')
              isTruncated = true
            }

            const suffix = buildAttachmentWrapperSuffix({
              isTruncated,
              previewLines: isTruncated ? PREVIEW_LINES : undefined,
              totalLines: isTruncated ? linkLines : undefined,
              fileKey: isTruncated ? link.storageKey : undefined,
            })

            const attachment = prefix + contentToAdd + '\n' + suffix
            msg = mergeMessages(msg, createMessage(msg.role, attachment))
          }
        }
      }
    }

    prompts.push(msg)
    _totalLen += size
  }
  prompts.reverse()
  if (head) {
    prompts.unshift(head)
  }
  return prompts
}

/**
 * Find the thread message list that a message belongs to
 * @param sessionId Session ID
 * @param messageId Message ID
 * @returns The thread message list containing the message
 */
export async function getMessageThreadContext(sessionId: string, messageId: string): Promise<Message[]> {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return []
  }
  if (session.messages.find((m) => m.id === messageId)) {
    return session.messages
  }
  if (!session.threads) {
    return []
  }
  for (const t of session.threads) {
    if (t.messages.find((m) => m.id === messageId)) {
      return t.messages
    }
  }
  return []
}
