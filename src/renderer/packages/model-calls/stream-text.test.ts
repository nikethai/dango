import type { ModelInterface } from '@shared/models/types'
import { createMessage, type Message, ModelProviderEnum, type StreamTextResult } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createAndGenerateMock,
  navigateMock,
  webSearchExecutorMock,
  parseUserLinkFreeMock,
  requestToolPermissionMock,
  convertToModelMessagesMock,
  injectModelSystemPromptMock,
} = vi.hoisted(() => ({
  createAndGenerateMock: vi.fn(),
  navigateMock: vi.fn(),
  webSearchExecutorMock: vi.fn(),
  parseUserLinkFreeMock: vi.fn(),
  requestToolPermissionMock: vi.fn(),
  convertToModelMessagesMock: vi.fn(async (messages: Message[]) =>
    messages.map((message) => ({
      role: message.role,
      content: message.contentParts.map((part) => ('text' in part ? part.text : '')).join('\n'),
    }))
  ),
  injectModelSystemPromptMock: vi.fn(
    (_: string, messages: Message[], instructions: string, role: 'system' | 'user') => {
      if (!instructions) {
        return messages
      }
      return [createMessage(role, instructions), ...messages]
    }
  ),
}))

/** Toolset descriptions the prompt would carry; empty unless a case sets them. */
const toolDescriptions = vi.hoisted(() => ({ attachment: '', video: '', videoUrl: '' }))

const settingsState = vi.hoisted(() => ({
  extension: {
    webSearch: {
      provider: 'bing',
    },
    // Keep off in unit tests unless a case enables it
    videoUrl: {
      enabled: false,
    },
  },
  providers: {
    comfyui: {
      comfyuiCheckpoint: 'anime-model.safetensors',
    },
  } as Record<string, Record<string, unknown>>,
}))

vi.mock('@/packages/tool-permission', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/packages/tool-permission')>()),
  requestToolPermission: requestToolPermissionMock,
}))

vi.mock('@/router', () => ({
  router: {
    navigate: navigateMock,
  },
}))

vi.mock('@/stores/imageGenerationActions', () => ({
  createAndGenerate: createAndGenerateMock,
  createAndGenerateAndWait: vi.fn(async (params: unknown) => {
    const recordId = await createAndGenerateMock(params)
    return {
      id: recordId || 'record-1',
      status: 'done',
      generatedImages: ['img-1'],
      prompt: '',
      referenceImages: [],
      createdAt: Date.now(),
      model: { provider: 'comfyui', modelId: 'comfyui-txt2img' },
    }
  }),
}))

vi.mock('@/adapters', () => ({
  createModelDependencies: vi.fn(),
}))

vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: () => ({
      ...settingsState,
      getSettings: () => settingsState,
    }),
  },
}))

const memorySettingsState = vi.hoisted(() => ({ enabled: false, autoSave: false, autoConsolidate: false }))
const rebuildProfileSpy = vi.hoisted(() => vi.fn(async () => {}))
const getMemoryToolSetSpy = vi.hoisted(() => vi.fn())
vi.mock('@/packages/memory/tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/packages/memory/tools')>()
  return {
    ...actual,
    getMemoryToolSet: (ctx: Parameters<typeof actual.getMemoryToolSet>[0]) => {
      getMemoryToolSetSpy(ctx)
      return actual.getMemoryToolSet(ctx)
    },
  }
})

vi.mock('@/stores/memoryStore', () => ({
  ensureMemoryStoreInit: vi.fn(async () => {}),
  memoryStore: {
    getState: () => ({
      ready: true,
      settings: memorySettingsState,
      globalBank: { scope: 'global', entries: [], profileSummary: '', version: 1 },
      agentBanks: {},
      ensureAgentBank: vi.fn(async () => ({ scope: 'agent', entries: [], profileSummary: '', version: 1 })),
      replaceGlobalBank: vi.fn(),
      replaceAgentBank: vi.fn(),
      rebuildProfile: rebuildProfileSpy,
    }),
  },
}))

vi.mock('@/stores/toolApprovalStore', () => ({
  getToolApproval: vi.fn(() => undefined),
  getScopeGrant: vi.fn(() => undefined),
  toolApprovalStore: {
    getState: () => ({
      addAuditEntry: vi.fn(),
      addApproval: vi.fn(),
      addScopeGrant: vi.fn(),
      removeApproval: vi.fn(),
    }),
  },
}))

vi.mock('@/packages/web-search', () => ({
  webSearchExecutor: webSearchExecutorMock,
}))

vi.mock('@/packages/remote', () => ({
  parseUserLinkFree: parseUserLinkFreeMock,
}))

const mcpToolsState = vi.hoisted(() => ({ tools: {} as Record<string, unknown> }))
vi.mock('../mcp/controller', () => ({
  mcpController: {
    getAvailableTools: () => mcpToolsState.tools,
  },
}))

const knowledgeTurn = vi.hoisted(() => ({ items: [] as unknown[] }))
vi.mock('@/packages/knowledge/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/packages/knowledge/store')>()),
  ensureKnowledgeLoaded: vi.fn(async () => {}),
}))
vi.mock('@/packages/knowledge/for-turn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/packages/knowledge/for-turn')>()),
  knowledgeForTurn: vi.fn(() => knowledgeTurn.items),
}))

vi.mock('./message-utils', () => ({
  convertToModelMessages: convertToModelMessagesMock,
  injectModelSystemPrompt: injectModelSystemPromptMock,
}))

vi.mock('./toolsets/knowledge-base', () => ({
  getToolSet: vi.fn(async () => null),
}))

const loadPmToolSetMock = vi.hoisted(() => vi.fn(async (_ctx: unknown): Promise<unknown> => null))
const localOnlyIdsMock = vi.hoisted(() => vi.fn(async (): Promise<Set<string>> => new Set()))
const localOnlyQuestionsMock = vi.hoisted(() => vi.fn(async (_ids: string[]): Promise<Set<string>> => new Set()))
vi.mock('./toolsets/pm-pilot', () => ({
  loadPmToolSet: (ctx: unknown) => loadPmToolSetMock(ctx),
  loadLocalOnlySourceIds: () => localOnlyIdsMock(),
  loadLocalOnlyQuestionIds: (ids: string[]) => localOnlyQuestionsMock(ids),
}))

