import type { WritingRequest } from '@shared/types/writing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getModel: vi.fn(),
  getProviderSettings: vi.fn(),
  dependencies: vi.fn(),
  chat: vi.fn(),
  getSettings: vi.fn(),
}))

vi.mock('@shared/models', () => ({ getModel: mocks.getModel, getProviderSettings: mocks.getProviderSettings }))
vi.mock('@/adapters', () => ({ createModelDependencies: mocks.dependencies }))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: { getState: () => ({ getSettings: mocks.getSettings }) },
}))

import { getWritingModelOptions } from './models'
import { requestWritingRewrite } from './runtime'

const request: WritingRequest = {
  draft: 'PRIVATE_DRAFT_SENTINEL',
  style: 'clearer',
  model: { provider: 'gemini', modelId: 'gemini-test' },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.dependencies.mockResolvedValue({})
  mocks.getModel.mockReturnValue({ chat: mocks.chat })
  mocks.getProviderSettings.mockImplementation((selection) => ({
    providerBaseInfo: { id: selection.provider, name: 'Test', type: 'openai' },
    providerSetting: { models: [{ modelId: request.model.modelId }] },
  }))
  mocks.getSettings.mockReturnValue({
    defaultPrompt: 'UNRELATED_SYSTEM_PROMPT',
    injectDefaultMetadata: true,
    providers: {},
  })
  mocks.chat.mockResolvedValue({ contentParts: [{ type: 'text', text: 'Revised draft' }], finishReason: 'stop' })
})

describe('writing runtime', () => {
  it('uses minimal session settings and disables injected metadata', async () => {
    await requestWritingRewrite(request, { signal: new AbortController().signal })
    expect(mocks.getModel.mock.calls[0][0]).toEqual({ ...request.model, stream: true })
    expect(mocks.getModel.mock.calls[0][1].injectDefaultMetadata).toBe(false)
    expect(JSON.stringify(mocks.chat.mock.calls)).not.toContain('UNRELATED_SYSTEM_PROMPT')
    expect(mocks.chat.mock.calls[0][1].contentPrivacy).toBe('ephemeral')
    expect(mocks.chat.mock.calls[0][1].purpose).toBe('writing')
  })

  it.each(['openclaw', 'comfyui', 'chatbox-ai'])(
    'refuses the %s backend before initializing dependencies',
    async (provider) => {
      // Use actual enum IDs below to avoid treating a custom provider as a builtin.
      const { ModelProviderEnum } = await import('@shared/types')
      const ids = {
        openclaw: ModelProviderEnum.OpenClaw,
        comfyui: ModelProviderEnum.ComfyUI,
        'chatbox-ai': ModelProviderEnum.ChatboxAI,
      }
      await expect(
        requestWritingRewrite(
          { ...request, model: { ...request.model, provider: ids[provider as keyof typeof ids] } },
          {
            signal: new AbortController().signal,
          }
        )
      ).rejects.toMatchObject({ code: 'unsupported_model' })
      expect(mocks.dependencies).not.toHaveBeenCalled()
    }
  )

  it('allows Perplexity with the writing purpose for its no-search adapter policy', async () => {
    const input = { ...request, model: { ...request.model, provider: 'perplexity' } }
    await requestWritingRewrite(input, { signal: new AbortController().signal })
    expect(mocks.getModel.mock.calls[0][0]).toEqual({ ...input.model, stream: true })
    expect(mocks.chat.mock.calls[0][1].purpose).toBe('writing')
  })

  it.each([
    { modelId: 'text-embedding-v3', type: 'embedding' },
    { modelId: 'rerank-v1', type: 'rerank' },
    { modelId: 'gpt-image-1' },
    { modelId: 'pixels', capabilities: ['image_generation'] },
  ])('rejects a direct request for non-text model $modelId', async (model) => {
    mocks.getProviderSettings.mockReturnValue({
      providerBaseInfo: { id: request.model.provider, name: 'Test', type: 'gemini' },
      providerSetting: { models: [model] },
    })
    await expect(
      requestWritingRewrite(
        { ...request, model: { ...request.model, modelId: model.modelId } },
        { signal: new AbortController().signal }
      )
    ).rejects.toMatchObject({ code: 'unsupported_model' })
    expect(mocks.dependencies).not.toHaveBeenCalled()
    expect(mocks.chat).not.toHaveBeenCalled()
  })

  it('rejects a removed model instead of silently using a fallback', async () => {
    await expect(
      requestWritingRewrite(
        { ...request, model: { ...request.model, modelId: 'removed-model' } },
        { signal: new AbortController().signal }
      )
    ).rejects.toMatchObject({ code: 'unsupported_model' })
    expect(mocks.getModel).not.toHaveBeenCalled()
  })

  it('rejects an unknown or deleted provider before initializing dependencies', async () => {
    mocks.getProviderSettings.mockImplementation(() => {
      throw new Error('Cannot find provider')
    })
    await expect(requestWritingRewrite(request, { signal: new AbortController().signal })).rejects.toMatchObject({
      code: 'unsupported_model',
    })
    expect(mocks.dependencies).not.toHaveBeenCalled()
  })

  it.each(['comfyui', 'chatbox-ai'])('rejects the custom %s API format', async (type) => {
    mocks.getProviderSettings.mockReturnValue({
      providerBaseInfo: { id: 'custom-test', name: 'Test', isCustom: true, type },
      providerSetting: { models: [{ modelId: request.model.modelId }] },
    })
    await expect(
      requestWritingRewrite(
        { ...request, model: { ...request.model, provider: 'custom-test' } },
        { signal: new AbortController().signal }
      )
    ).rejects.toMatchObject({ code: 'unsupported_model' })
    expect(mocks.dependencies).not.toHaveBeenCalled()
  })

  it('does not reveal a provider error that echoes private data', async () => {
    mocks.chat.mockRejectedValue(new Error('Provider rejected PRIVATE_DRAFT_SENTINEL with token SECRET'))
    const error = await requestWritingRewrite(request, { signal: new AbortController().signal }).catch((error) => error)
    expect(error.code).toBe('request_failed')
    expect(error.message).not.toContain('PRIVATE_DRAFT_SENTINEL')
    expect(error.message).not.toContain('SECRET')
  })

  it('rechecks cancellation after asynchronous initialization', async () => {
    const controller = new AbortController()
    mocks.dependencies.mockImplementation(() => {
      controller.abort()
      return Promise.resolve({})
    })
    await expect(requestWritingRewrite(request, { signal: controller.signal })).rejects.toHaveProperty(
      'name',
      'AbortError'
    )
    expect(mocks.getModel).not.toHaveBeenCalled()
  })

  it('filters non-text and remote-agent options', () => {
    expect(
      getWritingModelOptions([
        { id: 'gemini', name: 'Gemini', models: [{ modelId: 'text' }, { modelId: 'paint', type: 'image' }] },
        { id: 'openclaw', name: 'OpenClaw', models: [{ modelId: 'agent' }] },
      ] as Parameters<typeof getWritingModelOptions>[0])
    ).toEqual([
      { group: 'Gemini', items: [{ value: JSON.stringify({ provider: 'gemini', modelId: 'text' }), label: 'text' }] },
    ])
  })
})
