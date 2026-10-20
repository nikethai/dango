import type { ModelInterface } from '@shared/models/types'
import { createMessage, type Message, ModelProviderEnum, type StreamTextResult } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@/stores/memoryStore', () => ({
  ensureMemoryStoreInit: vi.fn(async () => {}),
  memoryStore: {
    getState: () => ({
      ready: true,
      settings: { enabled: false, autoSave: false },
      globalBank: { scope: 'global', entries: [], profileSummary: '', version: 1 },
      agentBanks: {},
      ensureAgentBank: vi.fn(async () => ({ scope: 'agent', entries: [], profileSummary: '', version: 1 })),
      replaceGlobalBank: vi.fn(),
      replaceAgentBank: vi.fn(),
      rebuildProfile: vi.fn(),
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

vi.mock('../mcp/controller', () => ({
  mcpController: {
    getAvailableTools: () => ({}),
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
vi.mock('./toolsets/pm-pilot', () => ({ loadPmToolSet: (ctx: unknown) => loadPmToolSetMock(ctx) }))

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
    expect(loadPmToolSetMock).toHaveBeenLastCalledWith({ sessionScopeId: 'acme', cloudModel: true })
    expect(injectModelSystemPromptMock.mock.calls.map((call) => String(call[2] ?? '')).join('\n')).toContain(
      'CLIENT RECALL TOOLS'
    )

    await streamText(createTestModel(chat), {
      messages: [createMessage('user', 'hello')],
      sessionSettings: { provider: ModelProviderEnum.Ollama },
      onResultChangeWithCancel: vi.fn(),
    })
    expect(loadPmToolSetMock).toHaveBeenLastCalledWith({ sessionScopeId: undefined, cloudModel: false })

    await streamText(createTestModel(chat), {
      messages: [createMessage('user', 'hello')],
      onResultChangeWithCancel: vi.fn(),
    })
    expect(loadPmToolSetMock).toHaveBeenLastCalledWith({ sessionScopeId: undefined, cloudModel: true })
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