vi.mock('./toolsets/file', () => ({
  default: {
    description: '',
    tools: {},
  },
  attachmentFileToolSet: {
    get description() {
      return toolDescriptions.attachment
    },
    tools: {},
  },
  createWorkspaceFileToolSet: vi.fn(() => ({
    description: 'workspace tools',
    tools: {
      create_file: { description: 'create', execute: vi.fn() },
      edit_file: { description: 'edit', execute: vi.fn() },
      delete_file: { description: 'delete', execute: vi.fn() },
    },
  })),
}))

vi.mock('./toolsets/terminal', () => ({
  createTerminalToolSet: vi.fn(() => ({
    description: 'terminal tools',
    tools: {
      terminal: { description: 'terminal', execute: vi.fn() },
    },
  })),
}))

vi.mock('./toolsets/video', () => ({
  default: {
    get description() {
      return toolDescriptions.video
    },
    tools: {},
  },
  initVideoToolBudget: vi.fn(),
  resetVideoToolBudget: vi.fn(),
}))

vi.mock('./toolsets/video-url', () => ({
  default: {
    get description() {
      return toolDescriptions.videoUrl
    },
    tools: {
      read_video_url: { description: 'read_video_url', execute: vi.fn() },
    },
  },
}))

vi.mock('./toolsets/task-tracking', () => ({
  default: {
    description: '',
    tools: {},
  },
}))

vi.mock('./tools', () => ({
  combinedSearchByPromptEngineering: vi.fn(),
  constructMessagesWithKnowledgeBaseResults: vi.fn(),
  constructMessagesWithSearchResults: vi.fn(),
  knowledgeBaseSearchByPromptEngineering: vi.fn(),
  searchByPromptEngineering: vi.fn(),
}))

function createTestModel(chatImpl: NonNullable<ModelInterface['chat']>, supportToolUse = true): ModelInterface {
  return {
    name: 'Test Model',
    modelId: 'test-model',
    isSupportVision: () => true,
    isSupportToolUse: () => supportToolUse,
    isSupportSystemMessage: () => true,
    chat: chatImpl,
    paint: vi.fn(async () => []),
  }
}

describe('streamText agent image flow', () => {
  beforeEach(() => {
    createAndGenerateMock.mockReset()
    navigateMock.mockReset()
    webSearchExecutorMock.mockReset()
    parseUserLinkFreeMock.mockReset()
    requestToolPermissionMock.mockReset()
    convertToModelMessagesMock.mockClear()
    injectModelSystemPromptMock.mockClear()

    createAndGenerateMock.mockResolvedValue('record-1')
    navigateMock.mockResolvedValue(undefined)
    requestToolPermissionMock.mockResolvedValue('once')
    webSearchExecutorMock.mockResolvedValue({
      query: 'anime trend',
      searchResults: [
        {
          title: 'Result',
          link: 'https://www.pixiv.net/en/artworks/1',
          snippet: 'snippet',
        },
      ],
    })
    parseUserLinkFreeMock.mockResolvedValue({
      title: 'Pixiv page',
      text: 'Detailed content',
    })
    settingsState.providers[ModelProviderEnum.ComfyUI] = {
      comfyuiCheckpoint: 'anime-model.safetensors',
    }
  })

  it('does not expose generate_image when the feature is disabled', async () => {
    const chat = vi.fn(async (_messages, options) => {
      expect(options.tools?.generate_image).toBeUndefined()
      return { contentParts: [], text: 'done' } as StreamTextResult
    })

    const { streamText } = await import('./stream-text')

    await streamText(createTestModel(chat), {
      messages: [createMessage('user', 'hello')],
      onResultChangeWithCancel: vi.fn(),
      webBrowsing: true,
    })

    expect(chat).toHaveBeenCalled()
    expect(createAndGenerateMock).not.toHaveBeenCalled()
  })

  it('researches, parses, and auto-generates when the feature is enabled', async () => {
    const chat = vi.fn(async (messages, options) => {
      expect(messages[0].content).toContain('COMFYUI AGENT IMAGE FLOW')
      expect(options.tools?.generate_image).toBeDefined()

      const searchResult = await options.tools?.web_search?.execute?.({
        query: 'trending anime art',
        includeDomains: ['danbooru.donmai.us', 'pixiv.net'],
        maxResults: 2,
      })
      expect(searchResult).toMatchObject({
        query: 'anime trend',
      })

      const parsed = await options.tools?.parse_link?.execute?.({
        url: 'https://www.pixiv.net/en/artworks/1',
      })
      expect(parsed).toMatchObject({
        title: 'Pixiv page',
        content: 'Detailed content',
      })

      const generated = await options.tools?.generate_image?.execute?.({
        prompt: 'masterpiece, city lights, cinematic lighting',
        aspectRatio: 'horizontal',
        citations: ['https://www.pixiv.net/en/artworks/1'],
      })
      expect(generated).toMatchObject({
        recordId: 'record-1',
        provider: ModelProviderEnum.ComfyUI,
        modelId: 'comfyui-txt2img',
      })

      return { contentParts: [], text: 'done' } as StreamTextResult
    })

    const { streamText } = await import('./stream-text')

    await streamText(createTestModel(chat), {
      sessionId: 'session-1',
      messages: [createMessage('user', 'what is the best trending anime art')],
      onResultChangeWithCancel: vi.fn(),
      webBrowsing: true,
      agentImageFlowInstructions: 'COMFYUI AGENT IMAGE FLOW',
    })

    expect(webSearchExecutorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        includeDomains: ['danbooru.donmai.us', 'pixiv.net'],
        maxResults: 2,
      }),
      expect.anything()
    )
    expect(createAndGenerateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'masterpiece, city lights, cinematic lighting',
        model: {
          provider: ModelProviderEnum.ComfyUI,
          modelId: 'comfyui-txt2img',
        },
        aspectRatio: 'horizontal',
      })
    )
    // Chat image generation stays inline; no forced navigation to Image Creator.
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('does not generate when search returns no results', async () => {
    webSearchExecutorMock.mockResolvedValueOnce({
      query: 'anime trend',
      searchResults: [],
    })

    const chat = vi.fn(async (_messages, options) => {
      const searchResult = await options.tools?.web_search?.execute?.({
        query: 'trending anime art',
        includeDomains: ['danbooru.donmai.us', 'pixiv.net'],
      })
      expect(searchResult).toMatchObject({
        searchResults: [],
      })

      return { contentParts: [], text: 'no results' } as StreamTextResult
    })

    const { streamText } = await import('./stream-text')

    await streamText(createTestModel(chat), {
      messages: [createMessage('user', 'what is trending now')],
      onResultChangeWithCancel: vi.fn(),
      webBrowsing: true,
      agentImageFlowInstructions: 'COMFYUI AGENT IMAGE FLOW',
    })

    expect(createAndGenerateMock).not.toHaveBeenCalled()
  })

  it('falls back when parse_link fails and still generates', async () => {
    parseUserLinkFreeMock.mockRejectedValueOnce(new Error('parse failed'))

    const chat = vi.fn(async (_messages, options) => {
      await options.tools?.web_search?.execute?.({
        query: 'trending anime art',
        includeDomains: ['danbooru.donmai.us', 'pixiv.net'],
      })

      await expect(
        options.tools?.parse_link?.execute?.({
          url: 'https://www.pixiv.net/en/artworks/1',
        })
      ).rejects.toThrow('parse failed')

      await options.tools?.generate_image?.execute?.({
        prompt: 'masterpiece, dramatic perspective',
      })

      return { contentParts: [], text: 'done' } as StreamTextResult
    })

    const { streamText } = await import('./stream-text')

    await streamText(createTestModel(chat), {
      sessionId: 'session-1',
      messages: [createMessage('user', 'find me a trend')],
      onResultChangeWithCancel: vi.fn(),
      webBrowsing: true,
      agentImageFlowInstructions: 'COMFYUI AGENT IMAGE FLOW',
    })

    expect(createAndGenerateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'masterpiece, dramatic perspective',
      })
    )
  })

  it('fails early when ComfyUI checkpoint is missing', async () => {
    settingsState.providers[ModelProviderEnum.ComfyUI] = {}

    const chat = vi.fn(async (_messages, options) => {
      await expect(
        options.tools?.generate_image?.execute?.({
          prompt: 'masterpiece, city lights',
        })
      ).rejects.toThrow('ComfyUI checkpoint is not configured')

      return { contentParts: [], text: 'done' } as StreamTextResult
    })

    const { streamText } = await import('./stream-text')

    await streamText(createTestModel(chat), {
      sessionId: 'session-1',
      messages: [createMessage('user', 'generate')],
      onResultChangeWithCancel: vi.fn(),
      webBrowsing: true,
      agentImageFlowInstructions: 'COMFYUI AGENT IMAGE FLOW',
    })

    expect(createAndGenerateMock).not.toHaveBeenCalled()
  })
})

