import type { ModelInterface } from '@shared/models/types'
import { createMessage, type Message, type StreamTextResult } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const createWorkspaceFileToolSetMock = vi.hoisted(() =>
  vi.fn((root: string) => ({
    description: `workspace:${root}`,
    tools: {
      create_file: { description: 'create_file', execute: vi.fn() },
      edit_file: { description: 'edit_file', execute: vi.fn() },
      delete_file: { description: 'delete_file', execute: vi.fn() },
    },
  }))
)

const createTerminalToolSetMock = vi.hoisted(() =>
  vi.fn((root: string) => ({
    description: `terminal:${root}`,
    tools: {
      terminal: { description: 'terminal', execute: vi.fn() },
    },
  }))
)

const injectModelSystemPromptMock = vi.hoisted(() =>
  vi.fn((_: string, messages: Message[], instructions: string, role: 'system' | 'user') => {
    if (!instructions) return messages
    return [createMessage(role, instructions), ...messages]
  })
)

const convertToModelMessagesMock = vi.hoisted(() =>
  vi.fn(async (messages: Message[]) =>
    messages.map((message) => ({
      role: message.role,
      content: message.contentParts.map((part) => ('text' in part ? part.text : '')).join('\n'),
    }))
  )
)

vi.mock('@ebay/nice-modal-react', () => ({
  default: {
    show: vi.fn(),
  },
}))

vi.mock('@/router', () => ({
  router: {
    navigate: vi.fn(),
  },
}))

vi.mock('@/adapters', () => ({
  createModelDependencies: vi.fn(async () => ({})),
}))

vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: () => ({
      extension: { webSearch: { provider: 'bing' }, videoUrl: { enabled: false } },
      getSettings: () => ({ extension: { webSearch: { provider: 'bing' }, videoUrl: { enabled: false } } }),
    }),
  },
}))

