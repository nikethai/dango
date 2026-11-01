import { describe, expect, it } from 'vitest'
import { getModel } from './index'
import { isProviderSetUp } from './provider-credentials'

const settings = {
  customProviders: [{ id: 'custom-provider-a', name: 'A', type: 'openai', isCustom: true }],
  providers: { openai: { apiKey: '' }, ollama: { models: [{ modelId: 'llama3' }] }, claude: { apiKey: 'k' } },
} as never

describe('isProviderSetUp', () => {
  it('counts a created custom provider, a keyed built-in and a local provider with models', () => {
    expect(isProviderSetUp('custom-provider-a', settings)).toBe(true)
    expect(isProviderSetUp('claude', settings)).toBe(true)
    expect(isProviderSetUp('ollama', settings)).toBe(true)
  })

  it('does not count a built-in without a key, a deleted custom provider or an empty local one', () => {
    expect(isProviderSetUp('openai', settings)).toBe(false)
    expect(isProviderSetUp('custom-provider-gone', settings)).toBe(false)
    expect(isProviderSetUp('lm-studio', settings)).toBe(false)
  })

  it('counts OpenClaw and ComfyUI by their default models, as the model picker does', () => {
    expect(isProviderSetUp('openclaw', settings, 1)).toBe(true)
    expect(isProviderSetUp('openclaw', settings, 0)).toBe(false)
  })
})

describe('getModel', () => {
  const call = (provider?: string) => getModel({ provider, modelId: 'gpt-4o' }, settings, {} as never, {} as never)

  it('refuses a chat without a model with the "not set up" error, never a raw string', () => {
    expect(() => call(undefined)).toThrow(expect.objectContaining({ code: 20038 }))
  })

  it('refuses a provider the user never set up, such as OpenAI without a key', () => {
    expect(() => call('openai')).toThrow(expect.objectContaining({ code: 20038 }))
  })

  it("names a custom provider's model after the provider, for error text (finding 5)", () => {
    const model = call('custom-provider-a') as { name: string; displayName?: string }
    expect(model.displayName).toBe('A')
    expect(model.name).toBe('Custom OpenAI')
  })
})