describe('streamText reasoning replay', () => {
  beforeEach(() => {
    convertToModelMessagesMock.mockClear()
  })

  it('passes assistant reasoning replay when the session toggle is enabled on a supported provider', async () => {
    const chat = vi.fn(async () => ({ contentParts: [], text: 'done' }) as StreamTextResult)
    const { streamText } = await import('./stream-text')

    await streamText(createTestModel(chat), {
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          contentParts: [
            { type: 'reasoning', text: 'hidden chain' },
            { type: 'text', text: 'final answer' },
          ],
        },
        createMessage('user', 'follow up'),
      ],
      sessionSettings: {
        provider: ModelProviderEnum.Qwen,
        modelId: 'qwen3.7-plus',
        preserveReasoningInContext: true,
      },
      onResultChangeWithCancel: vi.fn(),
    })

    expect(convertToModelMessagesMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        includeAssistantReasoning: true,
      })
    )
  })

  it('keeps assistant reasoning replay disabled when the session toggle is off', async () => {
    const chat = vi.fn(async () => ({ contentParts: [], text: 'done' }) as StreamTextResult)
    const { streamText } = await import('./stream-text')

    await streamText(createTestModel(chat), {
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          contentParts: [
            { type: 'reasoning', text: 'hidden chain' },
            { type: 'text', text: 'final answer' },
          ],
        },
        createMessage('user', 'follow up'),
      ],
      sessionSettings: {
        provider: ModelProviderEnum.Qwen,
        modelId: 'qwen3.7-plus',
        preserveReasoningInContext: false,
      },
      onResultChangeWithCancel: vi.fn(),
    })

    expect(convertToModelMessagesMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        includeAssistantReasoning: false,
      })
    )
  })
})

describe('streamText approved knowledge', () => {
  it('injects knowledge within the token budget and reports exactly what it injected', async () => {
    const { NEVER_SEND_EMAIL } = await import('@/packages/knowledge/select')
    const { KNOWLEDGE_TOKEN_BUDGET } = await import('@/packages/knowledge/for-turn')
    const { estimateTokens } = await import('@/packages/token-estimation/tokenizer')
    const words = (n: number, w: string) => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ')
    const scoped = Array.from({ length: 30 }, (_, i) => ({
      id: `a${i}`,
      scopeId: 'acme',
      kind: 'fact',
      text: `Note ${i} ${words(60, `w${i}x`)}`,
      status: 'approved',
      updatedAt: 100 - i,
    }))
    knowledgeTurn.items = [...scoped, NEVER_SEND_EMAIL]
    injectModelSystemPromptMock.mockClear()
    const chat = vi.fn(async () => ({ contentParts: [], text: 'done' }) as StreamTextResult)
    const { streamText } = await import('./stream-text')

    const { knowledgeIds } = await streamText(createTestModel(chat), {
      messages: [createMessage('user', 'hello')],
      knowledgeScopeId: 'acme',
      onResultChangeWithCancel: vi.fn(),
    })

    const section = injectModelSystemPromptMock.mock.calls.at(-1)?.at(-1) as unknown as string
    expect(estimateTokens(section)).toBeLessThanOrEqual(KNOWLEDGE_TOKEN_BUDGET)
    expect(section).toContain('- Never send email (preference)')
    const injected = scoped.filter((i) => section.includes(`- Note ${i.id.slice(1)} `)).map((i) => i.id)
    expect(injected.length).toBeGreaterThan(0)
    expect(injected.length).toBeLessThan(scoped.length)
    expect(knowledgeIds).toEqual(injected)
    knowledgeTurn.items = []
  })
})

