import { settings as defaultSettings } from '@shared/defaults'
import { getSystemProviders } from '@shared/providers'
import { ModelProviderEnum, ModelProviderType, type ProviderSettings, type Settings } from '@shared/types'
import type { ModelDependencies } from '@shared/types/adapters'
import type { WritingRequest } from '@shared/types/writing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getWritingModels } from './models'
import { buildWritingMessages } from './prompt'

const mocks = vi.hoisted(() => ({
  settings: {} as Settings,
  dependencies: vi.fn(),
  streamText: vi.fn(),
}))

vi.mock('@/adapters', () => ({ createModelDependencies: mocks.dependencies }))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: { getState: () => ({ getSettings: () => mocks.settings }) },
}))
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  streamText: mocks.streamText,
}))

import { requestWritingRewrite } from './runtime'

const network = vi.fn(() => {
  throw new Error('Network is forbidden in offline compatibility tests')
})
const dependencies = {
  storage: { saveImage: vi.fn(), getImage: vi.fn() },
  request: { fetchWithOptions: network, apiRequest: network },
  sentry: { withScope: vi.fn(), captureException: vi.fn() },
  getRemoteConfig: vi.fn(),
} satisfies ModelDependencies

// Enumerate independently of eligibility so new registered adapters get exercised, not silently skipped.
const textProviders = getSystemProviders().filter(
  (provider) => provider.id !== ModelProviderEnum.OpenClaw && provider.id !== ModelProviderEnum.ComfyUI
)
const customTypes = [
  ModelProviderType.OpenAI,
  ModelProviderType.OpenAIResponses,
  ModelProviderType.Claude,
  ModelProviderType.Gemini,
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', network)
  mocks.settings = {
    ...defaultSettings(),
    defaultPrompt: 'UNRELATED_CHAT_POLICY_SENTINEL',
    injectDefaultMetadata: true,
    providers: {},
  }
  mocks.dependencies.mockResolvedValue(dependencies)
  mocks.streamText.mockImplementation(() => ({
    fullStream: [{ type: 'text-delta', id: 'text', text: 'Revised draft' }],
    text: Promise.resolve('Revised draft'),
    totalUsage: Promise.resolve({ inputTokens: 5, outputTokens: 3, totalTokens: 8 }),
    finishReason: Promise.resolve('stop'),
    providerMetadata: Promise.resolve({}),
  }))
})

afterEach(() => {
  expect(network).not.toHaveBeenCalled()
  expect(dependencies.storage.saveImage).not.toHaveBeenCalled()
  expect(dependencies.storage.getImage).not.toHaveBeenCalled()
  expect(dependencies.sentry.withScope).not.toHaveBeenCalled()
  expect(dependencies.sentry.captureException).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})

function configure(provider: string, modelId: string, overrides: ProviderSettings = {}): WritingRequest {
  mocks.settings.providers = {
    [provider]: {
      apiKey: 'offline-placeholder',
      apiHost: 'https://provider.invalid',
      endpoint: 'https://azure.invalid',
      deploymentName: modelId,
      authMode: 'api_key',
      models: [{ modelId, type: 'chat', capabilities: ['reasoning', 'vision', 'tool_use'] }],
      ...overrides,
    },
  }
  return { draft: 'PRIVATE_DRAFT_SENTINEL', style: 'clearer', model: { provider, modelId } }
}

async function expectIsolatedAdapterCall(request: WritingRequest) {
  const signal = new AbortController().signal
  const result = await requestWritingRewrite(request, { signal })
  expect(result.text).toBe('Revised draft')
  expect(result.usage?.totalTokens).toBe(8)
  expect(mocks.streamText).toHaveBeenCalledTimes(1)
  const call = mocks.streamText.mock.calls[0][0]
  expect(call.messages).toEqual(buildWritingMessages(request))
  expect(call.model.modelId).toBe(request.model.modelId)
  expect(call.tools).toEqual({})
  expect(call.abortSignal).toBe(signal)
  expect(call.prepareStep).toBeUndefined()
  expect(call.stopWhen({ steps: [{}] })).toBe(true)
  expect(JSON.stringify(call.messages)).not.toContain('UNRELATED_CHAT_POLICY_SENTINEL')
  return call
}

describe('writing through real provider factories and adapter settings (offline SDK boundary)', () => {
  it.each(textProviders)(
    '$id: preserves selected model, isolated messages, usage, cancellation and empty tools',
    async (base) => {
      const modelId = getWritingModels(base)[0]?.modelId || 'configured-local-model'
      await expectIsolatedAdapterCall(configure(base.id, modelId))
    }
  )

  it.each(textProviders)(
    '$id: redacts adapter failures without fallback or content-bearing diagnostics',
    async (base) => {
      mocks.streamText.mockImplementation(() => {
        throw new Error('PRIVATE_DRAFT_SENTINEL echoed by provider')
      })
      const modelId = getWritingModels(base)[0]?.modelId || 'configured-local-model'
      await expect(
        requestWritingRewrite(configure(base.id, modelId), { signal: new AbortController().signal })
      ).rejects.toMatchObject({ code: 'request_failed', message: 'request_failed' })
      expect(mocks.streamText).toHaveBeenCalledTimes(1)
    }
  )

  it.each(customTypes)('custom %s: preserves the configured text model and isolated policy', async (type) => {
    const id = `custom-${type}`
    mocks.settings.customProviders = [{ id, type, name: 'Custom fixture', isCustom: true }]
    await expectIsolatedAdapterCall(configure(id, 'configured-text-model'))
  })

  it.each([
    { provider: ModelProviderEnum.OpenAI, modelId: 'gpt-5.1', sdkProvider: 'openai.responses' },
    { provider: ModelProviderEnum.Gemini, modelId: 'gemini-3-pro-high', sdkProvider: 'google.generative-ai' },
    { provider: ModelProviderEnum.XAI, modelId: 'grok-4', sdkProvider: 'xAI.chat' },
  ])('$provider OAuth: uses the existing authenticated adapter without switching models', async (fixture) => {
    const request = configure(fixture.provider, fixture.modelId, {
      authMode: 'oauth',
      oauth: { accessToken: 'offline-oauth-placeholder', accountId: 'offline-account', projectId: 'offline-project' },
    })
    const call = await expectIsolatedAdapterCall(request)
    expect(call.model.provider).toBe(fixture.sdkProvider)
  })

  it('Perplexity: forwards a no-search policy, without enabling native tools', async () => {
    const call = await expectIsolatedAdapterCall(configure(ModelProviderEnum.Perplexity, 'sonar'))
    expect(call.providerOptions.perplexity).toEqual({ disable_search: true })
  })
})
