import type { Config, Settings } from '@shared/types'
import type { ModelDependencies } from '@shared/types/adapters'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const chat = vi.fn()

vi.mock('@shared/models', () => ({ getModel: vi.fn(() => ({ chat })) }))
vi.mock('@/utils/xai-auth-refresh', () => ({ refreshXaiAuthIfNeeded: vi.fn(async (s: unknown) => s) }))
vi.mock('@/utils/openai-codex-auth-refresh', () => ({ refreshOpenAICodexAuthIfNeeded: vi.fn(async (s: unknown) => s) }))
vi.mock('@/utils/gemini-antigravity-auth-refresh', () => ({
  refreshGeminiAntigravityAuthIfNeeded: vi.fn(async (s: unknown) => s),
}))

import { testBasicModelRequest } from './model-tester'

const options = {
  providerId: 'claude',
  modelId: 'claude-opus-4-1',
  settings: {} as Settings,
  configs: {} as Config,
  dependencies: {} as ModelDependencies,
}

beforeEach(() => {
  chat.mockReset()
})

describe('testBasicModelRequest', () => {
  it('sends one basic request only (no vision or tool calls)', async () => {
    chat.mockResolvedValue({})
    const states: unknown[] = []
    const result = await testBasicModelRequest({ ...options, onStateChange: (s) => states.push(s) })
    expect(chat).toHaveBeenCalledTimes(1)
    expect(result.basicTest).toEqual({ status: 'success' })
    expect(result.visionTest).toBeUndefined()
    expect(result.toolTest).toBeUndefined()
    expect(result.testing).toBe(false)
    expect(states[0]).toMatchObject({ testing: true, basicTest: { status: 'pending' } })
  })

  it('reports the request error on basicTest', async () => {
    chat.mockRejectedValue(new Error('401 Unauthorized'))
    const result = await testBasicModelRequest(options)
    expect(chat).toHaveBeenCalledTimes(1)
    expect(result.basicTest).toEqual({ status: 'error', error: '401 Unauthorized' })
  })
})