describe('streamText tools-off turn', () => {
  it('does not describe attachment, video or video-URL tools to a turn that has no tools', async () => {
    toolDescriptions.attachment = 'ATTACHMENT FILE TOOLS'
    toolDescriptions.video = 'VIDEO TOOLS'
    toolDescriptions.videoUrl = 'VIDEO URL TOOLS'
    settingsState.extension.videoUrl.enabled = true
    const { streamText } = await import('./stream-text')
    const messages = () => [
      {
        ...createMessage('user', 'Summarise these'),
        links: [{ id: 'l1', url: 'https://example.com', title: 'Example' }],
        files: [{ id: 'v1', name: 'clip.mp4', mediaKind: 'video' as const, storageKey: 'video-1' }],
      } as Message,
    ]
    const instructionsSent = () =>
      injectModelSystemPromptMock.mock.calls.map((call) => String(call[2] ?? '')).join('\n')
    try {
      // Control: with tools on, the instructions are there.
      injectModelSystemPromptMock.mockClear()
      const chat = vi.fn(async () => ({ contentParts: [], text: 'done' }) as StreamTextResult)
      await streamText(createTestModel(chat), { messages: messages(), onResultChangeWithCancel: vi.fn() })
      expect(instructionsSent()).toContain('ATTACHMENT FILE TOOLS')
      expect(instructionsSent()).toContain('VIDEO URL TOOLS')

      // Tools off (Answer without tools): `tools: {}` and no tool instructions.
      injectModelSystemPromptMock.mockClear()
      const toolsOffChat = vi.fn((_messages, options) => {
        expect(Object.keys(options.tools ?? {})).toEqual([])
        return Promise.resolve({ contentParts: [], text: 'done' } as StreamTextResult)
      })
      await streamText(createTestModel(toolsOffChat), {
        messages: messages(),
        tools: {},
        onResultChangeWithCancel: vi.fn(),
      })
      expect(toolsOffChat).toHaveBeenCalled()
      expect(instructionsSent()).not.toContain('ATTACHMENT FILE TOOLS')
      expect(instructionsSent()).not.toContain('VIDEO TOOLS')
      expect(instructionsSent()).not.toContain('VIDEO URL TOOLS')
    } finally {
      toolDescriptions.attachment = ''
      toolDescriptions.video = ''
      toolDescriptions.videoUrl = ''
      settingsState.extension.videoUrl.enabled = false
    }
  })
})

describe('streamText client_recall', () => {
  const clientRecall = { description: 'client_recall', execute: vi.fn() }
  beforeEach(() => {
    loadPmToolSetMock
      .mockReset()
      .mockResolvedValue({ description: 'CLIENT RECALL TOOLS', tools: { client_recall: clientRecall } })
  })

  it('merges the PM toolset unwrapped, with its instructions, and decides cloud from the chat model', async () => {
    const { streamText } = await import('./stream-text')
    injectModelSystemPromptMock.mockClear()
    clientRecall.execute.mockReset().mockResolvedValue({ ok: true, records: [], gaps: [] })
    const chat = vi.fn(async (_messages, options) => {
      await options.tools?.client_recall?.execute?.({ query: 'launch' }, { toolCallId: 't1', messages: [] })
      return { contentParts: [], text: 'done' } as StreamTextResult
    })
    await streamText(createTestModel(chat), {
      messages: [createMessage('user', 'When is the Acme launch?')],
      scopeId: 'acme',
      sessionSettings: { provider: ModelProviderEnum.OpenAI },
      onResultChangeWithCancel: vi.fn(),
    })
    expect(chat).toHaveBeenCalled()
    expect(clientRecall.execute).toHaveBeenCalledTimes(1)
    expect(loadPmToolSetMock).toHaveBeenLastCalledWith({
      sessionScopeId: 'acme',
      cloudModel: true,
      userMessage: 'When is the Acme launch?',
    })
    expect(injectModelSystemPromptMock.mock.calls.map((call) => String(call[2] ?? '')).join('\n')).toContain(
      'CLIENT RECALL TOOLS'
    )

    await streamText(createTestModel(chat), {
      messages: [createMessage('user', 'hello')],
      sessionSettings: { provider: ModelProviderEnum.Ollama },
      onResultChangeWithCancel: vi.fn(),
    })
    expect(loadPmToolSetMock).toHaveBeenLastCalledWith({
      sessionScopeId: undefined,
      cloudModel: false,
      userMessage: 'hello',
    })

    await streamText(createTestModel(chat), {
      messages: [createMessage('user', 'hello')],
      onResultChangeWithCancel: vi.fn(),
    })
    expect(loadPmToolSetMock).toHaveBeenLastCalledWith({
      sessionScopeId: undefined,
      cloudModel: true,
      userMessage: 'hello',
    })
  })

  it('counts Ollama on another machine, or a cloud model on Ollama, as a cloud model', async () => {
    const { streamText } = await import('./stream-text')
    const chat = vi.fn(async () => ({ contentParts: [], text: 'done' }) as StreamTextResult)
    settingsState.providers[ModelProviderEnum.Ollama] = { apiHost: 'http://10.0.0.5:11434' }
    try {
      await streamText(createTestModel(chat), {
        messages: [createMessage('user', 'hello')],
        sessionSettings: { provider: ModelProviderEnum.Ollama, modelId: 'llama3' },
        onResultChangeWithCancel: vi.fn(),
      })
      expect(loadPmToolSetMock).toHaveBeenLastCalledWith(expect.objectContaining({ cloudModel: true }))
    } finally {
      delete settingsState.providers[ModelProviderEnum.Ollama]
    }
    await streamText(
      { ...createTestModel(chat), modelId: 'gpt-oss:120b-cloud' },
      {
        messages: [createMessage('user', 'hello')],
        sessionSettings: { provider: ModelProviderEnum.Ollama, modelId: 'gpt-oss:120b-cloud' },
        onResultChangeWithCancel: vi.fn(),
      }
    )
    expect(loadPmToolSetMock).toHaveBeenLastCalledWith(expect.objectContaining({ cloudModel: true }))
  })

  it('is not loaded for a turn with its own tools or a model without tool use', async () => {
    const { streamText } = await import('./stream-text')
    const chat = vi.fn((_messages, options) => {
      expect(options.tools?.client_recall).toBeUndefined()
      return Promise.resolve({ contentParts: [], text: 'done' } as StreamTextResult)
    })
    await streamText(createTestModel(chat), {
      messages: [createMessage('user', 'hello')],
      tools: {},
      onResultChangeWithCancel: vi.fn(),
    })
    await streamText(createTestModel(chat, false), {
      messages: [createMessage('user', 'hello')],
      onResultChangeWithCancel: vi.fn(),
    })
    expect(loadPmToolSetMock).not.toHaveBeenCalled()
  })

  it('keeps chatting when the PM toolset fails to load', async () => {
    loadPmToolSetMock.mockRejectedValue(new Error('storage down'))
    const { streamText } = await import('./stream-text')
    const chat = vi.fn((_messages, options) => {
      expect(options.tools?.client_recall).toBeUndefined()
      return Promise.resolve({ contentParts: [], text: 'done' } as StreamTextResult)
    })
    await streamText(createTestModel(chat), {
      messages: [createMessage('user', 'hello')],
      onResultChangeWithCancel: vi.fn(),
    })
    expect(chat).toHaveBeenCalled()
  })
})

