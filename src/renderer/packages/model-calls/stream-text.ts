import { google } from '@ai-sdk/google'
import { getModel } from '@shared/models'
import { OCRError, ProviderAPIError } from '@shared/models/errors'
import type { ModelDependencies } from '@shared/types/adapters'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { sequenceMessages } from '@shared/utils/message'
import { getModelSettings } from '@shared/utils/model_settings'
import { shouldPreserveReasoningInContext } from '@shared/utils/reasoning-replay'
import { searchResultsToCitations } from '@shared/utils/search'
import type { ModelMessage, ToolSet } from 'ai'
import { t } from 'i18next'
import { uniqueId } from 'lodash'
import { createModelDependencies } from '@/adapters'
import { getLogger } from '@/lib/utils'
import {
  fitKnowledgeToBudget,
  formatKnowledgeSection,
  isLegacyMemoryActive,
  knowledgeForTurn,
} from '@/packages/knowledge/for-turn'
import { NEVER_SEND_EMAIL } from '@/packages/knowledge/select'
import { ensureKnowledgeLoaded } from '@/packages/knowledge/store'
import { hostPreSearchMemories } from '@/packages/memory/host-presearch'
import { isSessionMemoryToolRetainAllowed } from '@/packages/memory/session-policy'
import { getMemoryToolSet, MEMORY_TOOL_NAMES } from '@/packages/memory/tools'
import platform from '@/platform'
import { ensureMemoryStoreInit, memoryStore } from '@/stores/memoryStore'
import { settingsStore } from '@/stores/settingsStore'
import { formatActiveTaskContext, taskStore } from '@/stores/taskStore'
import { getMessageText } from '@/utils/message'
import type {
  ModelInterface,
  OnResultChange,
  OnResultChangeWithCancel,
  OnStatusChange,
} from '../../../shared/models/types'
import type {
  CopilotToolAccess,
  KnowledgeBase,
  Message,
  MessageContentParts,
  MessageInfoPart,
  MessageToolCallPart,
  ProviderOptions,
  SearchResultItem,
  SessionSettings,
  StreamTextResult,
} from '../../../shared/types'
import { mcpController } from '../mcp/controller'
import { convertToModelMessages, injectModelSystemPrompt } from './message-utils'
import { imageOCR } from './preprocess'
import {
  combinedSearchByPromptEngineering,
  constructMessagesWithKnowledgeBaseResults,
  constructMessagesWithSearchResults,
  knowledgeBaseSearchByPromptEngineering,
  searchByPromptEngineering,
} from './tools'
import {
  createBrowserToolSet,
  getLastBrowserObservationEmbedded,
  getLastBrowserTool,
  resetBrowserTurnState,
  shouldForceBrowserSnapshot,
} from './toolsets/browser'
import {
  createComputerToolSet,
  getLastActEmbeddedScreenshot,
  getLastComputerTool,
  resetComputerScreenshotBudget,
} from './toolsets/computer'
import { pruneOldImageParts, shouldForceComputerScreenshot } from './toolsets/computer-harness'
import {
  clearComputerUiTargetApp,
  computerUiSpaceLockInstructions,
  filterToolsForComputerUiSpace,
} from './toolsets/computer-ui-lock'
import { attachmentFileToolSet, createWorkspaceFileToolSet } from './toolsets/file'
import generateImageToolSet, {
  buildChatImageCatalog,
  type ChatImageHandle,
  createGenerateImageTool,
  formatImageCatalogInstructions,
} from './toolsets/generate-image'
import { getToolSet } from './toolsets/knowledge-base'
import taskTrackingToolSet from './toolsets/task-tracking'
import videoToolSet, { initVideoToolBudget, resetVideoToolBudget } from './toolsets/video'
import videoUrlToolSet from './toolsets/video-url'
import websearchToolSet, { parseLinkTool, webSearchTool } from './toolsets/web-search'
import { wrapToolsWithApproval } from './wrap-tools-approval'

const knowledgeLog = getLogger('knowledge')

/** Agent coding context: enables workspace write tools when a native capability is ready. */
export type AgentCodingOptions = {
  /** True when agent mode is active and this turn may execute (not plan-only). */
  enabled: boolean
  /** Legacy reconnect hint only — never authority. */
  workspaceRoot?: string
  capabilityId?: string
  projectId?: string
  rootGeneration?: string
  mutationEnabled?: boolean
  sessionId?: string
  turnId?: string
}

/** Desktop browser agent tools (isolated Chromium). */
export type BrowserAgentOptions = {
  armed: boolean
  sessionId: string
  workspaceRoot?: string
  runId?: string
  /** Discuss/non-lead rooms force false at generation layer */
  roomAllowed?: boolean
}

/** Desktop computer use tools. */
export type ComputerUseOptions = {
  armed: boolean
  sessionId: string
  allowAct?: boolean
  roomAllowed?: boolean
}

const TASK_TRACKING_TOOL_NAMES = ['create_task', 'update_task', 'list_tasks'] as const

