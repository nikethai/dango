import type { ProviderInfo, ProviderModelInfo } from '@shared/types'
import { describe, expect, test } from 'vitest'
import {
  attachmentsNeedVision,
  getModelReadiness,
  isOcrModelSet,
  modelMeetsNeeds,
  readinessAllowsSend,
  turnNeedsTools,
  usableChatModel,
  usablePictureModel,
} from './modelReadiness'

const model = (modelId: string, capabilities: ProviderModelInfo['capabilities'] = []): ProviderModelInfo => ({
  modelId,
  capabilities,
})

const provider = (id: string, models: ProviderModelInfo[]): ProviderInfo =>
  ({
    id,
    name: id,
    type: 'openai',
    isCustom: false,
    models,
  }) as ProviderInfo

describe('getModelReadiness', () => {
  test('marks an absent selection as requiring setup', () => {
    expect(getModelReadiness(undefined, [provider('openai', [model('gpt-4o')])])).toEqual({
      status: 'setup-required',
    })
  })

  test('marks a selected provider absent from configured providers as unavailable', () => {
    expect(getModelReadiness({ provider: 'openai', modelId: 'gpt-4o' }, [])).toEqual({
      status: 'provider-unavailable',
      providerId: 'openai',
    })
  })

  test('marks a removed selected model as unavailable', () => {
    expect(getModelReadiness({ provider: 'openai', modelId: 'gpt-4o' }, [provider('openai', [])])).toEqual({
      status: 'model-unavailable',
      providerId: 'openai',
      modelId: 'gpt-4o',
    })
  })

  test('marks an explicitly non-vision model incompatible only when vision is required', () => {
    expect(
      getModelReadiness({ provider: 'openai', modelId: 'gpt-4o-mini' }, [provider('openai', [model('gpt-4o-mini')])], {
        requiresVision: true,
      })
    ).toEqual({
      status: 'capability-required',
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
      capability: 'vision',
    })
  })

  test('does not block an available model when its capability metadata is unknown', () => {
    expect(
      getModelReadiness({ provider: 'openai', modelId: 'gpt-4o' }, [provider('openai', [{ modelId: 'gpt-4o' }])], {
        requiresVision: true,
      })
    ).toEqual({
      status: 'ready',
      providerId: 'openai',
      modelId: 'gpt-4o',
    })
  })

  test('marks an available selected model ready', () => {
    expect(
      getModelReadiness({ provider: 'openai', modelId: 'gpt-4o' }, [provider('openai', [model('gpt-4o')])])
    ).toEqual({
      status: 'ready',
      providerId: 'openai',
      modelId: 'gpt-4o',
    })
  })
})

describe('ability checks before sending', () => {
  const selected = { provider: 'openai', modelId: 'm' }

  test('a model known not to use tools is blocked when the turn needs tools', () => {
    expect(
      getModelReadiness(selected, [provider('openai', [model('m', ['vision'])])], { requiresTools: true })
    ).toEqual({
      status: 'capability-required',
      providerId: 'openai',
      modelId: 'm',
      capability: 'tool_use',
    })
  })

  test('a tool-using model is ready when the turn needs tools', () => {
    expect(
      getModelReadiness(selected, [provider('openai', [model('m', ['tool_use'])])], { requiresTools: true })
    ).toEqual({ status: 'ready', providerId: 'openai', modelId: 'm' })
  })

  test('tools are not checked when the turn does not need them', () => {
    expect(getModelReadiness(selected, [provider('openai', [model('m', [])])], { requiresTools: false })).toEqual({
      status: 'ready',
      providerId: 'openai',
      modelId: 'm',
    })
  })

  test('unknown capabilities never block', () => {
    const providers = [provider('openai', [{ modelId: 'm' }])]
    const ready = { status: 'ready', providerId: 'openai', modelId: 'm' }
    expect(getModelReadiness(selected, providers, { requiresTools: true })).toEqual(ready)
    expect(getModelReadiness(selected, providers, { requiresVision: true })).toEqual(ready)
    expect(getModelReadiness(selected, providers, { requiresTools: true, requiresVision: true })).toEqual(ready)
    expect(modelMeetsNeeds({}, { requiresTools: true, requiresVision: true })).toBe(true)
  })

  test('modelMeetsNeeds checks each needed ability', () => {
    expect(modelMeetsNeeds(model('m', ['tool_use']), { requiresTools: true })).toBe(true)
    expect(modelMeetsNeeds(model('m', ['vision']), { requiresTools: true })).toBe(false)
    expect(modelMeetsNeeds(model('m', ['tool_use']), { requiresTools: true, requiresVision: true })).toBe(false)
    expect(modelMeetsNeeds(model('m', []), {})).toBe(true)
  })

  test.each([
    [{}, false],
    [{ agentMode: true }, true],
    [{ browserArmed: true }, true],
    [{ computerArmed: true }, true],
    [{ roomMode: 'swarm' }, true],
    [{ roomMode: 'work' }, false],
    [{ roomMode: 'discuss' }, false],
    [{ agentMode: false, browserArmed: false, computerArmed: false, roomMode: 'discuss' }, false],
  ])('turnNeedsTools(%o) is %s', (input, expected) => {
    expect(turnNeedsTools(input)).toBe(expected)
  })
})