describe('streamText local-only client data on a cloud turn', () => {
  const recallAnswer = (localOnly: boolean): Message => ({
    ...createMessage('assistant', ''),
    contentParts: [
      { type: 'reasoning', text: 'Jo wrote the price is 4,200 USD' },
      {
        type: 'tool-call',
        state: 'result',
        toolCallId: 'c1',
        toolName: 'client_recall',
        args: { query: 'price' },
        result: {
          ok: true,
          records: [{ text: 'The price is 4,200 USD' }],
          gaps: [],
          ...(localOnly ? { localOnly } : {}),
        },
      },
      { type: 'text', text: 'Jo said the price is 4,200 USD.' },
    ],
  })
  const history = (localOnly: boolean) => [
    createMessage('user', 'What did Jo say about the price?'),
    recallAnswer(localOnly),
    createMessage('user', 'Write that up for the team'),
  ]
  const sent = () => JSON.stringify(convertToModelMessagesMock.mock.calls.at(-1)?.[0])
  const chat = () => vi.fn(async () => ({ contentParts: [], text: 'done' }) as StreamTextResult)

  beforeEach(() => {
    loadPmToolSetMock.mockReset().mockResolvedValue(null)
    localOnlyIdsMock.mockReset().mockResolvedValue(new Set(['g-local']))
    knowledgeTurn.items = []
  })

  it('sends a placeholder for an earlier answer built from local-only records', async () => {
    const { streamText } = await import('./stream-text')
    await streamText(createTestModel(chat()), {
      messages: history(true),
      sessionSettings: { provider: ModelProviderEnum.OpenAI },
      onResultChangeWithCancel: vi.fn(),
    })
    expect(sent()).not.toContain('4,200')
    expect(sent()).toContain('kept on this device')
    expect(sent()).toContain('Write that up for the team')
  })

  it('keeps that answer on a local model, and sends a shareable recall answer as is', async () => {
    const { streamText } = await import('./stream-text')
    await streamText(createTestModel(chat()), {
      messages: history(true),
      sessionSettings: { provider: ModelProviderEnum.Ollama },
      onResultChangeWithCancel: vi.fn(),
    })
    expect(sent()).toContain('Jo said the price is 4,200 USD.')

    await streamText(createTestModel(chat()), {
      messages: history(false),
      sessionSettings: { provider: ModelProviderEnum.OpenAI },
      onResultChangeWithCancel: vi.fn(),
    })
    expect(sent()).toContain('Jo said the price is 4,200 USD.')
    expect(sent()).not.toContain('kept on this device')
  })

  it('a cloud turn in a local-only Needs you chat sends no mail text', async () => {
    const ch6 = (): Message[] => [
      {
        ...createMessage('assistant', "Jo asks for the quote. I found two answers:\n8,400 · Jo's 12 Sep email"),
        pmQuestionId: 'q1',
      },
      createMessage('user', 'Which is newer?'),
      createMessage('assistant', 'Jo wrote 8,400 on 12 Sep.'),
      createMessage('user', 'Use the newer one'),
    ]
    const { streamText } = await import('./stream-text')
    const run = (provider: string) =>
      streamText(createTestModel(chat()), {
        sessionId: 's1',
        messages: ch6(),
        sessionSettings: { provider },
        onResultChangeWithCancel: vi.fn(),
      })

    localOnlyQuestionsMock.mockReset().mockResolvedValue(new Set(['q1']))
    await run(ModelProviderEnum.OpenAI)
    expect(localOnlyQuestionsMock).toHaveBeenCalledWith(['q1'])
    expect(sent()).not.toContain('8,400')
    expect(sent()).toContain('kept on this device')
    expect(sent()).toContain('Use the newer one')
    expect(loadPmToolSetMock).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: 's1' }))

    // Unknown (storage down): held back too.
    localOnlyQuestionsMock.mockRejectedValue(new Error('storage down'))
    await run(ModelProviderEnum.OpenAI)
    expect(sent()).not.toContain('8,400')

    // A shareable question's chat, or a local model, sends it.
    localOnlyQuestionsMock.mockReset().mockResolvedValue(new Set())
    await run(ModelProviderEnum.OpenAI)
    expect(sent()).toContain('8,400')
    localOnlyQuestionsMock.mockReset().mockResolvedValue(new Set(['q1']))
    await run(ModelProviderEnum.Ollama)
    expect(sent()).toContain('8,400')
  })

  it('leaves knowledge from a local-only source off a cloud turn', async () => {
    const item = (id: string, text: string, sourceId?: string) => ({
      id,
      scopeId: 'acme',
      kind: 'fact',
      text,
      status: 'approved',
      updatedAt: 1,
      sources: [{ id: `s-${id}`, kind: sourceId ? 'email' : 'user', label: 'x', ...(sourceId ? { sourceId } : {}) }],
    })
    knowledgeTurn.items = [
      item('k1', 'Acme price is 4200', 'g-local'),
      item('k2', 'Acme launch is 12 Sep', 'g-shared'),
      item('k3', 'Acme prefers email'),
    ]
    const section = () => String(injectModelSystemPromptMock.mock.calls.at(-1)?.at(-1) ?? '')
    const { streamText } = await import('./stream-text')
    const run = (provider: string) =>
      streamText(createTestModel(chat()), {
        messages: [createMessage('user', 'Acme price launch email')],
        knowledgeScopeId: 'acme',
        sessionSettings: { provider },
        onResultChangeWithCancel: vi.fn(),
      })

    const cloud = await run(ModelProviderEnum.OpenAI)
    expect(section()).not.toContain('4200')
    expect(section()).toContain('12 Sep')
    expect(section()).toContain('prefers email')
    expect(cloud.knowledgeIds.sort()).toEqual(['k2', 'k3'])

    const local = await run(ModelProviderEnum.Ollama)
    expect(section()).toContain('4200')
    expect(local.knowledgeIds.sort()).toEqual(['k1', 'k2', 'k3'])

    // Sources unreadable: only knowledge the user typed goes.
    localOnlyIdsMock.mockRejectedValue(new Error('storage down'))
    const unknown = await run(ModelProviderEnum.OpenAI)
    expect(unknown.knowledgeIds).toEqual(['k3'])
    knowledgeTurn.items = []
  })

  it('does not load or describe client_recall when tool access leaves it out', async () => {
    loadPmToolSetMock.mockResolvedValue({ description: 'CLIENT RECALL TOOLS', tools: { client_recall: {} } })
    const { streamText } = await import('./stream-text')
    const instructions = () => injectModelSystemPromptMock.mock.calls.map((call) => String(call[2] ?? '')).join('\n')
    injectModelSystemPromptMock.mockClear()
    await streamText(createTestModel(chat()), {
      messages: [createMessage('user', 'hello')],
      toolAccess: { mode: 'denylist', tools: ['client_recall'] },
      onResultChangeWithCancel: vi.fn(),
    })
    await streamText(createTestModel(chat()), {
      messages: [createMessage('user', 'hello')],
      toolAccess: { mode: 'allowlist', tools: ['web_search'] },
      onResultChangeWithCancel: vi.fn(),
    })
    await streamText(createTestModel(chat()), {
      messages: [createMessage('user', 'hello')],
      allowedTools: ['create_task'],
      onResultChangeWithCancel: vi.fn(),
    })
    expect(loadPmToolSetMock).not.toHaveBeenCalled()
    expect(instructions()).not.toContain('CLIENT RECALL TOOLS')

    await streamText(createTestModel(chat()), {
      messages: [createMessage('user', 'hello')],
      toolAccess: { mode: 'allowlist', tools: ['client_recall'] },
      onResultChangeWithCancel: vi.fn(),
    })
    expect(loadPmToolSetMock).toHaveBeenCalledTimes(1)
    expect(instructions()).toContain('CLIENT RECALL TOOLS')
  })
})