function areTaskToolsAllowed(toolAccess?: CopilotToolAccess): boolean {
  if (!toolAccess?.tools?.length) return true
  const accessSet = new Set(toolAccess.tools)
  if (toolAccess.mode === 'allowlist') {
    return TASK_TRACKING_TOOL_NAMES.every((name) => accessSet.has(name))
  }
  return TASK_TRACKING_TOOL_NAMES.every((name) => !accessSet.has(name))
}

function extractSearchMetadataFromToolCalls(result: StreamTextResult): Partial<StreamTextResult> {
  if (result.citations?.length) {
    return {}
  }

  const webSearchToolCallParts = result.contentParts.filter(
    (part): part is MessageToolCallPart<{ query?: string }, { query?: string; searchResults?: SearchResultItem[] }> =>
      part.type === 'tool-call' && part.toolName === 'web_search' && part.state === 'result'
  )
  const latestWebSearchCall = webSearchToolCallParts.at(-1)
  const searchResults = webSearchToolCallParts
    .flatMap((part) => part.result?.searchResults || [])
    .filter((result, index, results) => results.findIndex((candidate) => candidate.link === result.link) === index)

  if (!searchResults.length) {
    return {}
  }

  return {
    citations: searchResultsToCitations(searchResults, 'builtin'),
    searchQuery: latestWebSearchCall?.result?.query || latestWebSearchCall?.args?.query,
    searchProvider: settingsStore.getState().extension.webSearch.provider,
  }
}

function withSearchMetadata(result: StreamTextResult): StreamTextResult {
  return {
    ...result,
    ...extractSearchMetadataFromToolCalls(result),
  }
}

/**
 * (legacy comment removed)
 */
async function handleSearchResult(
  result: { query: string; searchResults: any[]; type?: 'knowledge_base' | 'web' | 'none' },
  toolName: string,
  model: ModelInterface,
  messages: Message[],
  coreMessages: ModelMessage[],
  controller: AbortController,
  onResultChange: OnResultChange,
  params: {
    providerOptions?: ProviderOptions
    onStatusChange?: OnStatusChange
    maxSteps?: number
    includeAssistantReasoning?: boolean
  },
  dependencies?: ModelDependencies
) {
  if (!result?.searchResults?.length || result.type === 'none') {
    const chatResult = await model.chat(coreMessages, {
      signal: controller.signal,
      onResultChange,
      onStatusChange: params.onStatusChange,
      maxSteps: params.maxSteps,
    })
    return { result: withSearchMetadata(chatResult), coreMessages }
  }

  const toolCallPart: MessageToolCallPart = {
    type: 'tool-call',
    state: 'result',
    toolCallId: `${result.type || toolName.replace('_', '')}_search_${uniqueId()}`,
    toolName,
    args: { query: result.query },
    result,
  }
  onResultChange({ contentParts: [toolCallPart] })

  const messagesWithResults =
    result.type === 'knowledge_base' || toolName === 'query_knowledge_base'
      ? constructMessagesWithKnowledgeBaseResults(messages, result.searchResults)
      : constructMessagesWithSearchResults(messages, result.searchResults)

  const chatResult = await model.chat(
    await convertToModelMessages(messagesWithResults, {
      modelSupportVision: true,
      dependencies,
      includeAssistantReasoning: params.includeAssistantReasoning,
    }),
    {
      signal: controller.signal,
      onResultChange: (data) => {
        if (data.contentParts) {
          onResultChange({ ...data, contentParts: [toolCallPart, ...data.contentParts] })
        } else {
          onResultChange(data)
        }
      },
      onStatusChange: params.onStatusChange,
      providerOptions: params.providerOptions,
      maxSteps: params.maxSteps,
    }
  )
  return { result: withSearchMetadata(chatResult), coreMessages }
}

async function ocrMessages(messages: Message[], dependencies: ModelDependencies) {
  const settings = settingsStore.getState().getSettings()
  const hasUserOcrModel = settings.ocrModel?.provider && settings.ocrModel?.model

  if (!hasUserOcrModel) {
    // OCR now only uses user-configured models in this build.
    throw ProviderAPIError.fromCodeName('model_not_support_image_2', 'model_not_support_image_2')
  }

  const ocrModelSetting = settings.ocrModel
  if (!ocrModelSetting) {
    throw ProviderAPIError.fromCodeName('model_not_support_image_2', 'model_not_support_image_2')
  }
  const ocrProviderName = ocrModelSetting.provider
  try {
    const modelSettings = getModelSettings(settings, ocrModelSetting.provider, ocrModelSetting.model)
    const ocrModel = getModel(modelSettings, settings, { uuid: '123' }, dependencies)
    await imageOCR(ocrModel, messages)
  } catch (err) {
    throw new OCRError(ocrProviderName, err instanceof Error ? err : new Error(`${err}`))
  }
}

export { wrapToolsWithApproval } from './wrap-tools-approval'

const MCP_TOOL_PREFIX = 'mcp__'

