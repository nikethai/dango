import type { ProviderInfo } from '@shared/types'
import { describe, expect, it } from 'vitest'
import type { ModelReadiness } from '@/utils/modelReadiness'
import { isLocalModel, quickChatName, quickErrorSummary, resolveQuickScope, resolveQuickView } from './quickChatState'

describe('resolveQuickScope', () => {
  it('keeps a scope that still exists and drops one that is gone', () => {
    expect(resolveQuickScope('acme', [{ id: 'acme' }])).toBe('acme')
    expect(resolveQuickScope('gone', [{ id: 'acme' }])).toBeNull()
    expect(resolveQuickScope(null, [{ id: 'acme' }])).toBeNull()
  })

  it('treats Everywhere as no specific scope', () => {
    expect(resolveQuickScope('everywhere', [{ id: 'everywhere' }, { id: 'acme' }])).toBeNull()
    expect(resolveQuickScope('everywhere', [])).toBeNull()
  })
})

describe('quickChatName', () => {
  it('uses the first non-empty line cut to 60 characters', () => {
    const name = quickChatName(
      '\n  What did we promise Acme about the deadline and the launch date for the new site?\nmore'
    )
    expect(name).toBe('What did we promise Acme about the deadline and the launch d…')
    expect([...name].length).toBeLessThanOrEqual(61)
  })

  it('keeps short questions whole', () => {
    expect(quickChatName('  Hello there  ')).toBe('Hello there')
    expect(quickChatName('   \n  ')).toBe('')
  })

  it('cuts by code points without lone surrogates', () => {
    const name = quickChatName('😀'.repeat(70))
    expect(name).toBe(`${'😀'.repeat(60)}…`)
    expect(name).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/)
  })
})

describe('isLocalModel', () => {
  const providers = [
    { id: 'ollama', name: 'Ollama', apiHost: 'http://127.0.0.1:11434' },
    { id: 'openai', name: 'OpenAI', apiHost: 'https://api.openai.com' },
    { id: 'lmstudio', name: 'LM', defaultSettings: { apiHost: 'http://localhost:1234' } },
  ] as unknown as ProviderInfo[]

  it('is true for a local host and false for a remote one', () => {
    expect(isLocalModel({ provider: 'ollama', modelId: 'm' }, providers)).toBe(true)
    expect(isLocalModel({ provider: 'openai', modelId: 'm' }, providers)).toBe(false)
    expect(isLocalModel({ provider: 'lmstudio', modelId: 'm' }, providers)).toBe(true)
  })

  it('falls back to the default host when the host was emptied', () => {
    const emptied = [
      { id: 'ollama', name: 'Ollama', apiHost: '', defaultSettings: { apiHost: 'http://127.0.0.1:11434' } },
    ] as unknown as ProviderInfo[]
    expect(isLocalModel({ provider: 'ollama', modelId: 'm' }, emptied)).toBe(true)
  })

  it('is false without a model or provider', () => {
    expect(isLocalModel(undefined, providers)).toBe(false)
    expect(isLocalModel({ provider: 'nope', modelId: 'm' }, providers)).toBe(false)
  })
})

describe('resolveQuickView', () => {
  const ready: ModelReadiness = { status: 'ready', providerId: 'openai', modelId: 'm' }
  const base = { readiness: ready, online: true, local: false, hasExchange: false, rewriting: false }

  it.each<ModelReadiness>([
    { status: 'setup-required' },
    { status: 'provider-unavailable', providerId: 'x' },
    { status: 'model-unavailable', providerId: 'x', modelId: 'y' },
  ])('returns no-model for %o even when offline', (readiness) => {
    expect(resolveQuickView({ ...base, readiness, online: false, rewriting: true })).toBe('no-model')
  })

  it('does not treat capability-required as no-model', () => {
    const readiness: ModelReadiness = {
      status: 'capability-required',
      providerId: 'x',
      modelId: 'y',
      capability: 'vision',
    }
    expect(resolveQuickView({ ...base, readiness })).toBe('empty')
  })

  it('is offline only for a remote model that is offline', () => {
    expect(resolveQuickView({ ...base, online: false })).toBe('offline')
    expect(resolveQuickView({ ...base, online: false, local: true })).toBe('empty')
  })

  it('puts rewrite over answered and offline', () => {
    expect(resolveQuickView({ ...base, hasExchange: true, rewriting: true })).toBe('rewrite')
    expect(resolveQuickView({ ...base, online: false, rewriting: true })).toBe('rewrite')
  })

  it('answers when there is an exchange, otherwise empty', () => {
    expect(resolveQuickView({ ...base, hasExchange: true })).toBe('answered')
    expect(resolveQuickView(base)).toBe('empty')
  })
})

describe('quickErrorSummary', () => {
  it('turns raw provider errors into one short sentence', () => {
    expect(quickErrorSummary('401 Unauthorized: {"error":"invalid_api_key"}')).toBe(
      "The model didn't accept its sign-in. Check it in Settings."
    )
    expect(quickErrorSummary('Request failed', 403)).toBe("The model didn't accept its sign-in. Check it in Settings.")
    expect(quickErrorSummary('429 Too Many Requests: rate_limit_exceeded')).toBe(
      'The model is busy or out of quota. Try again in a moment.'
    )
    // A rate limit whose body mentions the API key is still a rate limit.
    expect(quickErrorSummary('429: Rate limit reached for your API key')).toBe(
      'The model is busy or out of quota. Try again in a moment.'
    )
    expect(quickErrorSummary('Your api key has no quota left', 429)).toBe(
      'The model is busy or out of quota. Try again in a moment.'
    )
    expect(quickErrorSummary('TypeError: Failed to fetch')).toBe("Couldn't reach the model. Check your connection.")
    expect(quickErrorSummary("This model's maximum context length is 8192 tokens")).toBe(
      'This chat is too long for the model.'
    )
    expect(quickErrorSummary('Something odd {"a":1}')).toBe("The model couldn't answer. Try again.")
  })

  it('reads the status code before the keywords', () => {
    // A rejected sign-in whose body mentions quota is a sign-in problem.
    expect(quickErrorSummary('Your plan has no quota for this key', 401)).toBe(
      "The model didn't accept its sign-in. Check it in Settings."
    )
    expect(quickErrorSummary('403 Forbidden: insufficient permissions for quota')).toBe(
      "The model didn't accept its sign-in. Check it in Settings."
    )
    expect(quickErrorSummary('Invalid API key format', 429)).toBe(
      'The model is busy or out of quota. Try again in a moment.'
    )
  })
})