describe('streamText legacy memory in chats that hold local-only text (B3)', () => {
  const recallAnswer = (): Message => ({
    ...createMessage('assistant', 'Jo wrote 8,400.'),
    contentParts: [
      {
        type: 'tool-call',
        state: 'result',
        toolCallId: 'r1',
        toolName: 'client_recall',
        args: {},
        result: { localOnly: true },
      },
      { type: 'text', text: 'Jo wrote 8,400.' },
    ],
  })
  const toolsOffered = vi.fn()
  const chat = () =>
    vi.fn((_messages, options) => {
      toolsOffered(Object.keys(options.tools ?? {}))
      return Promise.resolve({ contentParts: [], text: 'done' } as StreamTextResult)
    })
  const lastCtx = () => getMemoryToolSetSpy.mock.calls.at(-1)?.[0]
  const memoryToolsOffered = () =>
    (toolsOffered.mock.calls.at(-1)?.[0] as string[]).filter((n) => n.startsWith('memory_'))

  beforeEach(() => {
    memorySettingsState.enabled = true
    getMemoryToolSetSpy.mockClear()
    toolsOffered.mockClear()
    loadPmToolSetMock.mockReset().mockResolvedValue(null)
  })
  afterEach(() => {
    memorySettingsState.enabled = false
  })

  const ollama = { provider: ModelProviderEnum.Ollama, modelId: 'llama3' }
  const openai = { provider: ModelProviderEnum.OpenAI, modelId: 'gpt-4o' }

  it('turns off saving and reflecting in a chat that holds a local-only recall, local or cloud', async () => {
    const { streamText } = await import('./stream-text')
    for (const sessionSettings of [ollama, openai]) {
      await streamText(createTestModel(chat()), {
        messages: [createMessage('user', 'quote?'), recallAnswer(), createMessage('user', 'remember that')],
        sessionSettings,
        onResultChangeWithCancel: vi.fn(),
      })
      expect(lastCtx()).toMatchObject({ localOnlyChat: true, sessionSettings })
      expect(memoryToolsOffered()).toEqual(['memory_recall', 'memory_list', 'memory_forget'])
    }
  })

  it('turns them off in a Needs you chat, and on a local turn offered client recall', async () => {
    const { streamText } = await import('./stream-text')
    await streamText(createTestModel(chat()), {
      messages: [{ ...createMessage('assistant', 'Client asks'), pmQuestionId: 'q1' }, createMessage('user', 'ok')],
      sessionSettings: openai,
      onResultChangeWithCancel: vi.fn(),
    })
    expect(lastCtx()).toMatchObject({ localOnlyChat: true })

    loadPmToolSetMock.mockResolvedValue({ description: 'CLIENT RECALL TOOLS', tools: { client_recall: {} } })
    await streamText(createTestModel(chat()), {
      messages: [createMessage('user', 'When is the Acme launch?')],
      sessionSettings: ollama,
      onResultChangeWithCancel: vi.fn(),
    })
    expect(lastCtx()).toMatchObject({ localOnlyChat: true })
    expect(memoryToolsOffered()).not.toContain('memory_retain')

    // A cloud turn offered client recall gets no local-only records, so memory stays as it is.
    await streamText(createTestModel(chat()), {
      messages: [createMessage('user', 'When is the Acme launch?')],
      sessionSettings: openai,
      onResultChangeWithCancel: vi.fn(),
    })
    expect(lastCtx()).toMatchObject({ localOnlyChat: false })
  })

  it('keeps every memory tool in an ordinary chat and consolidates with the chat model', async () => {
    const { streamText } = await import('./stream-text')
    await streamText(createTestModel(chat()), {
      messages: [createMessage('user', 'I like tea')],
      sessionSettings: ollama,
      onResultChangeWithCancel: vi.fn(),
    })
    expect(lastCtx()).toMatchObject({ localOnlyChat: false, sessionSettings: ollama })
    expect(memoryToolsOffered()).toContain('memory_retain')
    expect(memoryToolsOffered()).toContain('memory_reflect')

    memorySettingsState.autoConsolidate = true
    try {
      lastCtx().scheduleConsolidate('global')
      expect(rebuildProfileSpy).toHaveBeenLastCalledWith('global', undefined, true, { sessionSettings: ollama })
    } finally {
      memorySettingsState.autoConsolidate = false
    }
  })
})