describe('attachmentsNeedVision', () => {
  test('pictures need vision unless an OCR model reads them', () => {
    expect(attachmentsNeedVision({ pictureCount: 1, hasVideo: false, ocrReady: false })).toBe(true)
    expect(attachmentsNeedVision({ pictureCount: 1, hasVideo: false, ocrReady: true })).toBe(false)
  })

  test('video always needs vision; nothing attached needs none', () => {
    expect(attachmentsNeedVision({ pictureCount: 0, hasVideo: true, ocrReady: true })).toBe(true)
    expect(attachmentsNeedVision({ pictureCount: 0, hasVideo: false, ocrReady: false })).toBe(false)
  })

  test('an OCR model counts only when both provider and model are set', () => {
    expect(isOcrModelSet({ ocrModel: { provider: 'openai', model: 'gpt-4o' } })).toBe(true)
    expect(isOcrModelSet({ ocrModel: { provider: 'openai', model: '' } })).toBe(false)
    expect(isOcrModelSet({})).toBe(false)
  })
})

describe('usableChatModel', () => {
  const providers = [
    provider('a', [model('m1')]),
    provider('b', [model('m2')]),
    provider('comfyui', [model('txt2img')]),
  ]

  test('prefers the default when it is ready', () => {
    expect(
      usableChatModel(
        { defaultChatModel: { provider: 'a', model: 'm1' }, lastUsedChat: { provider: 'b', modelId: 'm2' } },
        providers
      )
    ).toEqual({ provider: 'a', modelId: 'm1' })
  })

  test('uses the last-used model when the default provider was removed', () => {
    expect(
      usableChatModel(
        { defaultChatModel: { provider: 'gone', model: 'm1' }, lastUsedChat: { provider: 'b', modelId: 'm2' } },
        providers
      )
    ).toEqual({ provider: 'b', modelId: 'm2' })
  })

  test('returns nothing when neither is ready', () => {
    expect(
      usableChatModel(
        {
          defaultChatModel: { provider: 'a', model: 'removed' },
          lastUsedChat: { provider: 'openai', modelId: 'gpt-4o' },
        },
        providers
      )
    ).toBeUndefined()
    expect(usableChatModel({}, providers)).toBeUndefined()
  })

  test('never picks ComfyUI for chat', () => {
    expect(usableChatModel({ lastUsedChat: { provider: 'comfyui', modelId: 'txt2img' } }, providers)).toBeUndefined()
  })
})

describe('usablePictureModel', () => {
  test('keeps the last-used picture model only when it is ready', () => {
    const providers = [provider('comfyui', [model('txt2img')])]
    expect(usablePictureModel({ provider: 'comfyui', modelId: 'txt2img' }, providers)).toEqual({
      provider: 'comfyui',
      modelId: 'txt2img',
    })
    expect(usablePictureModel({ provider: 'openai', modelId: 'gpt-image-1' }, providers)).toBeUndefined()
    expect(usablePictureModel(undefined, providers)).toBeUndefined()
  })
})

describe('readinessAllowsSend', () => {
  test('only a ready model sends, on every layout', () => {
    expect(readinessAllowsSend({ status: 'ready', providerId: 'a', modelId: 'm1' })).toBe(true)
    expect(readinessAllowsSend({ status: 'setup-required' })).toBe(false)
    expect(readinessAllowsSend({ status: 'provider-unavailable', providerId: 'gone' })).toBe(false)
    expect(readinessAllowsSend({ status: 'model-unavailable', providerId: 'a', modelId: 'old' })).toBe(false)
    expect(
      readinessAllowsSend({ status: 'capability-required', providerId: 'a', modelId: 'm1', capability: 'vision' })
    ).toBe(false)
  })
})