/**
 * Filter tools based on copilot's toolAccess configuration.
 * - allowlist: only include tools whose names are in the tools array
 * - denylist: exclude tools whose names are in the tools array
 * - includeMcp: when false, excludes all MCP tools regardless of allowlist/denylist
 */
function filterToolsByAccess(tools: ToolSet, toolAccess?: CopilotToolAccess): ToolSet {
  if (!toolAccess) {
    return tools
  }

  const { mode, tools: accessTools, includeMcp = true } = toolAccess

  // If includeMcp is false, filter out all MCP tools first
  let filteredTools = tools
  if (includeMcp === false) {
    filteredTools = Object.fromEntries(Object.entries(tools).filter(([name]) => !name.startsWith(MCP_TOOL_PREFIX)))
  }

  // If no access tools specified, return filtered tools as-is
  if (!accessTools || accessTools.length === 0) {
    return filteredTools
  }

  const accessSet = new Set(accessTools)

  if (mode === 'allowlist') {
    // Only include tools that are in the access list
    return Object.fromEntries(Object.entries(filteredTools).filter(([name]) => accessSet.has(name)))
  } else {
    // denylist: exclude tools that are in the access list
    return Object.fromEntries(Object.entries(filteredTools).filter(([name]) => !accessSet.has(name)))
  }
}

/**
 * (legacy comment removed)
 */