describe('streamText web search on a local-only turn (S13)', () => {
  const localOnlyRecall = (): Message => ({
    ...createMessage('assistant', ''),
    contentParts: [
      {
        type: 'tool-call',
        state: 'result',
        toolCallId: 'c1',
        toolName: 'client_recall',
        args: { query: 'price' },
        result: { ok: true, records: [{ text: 'The price is 4,200 USD' }], gaps: [], localOnly: true },
      },
      { type: 'text', text: 'Jo said the price is 4,200 USD.' },
    ],
  })
  const toolsSeen = () => {
    const seen: Record<string, unknown>[] = []
    const chat = vi.fn((_messages, options) => {
      seen.push({ ...(options.tools ?? {}) })
      return Promise.resolve({ contentParts: [], text: 'done' } as StreamTextResult)
    })
    return { chat, seen }
  }

  beforeEach(() => {
    loadPmToolSetMock
      .mockReset()
      .mockResolvedValue({ description: 'CLIENT RECALL TOOLS', tools: { client_recall: { execute: vi.fn() } } })
  })

  it('offers no web search or link reading to a local turn offered client recall; a cloud turn keeps them', async () => {
    const { streamText } = await import('./stream-text')
    const { chat, seen } = toolsSeen()
    await streamText(createTestModel(chat), {
      messages: [createMessage('user', 'What did Jo say?')],
      webBrowsing: true,
      sessionSettings: { provider: ModelProviderEnum.Ollama, modelId: 'test-model' },
      onResultChangeWithCancel: vi.fn(),
    })
    expect(seen[0].client_recall).toBeDefined()
    expect(seen[0].web_search).toBeUndefined()
    expect(seen[0].parse_link).toBeUndefined()
    expect(injectModelSystemPromptMock.mock.calls.at(-1)?.[2]).not.toContain('web_search')

    await streamText(createTestModel(chat), {
      messages: [createMessage('user', 'What did Jo say?')],
      webBrowsing: true,
      sessionSettings: { provider: ModelProviderEnum.OpenAI, modelId: 'gpt' },
      onResultChangeWithCancel: vi.fn(),
    })
    expect(seen[1].web_search).toBeDefined()
    expect(seen[1].parse_link).toBeDefined()
  })

  it('removes web tools a turn brings itself (plan mode) on a local-only turn; a cloud turn keeps them', async () => {
    loadPmToolSetMock.mockResolvedValue(null)
    const { streamText } = await import('./stream-text')
    const { chat, seen } = toolsSeen()
    const ownTools = () => ({
      web_search: { description: 'search', execute: vi.fn() },
      parse_link: { description: 'link', execute: vi.fn() },
      google_search: { description: 'grounding', execute: vi.fn() },
      read_file: { description: 'read', execute: vi.fn() },
    })
    const messages = () => [createMessage('user', 'Price?'), localOnlyRecall(), createMessage('user', 'Plan it')]
    await streamText(createTestModel(chat), {
      messages: messages(),
      tools: ownTools() as never,
      sessionSettings: { provider: ModelProviderEnum.Ollama, modelId: 'test-model' },
      onResultChangeWithCancel: vi.fn(),
    })
    expect(Object.keys(seen[0])).toEqual(['read_file'])

    await streamText(createTestModel(chat), {
      messages: messages(),
      tools: ownTools() as never,
      sessionSettings: { provider: ModelProviderEnum.OpenAI, modelId: 'gpt' },
      onResultChangeWithCancel: vi.fn(),
    })
    expect(Object.keys(seen[1])).toEqual(expect.arrayContaining(['web_search', 'parse_link', 'read_file']))
  })

  it('does no prompt-engineered search or native grounding for a local model in a chat holding local-only text', async () => {
    loadPmToolSetMock.mockResolvedValue(null)
    const { streamText } = await import('./stream-text')
    const tools = await import('./tools')
    vi.mocked(tools.searchByPromptEngineering).mockClear()
    const { chat, seen } = toolsSeen()
    const messages = () => [createMessage('user', 'Price?'), localOnlyRecall(), createMessage('user', 'And now?')]
    await streamText(createTestModel(chat, false), {
      messages: messages(),
      webBrowsing: true,
      sessionSettings: { provider: ModelProviderEnum.Ollama, modelId: 'test-model' },
      onResultChangeWithCancel: vi.fn(),
    })
    expect(tools.searchByPromptEngineering).not.toHaveBeenCalled()
    expect(chat).toHaveBeenCalledTimes(1)

    await streamText(createTestModel(chat), {
      messages: messages(),
      webBrowsing: true,
      nativeWebSearch: 'gemini-grounding',
      sessionSettings: { provider: ModelProviderEnum.Ollama, modelId: 'test-model' },
      onResultChangeWithCancel: vi.fn(),
    })
    expect(seen[1].google_search).toBeUndefined()
    expect(seen[1].web_search).toBeUndefined()
  })
})

