import type { ModelDependencies } from '@shared/types/adapters'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/adapters', () => ({
  createModelDependencies: vi.fn(),
}))

const memorySettings = vi.hoisted(() => ({ enabled: false }))
vi.mock('@/stores/memoryStore', () => ({
  memoryStore: {
    getState: () => ({
      ready: true,
      settings: memorySettings,
      globalBank: { scope: 'global', entries: [], profileSummary: '', version: 1 },
      agentBanks: {},
    }),
  },
}))

vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: () => ({
      userPersonalInfo: { enableInjection: false, entries: [] },
    }),
  },
}))

vi.mock('@/packages/memory/inject', () => ({
  buildMemoryInjectBlock: () => '## Memory\n- Old bank note',
}))

import { knowledgeStore } from '@/packages/knowledge/store'
import { convertToModelMessages, injectModelSystemPrompt } from './message-utils'

const dependencies: ModelDependencies = {
  request: {
    fetchWithOptions: vi.fn(),
    apiRequest: vi.fn(),
  },
  storage: {
    saveImage: vi.fn(),
    getImage: vi.fn(),
  },
  sentry: {
    captureException: vi.fn(),
    withScope: vi.fn(),
  },
  getRemoteConfig: vi.fn(),
}

describe('convertToModelMessages', () => {
  it('adds selected memory to the model payload without changing visible user text', async () => {
    const result = await convertToModelMessages(
      [
        {
          id: 'user-1',
          role: 'user',
          contentParts: [{ type: 'text', text: 'Help me plan this project' }],
          memoryAttachments: [
            {
              id: 'memory-1',
              content: 'The project uses TypeScript and React.',
              tags: ['project', 'stack'],
            },
          ],
        },
      ],
      { modelSupportVision: true, dependencies }
    )

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Help me plan this project' },
          {
            type: 'text',
            text: 'User-selected memory for this turn:\n- The project uses TypeScript and React. [tags: project, stack]',
          },
        ],
      },
    ])
  })

  it('prepends structured quote attachment as markdown blockquote context', async () => {
    const result = await convertToModelMessages(
      [
        {
          id: 'user-2',
          role: 'user',
          contentParts: [{ type: 'text', text: 'Can you expand on this?' }],
          quoteAttachment: {
            sourceMessageId: 'assistant-1',
            sourceRole: 'assistant',
            text: 'Line one\nLine two',
            isPartial: true,
          },
        },
      ],
      { modelSupportVision: true, dependencies }
    )

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Quoted partial selection (assistant):\n> Line one\n> Line two',
          },
          { type: 'text', text: 'Can you expand on this?' },
        ],
      },
    ])
  })

  it('fills tool-only assistant turns so Gemini does not get empty content', async () => {
    const result = await convertToModelMessages(
      [
        {
          id: 'assistant-tools',
          role: 'assistant',
          contentParts: [
            {
              type: 'tool-call',
              state: 'result',
              toolCallId: 't1',
              toolName: 'create_task',
              args: { title: 'Step 1' },
              result: { id: 'task-1', title: 'Step 1', status: 'done' },
            },
          ],
        },
      ],
      { modelSupportVision: true, dependencies }
    )

    expect(result).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'text', text: '(Completed tools: create_task)' }],
      },
    ])
  })

  it('drops empty user turns that would invalidate Gemini requests', async () => {
    const result = await convertToModelMessages(
      [
        {
          id: 'user-empty',
          role: 'user',
          contentParts: [],
        },
        {
          id: 'user-ok',
          role: 'user',
          contentParts: [{ type: 'text', text: 'hello' }],
        },
      ],
      { modelSupportVision: true, dependencies }
    )

    expect(result).toEqual([
      {
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
      },
    ])
  })

  it('keeps assistant reasoning parts out of resend payloads by default', async () => {
    const result = await convertToModelMessages(
      [
        {
          id: 'assistant-1',
          role: 'assistant',
          contentParts: [
            { type: 'reasoning', text: 'hidden chain' },
            { type: 'text', text: 'final answer' },
          ],
        },
      ],
      { modelSupportVision: true, dependencies }
    )

    expect(result).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'final answer' }],
      },
    ])
  })

  it('includes assistant reasoning parts in resend payloads when enabled', async () => {
    const result = await convertToModelMessages(
      [
        {
          id: 'assistant-1',
          role: 'assistant',
          contentParts: [
            { type: 'reasoning', text: 'hidden chain' },
            { type: 'text', text: 'final answer' },
          ],
        },
      ],
      {
        modelSupportVision: true,
        dependencies,
        includeAssistantReasoning: true,
      }
    )

    expect(result).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'hidden chain' },
          { type: 'text', text: 'final answer' },
        ],
      },
    ])
  })
})

describe('injectModelSystemPrompt', () => {
  const messages = [
    { id: 's', role: 'system' as const, contentParts: [{ type: 'text' as const, text: 'Be helpful.' }] },
    { id: 'u', role: 'user' as const, contentParts: [{ type: 'text' as const, text: 'When is launch?' }] },
  ]
  const section = '\n## Approved knowledge: Acme\n- Launch is 6 Nov\n'
  const systemText = (out: ReturnType<typeof injectModelSystemPrompt>) =>
    out[0].contentParts.map((p) => (p.type === 'text' ? p.text : '')).join('')

  // Reset even when an assertion fails, so later tests start from memory off and no move.
  afterEach(() => {
    memorySettings.enabled = false
    knowledgeStore.setState({ migration: 'unknown' })
  })

  it('knowledge section is in the system prompt and memory section is not once migration is done', () => {
    memorySettings.enabled = true
    knowledgeStore.setState({ migration: 'unknown' })
    const before = systemText(injectModelSystemPrompt('m', messages, 'info', 'system', undefined, section))
    expect(before).toContain('Old bank note')
    expect(before).toContain('Approved knowledge: Acme')
    expect(before.indexOf('Approved knowledge: Acme')).toBeLessThan(before.indexOf('Old bank note'))

    knowledgeStore.setState({ migration: 'done' })
    const after = systemText(injectModelSystemPrompt('m', messages, 'info', 'system', undefined, section))
    expect(after).toContain('## Approved knowledge: Acme\n- Launch is 6 Nov')
    expect(after).not.toContain('Old bank note')
    expect(after).toContain('Be helpful.')
  })
})