vi.mock('@/stores/toolApprovalStore', () => ({
  getToolApproval: vi.fn(() => undefined),
  toolApprovalStore: {
    getState: () => ({
      addAuditEntry: vi.fn(),
      addApproval: vi.fn(),
      removeApproval: vi.fn(),
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

vi.mock('@/stores/taskStore', () => ({
  formatActiveTaskContext: () => '',
  taskStore: {
    getState: () => ({
      hydrateSessionTasks: vi.fn(),
      getSessionTasks: () => [],
    }),
  },
}))

vi.mock('@/stores/imageGenerationActions', () => ({
  createAndGenerate: vi.fn(),
}))

vi.mock('../mcp/controller', () => ({
  mcpController: {
    getAvailableTools: () => ({}),
  },
}))

vi.mock('./message-utils', () => ({
  convertToModelMessages: convertToModelMessagesMock,
  injectModelSystemPrompt: injectModelSystemPromptMock,
}))

vi.mock('./toolsets/knowledge-base', () => ({
  getToolSet: vi.fn(async () => null),
}))

vi.mock('./toolsets/file', () => ({
  attachmentFileToolSet: {
    description: 'attachment tools',
    tools: {
      read_file: { description: 'read', execute: vi.fn() },
      search_file_content: { description: 'search', execute: vi.fn() },
    },
  },
  createWorkspaceFileToolSet: createWorkspaceFileToolSetMock,
  default: {
    description: 'attachment tools',
    tools: {},
  },
}))

vi.mock('./toolsets/terminal', () => ({
  createTerminalToolSet: createTerminalToolSetMock,
}))

vi.mock('./toolsets/video', () => ({
  default: { description: '', tools: {} },
  initVideoToolBudget: vi.fn(),
  resetVideoToolBudget: vi.fn(),
}))

vi.mock('./toolsets/video-url', () => ({
  default: {
    description: '',
    tools: {
      read_video_url: { description: 'read_video_url', execute: vi.fn() },
    },
  },
}))

const googleSearchProviderToolMock = vi.hoisted(() =>
  vi.fn(() => ({ type: 'provider', id: 'google.google_search', description: 'grounding' }))
)

vi.mock('@ai-sdk/google', () => ({
  google: {
    tools: {
      googleSearch: googleSearchProviderToolMock,
    },
  },
}))

vi.mock('./toolsets/task-tracking', () => ({
  default: {
    description: 'tasks',
    tools: {
      create_task: { description: 'create_task' },
      update_task: { description: 'update_task' },
      list_tasks: { description: 'list_tasks' },
    },
  },
  CANONICAL_TASK_TOOLS: {
    create_task: { description: 'create_task' },
    update_task: { description: 'update_task' },
    list_tasks: { description: 'list_tasks' },
  },
}))

vi.mock('./toolsets/web-search', () => ({
  default: {
    description: 'web search tools',
    tools: {
      web_search: { description: 'web_search' },
      parse_link: { description: 'parse_link' },
    },
  },
  webSearchTool: { description: 'web_search', execute: vi.fn() },
  parseLinkTool: { description: 'parse_link', execute: vi.fn() },
}))

vi.mock('./tools', () => ({
  combinedSearchByPromptEngineering: vi.fn(),
  constructMessagesWithKnowledgeBaseResults: vi.fn(),
  constructMessagesWithSearchResults: vi.fn(),
  knowledgeBaseSearchByPromptEngineering: vi.fn(),
  searchByPromptEngineering: vi.fn(),
}))

vi.mock('@/platform', () => ({
  default: {
    type: 'desktop',
    formFactor: 'desktop',
    appLog: vi.fn(async () => undefined),
  },
}))

import { streamText } from './stream-text'

function createTestModel(chatImpl: NonNullable<ModelInterface['chat']>): ModelInterface {
  return {
    name: 'Test Model',
    modelId: 'test-model',
    isSupportVision: () => true,
    isSupportToolUse: () => true,
    isSupportSystemMessage: () => true,
    chat: chatImpl,
    paint: vi.fn(async () => []),
  }
}

describe('streamText agent coding tools', () => {
  beforeEach(() => {
    createWorkspaceFileToolSetMock.mockClear()
    createTerminalToolSetMock.mockClear()
    injectModelSystemPromptMock.mockClear()
    convertToModelMessagesMock.mockClear()
    googleSearchProviderToolMock.mockClear()
  })

  it('registers workspace write tools only with a native capability and mutation gate, never terminal', async () => {
    let toolsArg: Record<string, unknown> | undefined
    const chat = vi.fn(async (_messages, options) => {
      toolsArg = options?.tools as Record<string, unknown>
      const result: StreamTextResult = { contentParts: [] }
      options?.onResultChange?.(result)
      return result
    })

    await streamText(createTestModel(chat), {
      sessionId: 'sess-live',
      messages: [createMessage('user', 'scaffold a react app')],
      onResultChangeWithCancel: vi.fn(),
      agentCoding: {
        enabled: true,
        workspaceRoot: '/Users/dev/project',
        capabilityId: 'cap-1',
        projectId: 'p1',
        rootGeneration: 'gen-1',
        mutationEnabled: true,
      },
    })

    expect(createWorkspaceFileToolSetMock).toHaveBeenCalledWith({
      capabilityId: 'cap-1',
      projectId: 'p1',
      rootGeneration: 'gen-1',
      mutationEnabled: true,
      sessionId: 'sess-live',
      turnId: '',
    })
    expect(createTerminalToolSetMock).not.toHaveBeenCalled()
    expect(toolsArg).toBeDefined()
    expect(toolsArg?.create_file).toBeDefined()
    expect(toolsArg?.edit_file).toBeDefined()
    expect(toolsArg?.delete_file).toBeDefined()
    expect(toolsArg?.terminal).toBeUndefined()
  })

  it('does not register mutation tools from a pasted workspaceRoot alone', async () => {
    const chat = vi.fn(async (_messages, options) => {
      const result: StreamTextResult = { contentParts: [] }
      options?.onResultChange?.(result)
      return result
    })

    await streamText(createTestModel(chat), {
      messages: [createMessage('user', 'scaffold a react app')],
      onResultChangeWithCancel: vi.fn(),
      agentCoding: {
        enabled: true,
        workspaceRoot: '/Users/dev/project',
      },
    })

    expect(createWorkspaceFileToolSetMock).not.toHaveBeenCalled()
    expect(createTerminalToolSetMock).not.toHaveBeenCalled()
  })

  it('does not register workspace tools without workspace root', async () => {
    let toolsArg: Record<string, unknown> | undefined
    const chat = vi.fn(async (_messages, options) => {
      toolsArg = options?.tools as Record<string, unknown>
      const result: StreamTextResult = { contentParts: [] }
      options?.onResultChange?.(result)
      return result
    })

    await streamText(createTestModel(chat), {
      messages: [createMessage('user', 'scaffold a react app')],
      onResultChangeWithCancel: vi.fn(),
      agentCoding: {
        enabled: true,
        workspaceRoot: undefined,
      },
    })

    expect(createWorkspaceFileToolSetMock).not.toHaveBeenCalled()
    expect(createTerminalToolSetMock).not.toHaveBeenCalled()
    expect(toolsArg?.create_file).toBeUndefined()
    expect(toolsArg?.terminal).toBeUndefined()

    const injected = injectModelSystemPromptMock.mock.calls[0]?.[2] as string
    expect(injected).toMatch(/Workspace not set|filesystem write|unavailable/i)
  })

  it('does not register workspace tools when agent coding disabled', async () => {
    const chat = vi.fn(async (_messages, options) => {
      const result: StreamTextResult = { contentParts: [] }
      options?.onResultChange?.(result)
      return result
    })

    await streamText(createTestModel(chat), {
      messages: [createMessage('user', 'hello')],
      onResultChangeWithCancel: vi.fn(),
      agentCoding: {
        enabled: false,
        workspaceRoot: '/Users/dev/project',
      },
    })

    expect(createWorkspaceFileToolSetMock).not.toHaveBeenCalled()
    expect(createTerminalToolSetMock).not.toHaveBeenCalled()
  })
})

describe('streamText Gemini search vs function tools', () => {
  beforeEach(() => {
    createWorkspaceFileToolSetMock.mockClear()
    createTerminalToolSetMock.mockClear()
    googleSearchProviderToolMock.mockClear()
    injectModelSystemPromptMock.mockClear()
  })

  it('uses web_search (not google grounding) when task tools are present', async () => {
    let toolsArg: Record<string, unknown> | undefined
    const chat = vi.fn(async (_messages, options) => {
      toolsArg = options?.tools as Record<string, unknown>
      const result: StreamTextResult = { contentParts: [] }
      options?.onResultChange?.(result)
      return result
    })

    await streamText(createTestModel(chat), {
      messages: [createMessage('user', 'research something')],
      onResultChangeWithCancel: vi.fn(),
      webBrowsing: true,
      nativeWebSearch: 'gemini-grounding',
    })

    expect(googleSearchProviderToolMock).not.toHaveBeenCalled()
    expect(toolsArg?.web_search).toBeDefined()
    expect(toolsArg?.parse_link).toBeDefined()
    expect(toolsArg?.google_search).toBeUndefined()
    expect(toolsArg?.create_task).toBeDefined()
  })

  it('uses google grounding when tools supported but task tools denylisted and no other function tools', async () => {
    let toolsArg: Record<string, unknown> | undefined
    const chat = vi.fn(async (_messages, options) => {
      toolsArg = options?.tools as Record<string, unknown>
      const result: StreamTextResult = { contentParts: [] }
      options?.onResultChange?.(result)
      return result
    })

    await streamText(createTestModel(chat), {
      messages: [createMessage('user', 'what is the weather')],
      onResultChangeWithCancel: vi.fn(),
      webBrowsing: true,
      nativeWebSearch: 'gemini-grounding',
      toolAccess: {
        mode: 'denylist',
        tools: ['create_task', 'update_task', 'list_tasks'],
        includeMcp: true,
      },
    })

    expect(googleSearchProviderToolMock).toHaveBeenCalled()
    expect(toolsArg?.google_search).toBeDefined()
    expect(toolsArg?.web_search).toBeUndefined()
    expect(toolsArg?.create_task).toBeUndefined()
  })
})