describe('streamText outside tools on a local-only turn (D2)', () => {
  const localOnlyRecall = (): Message => ({
    ...createMessage('assistant', ''),
    contentParts: [
      {
        type: 'tool-call',
        state: 'result',
        toolCallId: 'c1',
        toolName: 'client_recall',
        args: { query: 'price' },
        result: { ok: true, records: [{ text: 'The price is 4,200 USD' }], gaps: [], localOnly: true },
      },
      { type: 'text', text: 'Jo said the price is 4,200 USD.' },
    ],
  })
  const messages = () => [createMessage('user', 'Price?'), localOnlyRecall(), createMessage('user', 'And now?')]
  const toolsSeen = () => {
    const seen: Record<string, unknown>[] = []
    const chat = vi.fn((_messages, options) => {
      seen.push({ ...(options.tools ?? {}) })
      return Promise.resolve({ contentParts: [], text: 'done' } as StreamTextResult)
    })
    return { chat, seen }
  }
  const ollama = { provider: ModelProviderEnum.Ollama, modelId: 'test-model' }
  const openai = { provider: ModelProviderEnum.OpenAI, modelId: 'gpt' }
  const OUTSIDE = ['mcp__notes__search', 'mcp__web_search', 'read_video_url', 'generate_image']

  beforeEach(() => {
    loadPmToolSetMock.mockReset().mockResolvedValue(null)
    mcpToolsState.tools = {
      mcp__notes__search: { description: 'search notes', execute: vi.fn() },
      mcp__web_search: { description: 'search', execute: vi.fn() },
    }
    settingsState.extension.videoUrl.enabled = true
  })
  afterEach(() => {
    mcpToolsState.tools = {}
    settingsState.extension.videoUrl.enabled = false
  })

  it('offers no MCP, video-URL or image tools to a local-only turn and says so; a cloud turn keeps them', async () => {
    const { streamText } = await import('./stream-text')
    const { chat, seen } = toolsSeen()
    const local = await streamText(createTestModel(chat), {
      messages: messages(),
      enableImageGenerationTool: true,
      sessionSettings: ollama,
      onResultChangeWithCancel: vi.fn(),
    })
    for (const name of OUTSIDE) expect(seen[0][name]).toBeUndefined()
    expect(local.localOnlyToolsOff).toBe(true)
    const instructions = String(injectModelSystemPromptMock.mock.calls.at(-1)?.[2] ?? '')
    expect(instructions).not.toContain('generate_image')

    const cloud = await streamText(createTestModel(chat), {
      messages: messages(),
      enableImageGenerationTool: true,
      sessionSettings: openai,
      onResultChangeWithCancel: vi.fn(),
    })
    for (const name of OUTSIDE) expect(seen[1][name]).toBeDefined()
    expect(cloud.localOnlyToolsOff).toBe(false)
  })

  it('removes outside tools a turn brings itself (browser, MCP, web) and keeps computer use', async () => {
    const { streamText } = await import('./stream-text')
    const { chat, seen } = toolsSeen()
    const ownTools = () => ({
      browser_navigate: { description: 'go', execute: vi.fn() },
      browser_snapshot: { description: 'look', execute: vi.fn() },
      mcp__x__fetch: { description: 'fetch', execute: vi.fn() },
      read_video_url: { description: 'video', execute: vi.fn() },
      generate_image: { description: 'image', execute: vi.fn() },
      web_search: { description: 'search', execute: vi.fn() },
      computer_screenshot: { description: 'see', execute: vi.fn() },
      read_file: { description: 'read', execute: vi.fn() },
    })
    const local = await streamText(createTestModel(chat), {
      messages: messages(),
      tools: ownTools() as never,
      sessionSettings: ollama,
      onResultChangeWithCancel: vi.fn(),
    })
    expect(Object.keys(seen[0]).sort()).toEqual(['computer_screenshot', 'read_file'])
    expect(local.localOnlyToolsOff).toBe(true)

    await streamText(createTestModel(chat), {
      messages: messages(),
      tools: ownTools() as never,
      sessionSettings: openai,
      onResultChangeWithCancel: vi.fn(),
    })
    expect(Object.keys(seen[1]).sort()).toEqual(Object.keys(ownTools()).sort())
  })

  it('applies after a copilot allowlist that names outside tools', async () => {
    const { streamText } = await import('./stream-text')
    const { chat, seen } = toolsSeen()
    await streamText(createTestModel(chat), {
      messages: messages(),
      sessionSettings: ollama,
      toolAccess: { mode: 'allowlist', tools: ['mcp__notes__search', 'read_video_url'], includeMcp: true },
      allowedTools: ['mcp__notes__search', 'read_video_url'],
      onResultChangeWithCancel: vi.fn(),
    })
    expect(Object.keys(seen[0])).toEqual([])
  })

  it('carries no flag when nothing was removed and the web toggle was off; the web toggle alone sets it', async () => {
    mcpToolsState.tools = {}
    settingsState.extension.videoUrl.enabled = false
    const { streamText } = await import('./stream-text')
    const { chat } = toolsSeen()
    const quiet = await streamText(createTestModel(chat), {
      messages: messages(),
      sessionSettings: ollama,
      onResultChangeWithCancel: vi.fn(),
    })
    expect(quiet.localOnlyToolsOff).toBe(false)

    const web = await streamText(createTestModel(chat), {
      messages: messages(),
      webBrowsing: true,
      sessionSettings: ollama,
      onResultChangeWithCancel: vi.fn(),
    })
    expect(web.localOnlyToolsOff).toBe(true)

    // A model without tool use takes the prompt-engineered path; the web toggle still reads as off.
    const noTools = await streamText(createTestModel(chat, false), {
      messages: messages(),
      webBrowsing: true,
      sessionSettings: ollama,
      onResultChangeWithCancel: vi.fn(),
    })
    expect(noTools.localOnlyToolsOff).toBe(true)
  })
})