export async function streamText(
  model: ModelInterface,
  params: {
    sessionId?: string
    messages: Message[]
    sessionSettings?: Partial<SessionSettings>
    onResultChangeWithCancel: OnResultChangeWithCancel
    onStatusChange?: OnStatusChange
    providerOptions?: ProviderOptions
    knowledgeBase?: Pick<KnowledgeBase, 'id' | 'name'>
    webBrowsing?: boolean
    nativeWebSearch?: 'gemini-grounding'
    agentImageFlowInstructions?: string
    /** When true, expose generate_image for ordinary default chat (not only ComfyUI agent flow). */
    enableImageGenerationTool?: boolean
    /** Assistant message id used to attach generated images back into chat. */
    imageGenerationMessageId?: string
    /** Prebuilt image handles for editing; if omitted, derived from messages. */
    imageCatalog?: ChatImageHandle[]
    /** Desktop agent coding: workspace file write + terminal (not gated on attachments). */
    agentCoding?: AgentCodingOptions
    browserAgent?: BrowserAgentOptions
    computerUse?: ComputerUseOptions
    tools?: ToolSet
    maxSteps?: number
    toolAccess?: CopilotToolAccess
    allowedTools?: string[]
    /** Long-term memory inject context (agent scope + inject options) */
    memory?: {
      agentId?: string
      agentName?: string
      forceHybridFallback?: boolean
      userQuery?: string
    }
    /** The session's scope for approved knowledge; null or omitted means Everywhere. */
    knowledgeScopeId?: string | null
    /** What knowledge is ranked against; omitted means the last user message (a resumed plan run passes the person's turn). */
    knowledgeQuery?: string
  },
  signal?: AbortSignal
): Promise<{ result: StreamTextResult; coreMessages: ModelMessage[]; knowledgeIds: string[] }> {
  const {
    knowledgeBase,
    webBrowsing,
    sessionId,
    sessionSettings,
    nativeWebSearch,
    toolAccess,
    allowedTools,
    agentImageFlowInstructions,
    enableImageGenerationTool,
    imageGenerationMessageId,
    imageCatalog: providedImageCatalog,
    agentCoding,
    browserAgent,
    computerUse,
    tools: customTools,
    memory: memoryContext,
    knowledgeScopeId,
  } = params
  const globalSettings = settingsStore.getState().getSettings()
  const hasDocumentFileOrLink = params.messages.some(
    (m) => m.links?.length || m.files?.some((f) => f.mediaKind !== 'video')
  )
  const hasVideoAttachment = params.messages.some((m) => m.files?.some((f) => f.mediaKind === 'video'))

  const controller = new AbortController()
  const cancel = () => controller.abort()
  if (signal) {
    signal.addEventListener('abort', cancel, { once: true })
  }

  let result: StreamTextResult = {
    contentParts: [],
  }
  let coreMessages: ModelMessage[] = []

  // Create dependencies once for the entire pipeline
  const dependencies = await createModelDependencies()

  // for model not support tool use, use prompt engineering to handle knowledge base and web search
  // Attachment tools (fileKey) only when user uploaded files/links
  const needAttachmentFileToolSet = hasDocumentFileOrLink && model.isSupportToolUse()
  const workspaceRoot = agentCoding?.workspaceRoot?.trim() || ''
  const capabilityId = agentCoding?.capabilityId?.trim() || ''
  const mutationEnabled = Boolean(agentCoding?.mutationEnabled)
  const needWorkspaceCodingTools =
    Boolean(agentCoding?.enabled) &&
    Boolean(capabilityId) &&
    mutationEnabled &&
    platform.type === 'desktop' &&
    model.isSupportToolUse()
  const needVideoToolSet = hasVideoAttachment && model.isSupportToolUse() && model.isSupportVision()
  // Public video URL reader — independent of local video attachments
  const videoUrlExtension = settingsStore.getState().extension?.videoUrl
  const needVideoUrlToolSet = videoUrlExtension?.enabled !== false && model.isSupportToolUse()
  const kbNotSupported = knowledgeBase && !model.isSupportToolUse('knowledge-base')
  const webNotSupported = webBrowsing && !model.isSupportToolUse('web-browsing')
  const workspaceFileToolSet = needWorkspaceCodingTools
    ? createWorkspaceFileToolSet({
        capabilityId,
        projectId: agentCoding?.projectId || '',
        rootGeneration: agentCoding?.rootGeneration || '',
        mutationEnabled,
        sessionId: agentCoding?.sessionId || params.sessionId || '',
        turnId: agentCoding?.turnId || '',
      })
    : null
  const terminalToolSet = null

  // Computer use (observe / act) — preferred exclusive lease over browser when both armed
  const computerExt = globalSettings.extension?.computerUse
  const needComputerTools =
    Boolean(computerUse?.armed) &&
    computerUse?.roomAllowed !== false &&
    Boolean(computerExt?.enabled) &&
    platform.type === 'desktop' &&
    model.isSupportToolUse() &&
    Boolean(computerUse?.sessionId || sessionId)
  const computerSessionId = computerUse?.sessionId || sessionId || ''

  // Browser agent (desktop + master enabled + session armed + tool use + room allowed).
  // Skip when Computer Use owns the turn (exclusive interaction space).
  const browserExt = globalSettings.extension?.browserAgent
  const needBrowserTools =
    !needComputerTools &&
    Boolean(browserAgent?.armed) &&
    browserAgent?.roomAllowed !== false &&
    Boolean(browserExt?.enabled) &&
    platform.type === 'desktop' &&
    model.isSupportToolUse() &&
    Boolean(browserAgent?.sessionId || sessionId)
  const browserSessionId = browserAgent?.sessionId || sessionId || ''
  const browserToolSet = needBrowserTools
    ? createBrowserToolSet({
        sessionId: browserSessionId,
        runId: browserAgent?.runId,
        workspaceRoot: browserAgent?.workspaceRoot || workspaceRoot,
      })
    : null

  if (needComputerTools && computerSessionId) {
    resetComputerScreenshotBudget(computerSessionId)
  }
  if (needBrowserTools && browserSessionId) {
    resetBrowserTurnState(browserSessionId)
  }
  let computerUserText = ''
  if (needComputerTools) {
    for (let i = params.messages.length - 1; i >= 0; i--) {
      const m = params.messages[i]
      if (m.role === 'user') {
        computerUserText = getMessageText(m, false, false).trim()
        if (computerUserText) break
      }
    }
  }
  const computerToolSet = needComputerTools
    ? createComputerToolSet({
        sessionId: computerSessionId,
        allowAct: Boolean(computerUse?.allowAct),
        visionSupported: model.isSupportVision(),
        userText: computerUserText,
      })
    : null

  // Seed video frame budget with auto-sampled frames already attached
  if (needVideoToolSet) {
    const preUsed = new Map<string, number>()
    for (const m of params.messages) {
      for (const f of m.files || []) {
        if (f.mediaKind === 'video' && f.storageKey && f.sampledFrameKeys?.length) {
          preUsed.set(f.storageKey, (preUsed.get(f.storageKey) ?? 0) + f.sampledFrameKeys.length)
        }
      }
    }
    initVideoToolBudget(platform.formFactor === 'desktop' ? 'desktop' : 'mobile', preUsed)
  } else {
    resetVideoToolBudget()
  }

  // 1. inject system prompt for tool use
  let toolSetInstructions = ''
  // (legacy comment removed)
  let kbToolSet = null
  if (knowledgeBase) {
    try {
      kbToolSet = await getToolSet(knowledgeBase.id, knowledgeBase.name)
    } catch (err) {
      console.error('Failed to load knowledge base toolset:', err)
    }
  }
  const mcpTools = wrapToolsWithApproval(sessionId, mcpController.getAvailableTools())
  // Task tools must be decided before grounding: Gemini forbids mixing provider tools
  // (google.tools.googleSearch) with function tools. Counting tasks too late caused
  // grounding + create_task together → INVALID_ARGUMENT / hung tool loops.
  const taskToolsAvailable =
    model.isSupportToolUse() &&
    !customTools &&
    areTaskToolsAllowed(toolAccess) &&
    (!allowedTools ||
      allowedTools.length === 0 ||
      TASK_TRACKING_TOOL_NAMES.every((name) => allowedTools.includes(name)))
  try {
    await ensureMemoryStoreInit()
    if (memoryContext?.agentId) {
      await memoryStore.getState().ensureAgentBank(memoryContext.agentId)
    }
  } catch {
    // non-fatal in tests / degraded storage
  }
  // A fresh read, so knowledge approved in another window (and the memory move's state) applies to this turn.
  const knowledgeScope = knowledgeScopeId ?? EVERYWHERE_SCOPE_ID
  try {
    await ensureKnowledgeLoaded({ fresh: true })
  } catch (err) {
    knowledgeLog.error('Failed to load knowledge:', err)
  }
  // Within the token budget, Everywhere facts ranked against the question; knowledgeIds is what was injected.
  const lastUserMessage = [...params.messages].reverse().find((m) => m.role === 'user')
  const knowledgeItems = fitKnowledgeToBudget(knowledgeScope, knowledgeForTurn(knowledgeScope), {
    query: params.knowledgeQuery ?? (lastUserMessage ? getMessageText(lastUserMessage, false, false) : ''),
  })
  const knowledgeIds = knowledgeItems.filter((i) => i.id !== NEVER_SEND_EMAIL.id).map((i) => i.id)
  const legacyMemoryActive = isLegacyMemoryActive()
  const memorySettings = memoryStore.getState().settings
  const memoryToolsAvailable =
    memorySettings.enabled &&
    legacyMemoryActive &&
    model.isSupportToolUse() &&
    !customTools &&
    (!allowedTools || allowedTools.length === 0 || MEMORY_TOOL_NAMES.some((name) => allowedTools.includes(name)))
  const imageCatalog =
    providedImageCatalog ||
    (enableImageGenerationTool || agentImageFlowInstructions ? buildChatImageCatalog(params.messages) : [])
  const needGenerateImageTool =
    model.isSupportToolUse() && (Boolean(agentImageFlowInstructions) || Boolean(enableImageGenerationTool))
  const hasFunctionTools =
    Object.keys(mcpTools).length > 0 ||
    Boolean(kbToolSet) ||
    Boolean(needAttachmentFileToolSet) ||
    Boolean(needWorkspaceCodingTools) ||
    Boolean(needVideoToolSet) ||
    Boolean(needVideoUrlToolSet) ||
    Boolean(browserToolSet) ||
    Boolean(computerToolSet) ||
    taskToolsAvailable ||
    memoryToolsAvailable ||
    needGenerateImageTool
  // Native Gemini grounding only when there are no function tools at all.
  const useGeminiGrounding = nativeWebSearch === 'gemini-grounding' && webBrowsing && !hasFunctionTools

  if (taskToolsAvailable && sessionId) {
    await taskStore.getState().hydrateSessionTasks(sessionId)
  }

  if (kbToolSet && !kbNotSupported) {
    toolSetInstructions += kbToolSet.description
  }
  if (needAttachmentFileToolSet) {
    toolSetInstructions += attachmentFileToolSet.description
  }
  if (workspaceFileToolSet) {
    toolSetInstructions += workspaceFileToolSet.description
  }
  if (browserToolSet) {
    toolSetInstructions += browserToolSet.description
  }
  if (computerToolSet) {
    toolSetInstructions += computerToolSet.description
    // Hard lock into desktop UI space so "find contact" does not route to workspace/Finder.
    toolSetInstructions += `

${computerUiSpaceLockInstructions({
  sessionId: computerSessionId,
  agentCodingEnabled: Boolean(agentCoding?.enabled && needWorkspaceCodingTools),
})}
`
  }
  if (agentCoding?.enabled && !needWorkspaceCodingTools) {
    toolSetInstructions += `
# Local coding tools unavailable

You do NOT currently have filesystem write or terminal tools for this session.
${platform.type !== 'desktop' ? '- Coding tools require the desktop app.' : ''}
${!capabilityId ? '- No native Project folder is bound. Ask the user to Open Folder from the Scopes rail. Pasted absolute paths cannot authorize access. Generic project shell is unavailable.' : ''}
- You may still use task checklist tools and answer with code in chat when local write/terminal is unavailable.
`
  }
  if (needVideoToolSet) {
    toolSetInstructions += videoToolSet.description
  }
  if (needVideoUrlToolSet) {
    toolSetInstructions += videoUrlToolSet.description
  }
  // Memory tools + priority instructions BEFORE web search so models see recall first.
  let memoryToolSet: ReturnType<typeof getMemoryToolSet> | null = null
  if (memoryToolsAvailable) {
    memoryToolSet = getMemoryToolSet({
      settings: memorySettings,
      getGlobalBank: () => memoryStore.getState().globalBank,
      setGlobalBank: async (bank) => {
        await memoryStore.getState().replaceGlobalBank(bank)
      },
      getAgentBank: () =>
        memoryContext?.agentId ? (memoryStore.getState().agentBanks[memoryContext.agentId] ?? null) : null,
      setAgentBank: async (bank) => {
        if (memoryContext?.agentId) {
          await memoryStore.getState().replaceAgentBank(memoryContext.agentId, bank)
        }
      },
      agentId: memoryContext?.agentId,
      agentName: memoryContext?.agentName,
      sessionId,
      allowRetain: isSessionMemoryToolRetainAllowed(memorySettings, sessionSettings),
      scheduleConsolidate: (scope) => {
        if (!memorySettings.autoConsolidate) return
        void memoryStore
          .getState()
          .rebuildProfile(scope, scope === 'agent' ? memoryContext?.agentId : undefined, true)
          .catch(() => {})
      },
    })
    toolSetInstructions += memoryToolSet.description
    if (
      memorySettings.retrievalMode === 'hybrid' ||
      memorySettings.retrievalMode === 'on_demand' ||
      !memorySettings.retrievalMode
    ) {
      toolSetInstructions += `
# Tool priority (memory-first)

A host Memory lookup already ran for the latest user message (system Memory section).
1. Use any Memory lookup hits before calling other tools.
2. If the question may involve the user's projects, stack, or prefs and lookup is empty, call memory_recall once with keywords from the user message.
3. Only then use web search for public/external documentation (SDKs, APIs, blogs).
Do not open with repeated web searches when personal memory may apply.
`
    }
  }

  if (webBrowsing && !webNotSupported && !useGeminiGrounding) {
    toolSetInstructions += websearchToolSet.description
  }

  if (taskToolsAvailable) {
    toolSetInstructions += taskTrackingToolSet.description
    if (sessionId) {
      toolSetInstructions += formatActiveTaskContext(taskStore.getState().getSessionTasks(sessionId))
    }
  }
  if (needGenerateImageTool) {
    toolSetInstructions += generateImageToolSet.description
    toolSetInstructions += `\n\n${formatImageCatalogInstructions(imageCatalog)}`
    if (agentImageFlowInstructions) {
      toolSetInstructions += `\n\n${agentImageFlowInstructions}`
    }
  }

  const memoryForceHybridFallback =
    memorySettings.enabled && memorySettings.retrievalMode === 'on_demand' && !model.isSupportToolUse()

  params.messages = injectModelSystemPrompt(
    model.modelId,
    params.messages,
    // (legacy comment removed)
    toolSetInstructions,
    model.isSupportSystemMessage() ? 'system' : 'user',
    {
      ...memoryContext,
      forceHybridFallback: memoryForceHybridFallback || memoryContext?.forceHybridFallback,
    },
    formatKnowledgeSection(knowledgeScope, knowledgeItems)
  )

  if (!model.isSupportSystemMessage()) {
    params.messages = params.messages.map((m) => ({ ...m, role: m.role === 'system' ? 'user' : m.role }))
  }

  // 2. sequence messages to fix the order, prevent model API 400 errors
  const messages = sequenceMessages(params.messages)
  /** Prefix parts shown before model stream (info + host memory_lookup tool card) */
  const prefixParts: MessageContentParts = []
  try {
    params.onResultChangeWithCancel({ cancel }) // cancel
    const onResultChange: OnResultChange = (data) => {
      if (data.contentParts) {
        result = { ...result, ...data, contentParts: [...prefixParts, ...data.contentParts] }
      } else {
        result = { ...result, ...data }
      }
      params.onResultChangeWithCancel({ ...result, cancel })
    }

    // Host memory lookup first — visible tool step + already injected into system prompt
    {
      const mode = memorySettings.retrievalMode ?? 'hybrid'
      const hostLookupOn =
        memorySettings.enabled &&
        legacyMemoryActive &&
        memorySettings.hostPreSearchEnabled !== false &&
        (mode === 'hybrid' || mode === 'on_demand')
      if (hostLookupOn) {
        let userQuery = memoryContext?.userQuery?.trim() || ''
        if (!userQuery) {
          for (let i = params.messages.length - 1; i >= 0; i--) {
            const m = params.messages[i]
            if (m.role === 'user') {
              userQuery = getMessageText(m, false, false).trim()
              if (userQuery) break
            }
          }
        }
        if (userQuery) {
          const agentBank = memoryContext?.agentId
            ? (memoryStore.getState().agentBanks[memoryContext.agentId] ?? null)
            : null
          const { getMemoryRepository } = await import('@/packages/memory/repository')
          const repo = getMemoryRepository()
          const hits = hostPreSearchMemories({
            query: userQuery,
            globalBank: memoryStore.getState().globalBank,
            agentBank,
            globalIndex: repo.getGlobalIndex(),
            agentIndex: memoryContext?.agentId ? repo.getAgentIndex(memoryContext.agentId) : null,
            settings: memorySettings,
            limit: memorySettings.hostPreSearchLimit ?? 5,
          })
          const memoryLookupPart: MessageToolCallPart = {
            type: 'tool-call',
            state: 'result',
            toolCallId: `memory_lookup_${uniqueId()}`,
            toolName: 'memory_lookup',
            args: { query: userQuery },
            result: {
              matchCount: hits.length,
              matches: hits.map((h) => ({
                id: h.id,
                scope: h.scope,
                content: h.content,
                score: h.score,
              })),
              note:
                hits.length > 0
                  ? 'Host keyword lookup ran before model tools; matches are also in the system Memory section.'
                  : 'Host keyword lookup ran before model tools; no matches. Model may call memory_recall for a deeper search.',
            },
          }
          prefixParts.push(memoryLookupPart)
          // Surface immediately so UI shows Memory lookup before web search starts
          onResultChange({ contentParts: [] })
        }
      }
    }

    if (
      !model.isSupportVision() &&
      messages.some((m) => m.contentParts.some((c) => c.type === 'image' && !c.ocrResult))
    ) {
      await ocrMessages(messages, dependencies)
      prefixParts.push({
        type: 'info',
        text: t('Current model {{modelName}} does not support image input, using OCR to process images', {
          modelName: model.modelId,
        }),
      })
    }

    const includeAssistantReasoning = shouldPreserveReasoningInContext(sessionSettings, globalSettings)

    coreMessages = await convertToModelMessages(messages, {
      modelSupportVision: model.isSupportVision(),
      dependencies,
      includeAssistantReasoning,
    })

    // 3. handle model not support tool use scenarios
    if (kbNotSupported || webNotSupported) {
      // (legacy comment removed)
      if (kbNotSupported && webNotSupported) {
        // infoParts.push({
        //   type: 'info',
        //   text: t(
        //     'Current model {{modelName}} does not support tool use, using prompt for knowledge base and web search',
        //     {
        //       modelName: model.modelId,
        //     }
        //   ),
        // })

        const callResult = await combinedSearchByPromptEngineering(
          model,
          params.messages,
          knowledgeBase.id,
          controller.signal
        )
        const toolName = callResult.type === 'knowledge_base' ? 'query_knowledge_base' : 'web_search'
        return {
          ...(await handleSearchResult(
            callResult,
            toolName,
            model,
            messages,
            coreMessages,
            controller,
            onResultChange,
            { ...params, includeAssistantReasoning },
            dependencies
          )),
          knowledgeIds,
        }
      }
      // (legacy comment removed)
      else if (kbNotSupported) {
        // infoParts.push({
        //   type: 'info',
        //   text: t('Current model {{modelName}} does not support tool use, using prompt for knowledge base', {
        //     modelName: model.modelId,
        //   }),
        // })

        const callResult = await knowledgeBaseSearchByPromptEngineering(model, params.messages, knowledgeBase.id)

        return {
          ...(await handleSearchResult(
            callResult || { query: '', searchResults: [] },
            'query_knowledge_base',
            model,
            messages,
            coreMessages,
            controller,
            onResultChange,
            { ...params, includeAssistantReasoning },
            dependencies
          )),
          knowledgeIds,
        }
      }
      // (legacy comment removed)
      else if (webNotSupported) {
        // infoParts.push({
        //   type: 'info',
        //   text: t('Current model {{modelName}} does not support tool use, using prompt for web search', {
        //     modelName: model.modelId,
        //   }),
        // })

        const callResult = await searchByPromptEngineering(model, params.messages, controller.signal)
        return {
          ...(await handleSearchResult(
            callResult || { query: '', searchResults: [] },
            'web_search',
            model,
            messages,
            coreMessages,
            controller,
            onResultChange,
            { ...params, includeAssistantReasoning },
            dependencies
          )),
          knowledgeIds,
        }
      }
    }

    // 4. construct tool set
    const useCustomTools = Boolean(customTools)
    let tools: ToolSet = useCustomTools ? { ...customTools } : { ...mcpTools }
    if (!useCustomTools) {
      if (useGeminiGrounding) {
        tools.google_search = google.tools.googleSearch({
          mode: 'MODE_DYNAMIC',
          dynamicThreshold: 0.3,
        })
      } else if (webBrowsing) {
        tools.web_search = webSearchTool
        tools.parse_link = parseLinkTool
      }
      if (kbToolSet) {
        tools = {
          ...tools,
          ...kbToolSet.tools,
        }
      }

      if (needAttachmentFileToolSet) {
        const wrappedAttachmentTools = wrapToolsWithApproval(sessionId, attachmentFileToolSet.tools)
        tools = {
          ...tools,
          ...wrappedAttachmentTools,
        }
      }

      if (workspaceFileToolSet) {
        const wrappedWorkspaceTools = wrapToolsWithApproval(sessionId, workspaceFileToolSet.tools)
        tools = {
          ...tools,
          ...wrappedWorkspaceTools,
        }
      }

      if (needVideoToolSet) {
        const wrappedVideoTools = wrapToolsWithApproval(sessionId, videoToolSet.tools as ToolSet)
        tools = {
          ...tools,
          ...wrappedVideoTools,
        }
      }

      if (needVideoUrlToolSet) {
        const wrappedVideoUrlTools = wrapToolsWithApproval(sessionId, videoUrlToolSet.tools as ToolSet)
        tools = {
          ...tools,
          ...wrappedVideoUrlTools,
        }
      }

      if (needGenerateImageTool) {
        const generateImageTools = wrapToolsWithApproval(sessionId, {
          generate_image: createGenerateImageTool({
            sessionId,
            messageId: imageGenerationMessageId,
            imageCatalog,
            waitForCompletion: true,
            // Specialized ComfyUI research→tags flow still forces ComfyUI when agent instructions are present.
            comfyuiAgentMode: Boolean(agentImageFlowInstructions),
          }),
        })
        tools = {
          ...tools,
          ...generateImageTools,
        }
      }

      if (browserToolSet) {
        const wrappedBrowserTools = wrapToolsWithApproval(sessionId, browserToolSet.tools)
        tools = {
          ...tools,
          ...wrappedBrowserTools,
        }
      }

      if (computerToolSet) {
        const wrappedComputerTools = wrapToolsWithApproval(sessionId, computerToolSet.tools)
        tools = {
          ...tools,
          ...wrappedComputerTools,
        }
      }

      if (taskToolsAvailable) {
        tools = {
          ...tools,
          ...taskTrackingToolSet.tools,
        }
      }

      if (memoryToolSet) {
        tools = {
          ...tools,
          ...memoryToolSet.tools,
        }
      }
    }

    // Apply copilot tool access filtering
    tools = filterToolsByAccess(tools, toolAccess)

    // Apply allowedTools filtering (for planning phase - only allow specific tools)
    if (allowedTools && allowedTools.length > 0) {
      const allowedSet = new Set(allowedTools)
      tools = Object.fromEntries(Object.entries(tools).filter(([name]) => allowedSet.has(name)))
    }

    // Computer UI space lock: strip tools that collide with "find" / leave the desktop app.
    if (computerToolSet) {
      tools = filterToolsForComputerUiSpace(tools, {
        agentCodingEnabled: Boolean(agentCoding?.enabled && needWorkspaceCodingTools),
        sessionId: computerSessionId,
      })
    }

    // Global PreToolUse / PostToolUse around every tool execute (after approval + access filters)
    const toolHookWorkspace = workspaceRoot || agentCoding?.workspaceRoot || null
    try {
      const { refreshAgentHooks } = await import('@/stores/hooksStore')
      await refreshAgentHooks({ workspaceRoot: toolHookWorkspace })
    } catch {
      // non-fatal — hooks cache may already be warm from PreTurn
    }
    const { wrapToolsWithLifecycleHooks } = await import('@/packages/hooks')
    tools = wrapToolsWithLifecycleHooks(tools, {
      sessionId,
      workspaceRoot: toolHookWorkspace,
    })

    console.debug('tools', tools)

    const computerSessionForPrepare = needComputerTools ? computerSessionId : ''
    const browserSessionForPrepare = needBrowserTools && !needComputerTools ? browserSessionId : ''
    const needsInteractionPrepare = Boolean(computerSessionForPrepare || browserSessionForPrepare)
    result = withSearchMetadata(
      await model.chat(coreMessages, {
        sessionId,
        signal: controller.signal,
        onResultChange,
        onStatusChange: params.onStatusChange,
        providerOptions: params.providerOptions,
        tools,
        maxSteps: params.maxSteps,
        // Interaction harness: prune old images; force re-observe after blind acts.
        prepareStep: needsInteractionPrepare
          ? ({ messages, stepNumber }) => {
              const pruned = pruneOldImageParts(messages as Array<{ content?: unknown }>, { keepN: 3 })
              if (computerSessionForPrepare) {
                const lastTool = getLastComputerTool(computerSessionForPrepare)
                const embedded = getLastActEmbeddedScreenshot(computerSessionForPrepare)
                const forceShot = stepNumber > 0 && shouldForceComputerScreenshot(lastTool, embedded)
                if (forceShot && tools.computer_screenshot) {
                  return {
                    messages: pruned as typeof messages,
                    toolChoice: { type: 'tool', toolName: 'computer_screenshot' },
                  }
                }
              } else if (browserSessionForPrepare) {
                const lastTool = getLastBrowserTool(browserSessionForPrepare)
                const embedded = getLastBrowserObservationEmbedded(browserSessionForPrepare)
                const forceSnap = stepNumber > 0 && shouldForceBrowserSnapshot(lastTool, embedded)
                if (forceSnap && tools.browser_snapshot) {
                  return {
                    messages: pruned as typeof messages,
                    toolChoice: { type: 'tool', toolName: 'browser_snapshot' },
                  }
                }
              }
              return { messages: pruned as typeof messages }
            }
          : undefined,
      })
    )

    return { result, coreMessages, knowledgeIds }
  } catch (err) {
    console.error(err)
    // if a cancellation is performed, do not throw an exception, otherwise the content will be overwritten.
    if (controller.signal.aborted) {
      return { result, coreMessages, knowledgeIds }
    }
    throw err
  } finally {
    resetVideoToolBudget()
    if (computerSessionId) {
      clearComputerUiTargetApp(computerSessionId)
    }
  }
}
