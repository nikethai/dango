import { describe, expect, it } from 'vitest'
import { isLocalModel, isLocalModelIn, providerHost } from './model-check'

const local = (providerId: string, host: string, modelId = 'llama3') => isLocalModel({ providerId, host, modelId })

describe('isLocalModel', () => {
  it('is local only on Ollama or LM Studio at a loopback host with a model that is not a cloud model', () => {
    expect(local('ollama', 'http://127.0.0.1:11434')).toBe(true)
    expect(local('ollama', 'http://localhost:11434')).toBe(true)
    expect(local('lm-studio', 'http://[::1]:1234')).toBe(true)
    expect(local('ollama', '127.0.0.1:11434')).toBe(true) // no scheme
    expect(local('ollama', 'http://192.168.1.20:11434')).toBe(false)
    expect(local('ollama', 'https://ollama.example.com')).toBe(false)
    expect(local('ollama', 'http://127.0.0.1:11434', 'gpt-oss:120b-cloud')).toBe(false)
    expect(local('openai', 'http://localhost:8080')).toBe(false)
    expect(local('ollama', '')).toBe(false)
  })

  it('reads the host the request goes to, not text that looks like one', () => {
    expect(local('ollama', 'localhost:11434')).toBe(true) // no scheme; not a "localhost:" scheme
    expect(local('ollama', '  http://LOCALHOST:11434/  ')).toBe(true)
    expect(local('ollama', 'http://127.0.0.1@evil.com')).toBe(false)
    expect(local('ollama', 'http://evil.com#@127.0.0.1')).toBe(false)
    expect(local('ollama', 'http://localhost.evil.com:11434')).toBe(false)
    expect(local('ollama', 'http://localhost.:11434')).toBe(false)
    expect(local('ollama', 'http://127.0.0.2:11434')).toBe(false)
    expect(local('ollama', 'http://0.0.0.0:11434')).toBe(false)
    expect(local('ollama', 'http://[::ffff:127.0.0.1]:11434')).toBe(false)
    expect(local('ollama', 'http://10.0.0.5:11434')).toBe(false)
    expect(local('ollama', '//evil.com')).toBe(false)
    expect(local('ollama', 'not a host')).toBe(false)
  })

  it('treats any cloud model id as cloud, and a missing provider or model as cloud', () => {
    expect(local('ollama', 'http://127.0.0.1:11434', 'qwen3-coder:480b-cloud')).toBe(false)
    expect(local('ollama', 'http://127.0.0.1:11434', 'deepseek:cloud')).toBe(false)
    expect(local('ollama', 'http://127.0.0.1:11434', 'Kimi-K2:CLOUD')).toBe(false)
    expect(local('ollama', 'http://127.0.0.1:11434', 'cloud')).toBe(false)
    expect(local('ollama', 'http://127.0.0.1:11434', 'm:cloud ')).toBe(false)
    expect(local('ollama', 'http://127.0.0.1:11434', 'cloudy-llama')).toBe(true)
    expect(local('ollama', 'http://127.0.0.1:11434', '')).toBe(false)
    expect(isLocalModel({ providerId: null, host: 'http://127.0.0.1:11434', modelId: 'm' })).toBe(false)
    expect(isLocalModel({ providerId: 'ollama', host: null, modelId: 'm' })).toBe(false)
  })
})

describe('isLocalModelIn', () => {
  it('resolves the host like the provider sends', () => {
    expect(isLocalModelIn({}, { provider: 'ollama', modelId: 'm' })).toBe(true) // definition default host
    expect(
      isLocalModelIn(
        { providers: { ollama: { apiHost: 'http://10.0.0.5:11434' } } },
        { provider: 'ollama', modelId: 'm' }
      )
    ).toBe(false)
    expect(isLocalModelIn({}, null)).toBe(false)
  })

  it('takes an emptied host field as the default loopback host', () => {
    expect(isLocalModelIn({ providers: { ollama: { apiHost: '' } } }, { provider: 'ollama', modelId: 'm' })).toBe(true)
    // A host of only spaces is kept and trimmed to '', which the model sends to its OpenAI default: cloud.
    expect(
      isLocalModelIn({ providers: { 'lm-studio': { apiHost: '  ' } } }, { provider: 'lm-studio', modelId: 'm' })
    ).toBe(false)
    expect(isLocalModelIn(undefined, { provider: 'ollama', modelId: 'm' })).toBe(true)
  })

  it('counts a cloud model, a LAN host or an OpenAI-compatible custom provider on localhost as cloud', () => {
    expect(isLocalModelIn({}, { provider: 'ollama', modelId: 'gpt-oss:120b-cloud' })).toBe(false)
    expect(
      isLocalModelIn(
        { providers: { 'lm-studio': { apiHost: 'http://192.168.1.20:1234' } } },
        { provider: 'lm-studio', modelId: 'm' }
      )
    ).toBe(false)
    const customProviders = [
      {
        id: 'custom-local',
        name: 'My llama.cpp',
        type: 'openai',
        isCustom: true as const,
        defaultSettings: { apiHost: 'http://127.0.0.1:8080' },
      },
    ] as never
    expect(isLocalModelIn({ customProviders }, { provider: 'custom-local', modelId: 'm' })).toBe(false)
    expect(isLocalModelIn({}, { provider: 'openai', modelId: 'm' })).toBe(false)
    expect(isLocalModelIn({}, { provider: 'ollama' })).toBe(false)
  })
})

describe('providerHost', () => {
  it('prefers the saved host, then the system or custom default, and never throws', () => {
    expect(providerHost({}, 'ollama')).toBe('http://127.0.0.1:11434')
    expect(providerHost({ providers: { ollama: { apiHost: ' http://localhost:9 ' } } }, 'ollama')).toBe(
      'http://localhost:9'
    )
    const customProviders = [
      { id: 'c1', name: 'C', type: 'openai', isCustom: true as const, defaultSettings: { apiHost: 'http://h:1' } },
    ] as never
    expect(providerHost({ customProviders }, 'c1')).toBe('http://h:1')
    expect(providerHost(undefined, 'nope')).toBe('')
  })
})
