import { describe, expect, it } from 'vitest'
import { obviousDefaultChatModel } from './ensureDefaultChatModel'

// A custom provider is set up once it lists models; a built-in one once it has a key.
const custom = (id: string) => ({ id, name: id, type: 'openai', isCustom: true })
const settingsWith = (opts: {
  custom?: string[]
  keyed?: string[]
  defaultChatModel?: { provider: string; model: string }
}) =>
  ({
    customProviders: (opts.custom ?? []).map(custom),
    providers: {
      ...Object.fromEntries((opts.custom ?? []).map((id) => [id, { models: [{ modelId: 'm1' }] }])),
      ...Object.fromEntries((opts.keyed ?? []).map((id) => [id, { apiKey: 'test-key', models: [{ modelId: 'k1' }] }])),
    },
    defaultChatModel: opts.defaultChatModel,
  }) as never

describe('obviousDefaultChatModel', () => {
  it('picks the one provider set up outside the model step', () => {
    expect(obviousDefaultChatModel(settingsWith({ custom: ['custom-provider-a'] }), undefined)).toEqual({
      provider: 'custom-provider-a',
      model: 'm1',
    })
  })

  it('chooses nothing when two providers are set up', () => {
    expect(
      obviousDefaultChatModel(settingsWith({ custom: ['custom-provider-a'], keyed: ['openai'] }), undefined)
    ).toBeUndefined()
  })

  it('never replaces a default that still works', () => {
    expect(
      obviousDefaultChatModel(
        settingsWith({
          custom: ['custom-provider-a'],
          defaultChatModel: { provider: 'custom-provider-a', model: 'm1' },
        }),
        undefined
      )
    ).toBeUndefined()
  })

  it('leaves a usable last-used model to background work instead of choosing one', () => {
    expect(
      obviousDefaultChatModel(settingsWith({ custom: ['custom-provider-a'] }), {
        provider: 'custom-provider-a',
        modelId: 'm1',
      })
    ).toBeUndefined()
  })

  it('replaces a default whose provider was removed when one provider is left', () => {
    expect(
      obviousDefaultChatModel(
        settingsWith({
          custom: ['custom-provider-b'],
          defaultChatModel: { provider: 'custom-provider-gone', model: 'm1' },
        }),
        undefined
      )
    ).toEqual({ provider: 'custom-provider-b', model: 'm1' })
  })

  it('does not count ComfyUI or an unconfigured OpenClaw listed only by their default models', () => {
    expect(obviousDefaultChatModel(settingsWith({}), undefined)).toBeUndefined()
  })
})
