import type { Settings } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const testBasicModelRequest = vi.fn()
const testModelCapabilities = vi.fn()
const storeState = { providers: { claude: { apiKey: 'stored' } } } as unknown as Settings

vi.mock('@/utils/model-tester', () => ({
  testBasicModelRequest: (...args: unknown[]) => testBasicModelRequest(...args),
  testModelCapabilities: (...args: unknown[]) => testModelCapabilities(...args),
}))
vi.mock('@/adapters', () => ({ createModelDependencies: vi.fn(async () => ({ deps: true })) }))
vi.mock('@/platform', () => ({ default: { getConfig: vi.fn(async () => ({ uuid: 'c' })) } }))
vi.mock('@/stores/settingsStore', () => ({ settingsStore: { getState: () => storeState } }))

import { checkProviderKey, classifyKeyError, firstModelId } from './checkProviderKey'

type Options = { onStateChange?: (s: unknown) => void; settings: Settings; providerId: string; modelId: string }

function emitting(basicTest: { status: 'success' | 'error'; error?: string }) {
  return (options: Options) => {
    options.onStateChange?.({ testing: true, basicTest: { status: 'pending' } })
    options.onStateChange?.({ testing: true, basicTest })
    // Never settles: checkProviderKey must resolve on the state change alone.
    return new Promise(() => {})
  }
}

beforeEach(() => {
  testBasicModelRequest.mockReset()
  testModelCapabilities.mockReset()
})

describe('checkProviderKey', () => {
  it("resolves 'ok' once the basic test succeeds, without the vision or tool tests", async () => {
    testBasicModelRequest.mockImplementation(emitting({ status: 'success' }))
    await expect(checkProviderKey('claude', 'claude-opus-4-1')).resolves.toBe('ok')
    expect(testModelCapabilities).not.toHaveBeenCalled()
    const options = testBasicModelRequest.mock.calls[0][0] as Options
    expect(options.providerId).toBe('claude')
    expect(options.modelId).toBe('claude-opus-4-1')
    expect(options.settings).toBe(storeState)
  })

  it("resolves 'rejected' for an authorization error", async () => {
    testBasicModelRequest.mockImplementation(emitting({ status: 'error', error: '401 Unauthorized' }))
    await expect(checkProviderKey('openai', 'gpt-4o')).resolves.toBe('rejected')
  })

  it("resolves 'unreachable' for any other error", async () => {
    testBasicModelRequest.mockImplementation(emitting({ status: 'error', error: 'fetch failed' }))
    await expect(checkProviderKey('openai', 'gpt-4o')).resolves.toBe('unreachable')
  })

  it('tests against the candidate settings when given, not the saved ones', async () => {
    testBasicModelRequest.mockImplementation(emitting({ status: 'success' }))
    const candidate = { providers: { claude: { apiKey: 'candidate' } } } as unknown as Settings
    await checkProviderKey('claude', 'claude-opus-4-1', candidate)
    expect((testBasicModelRequest.mock.calls[0][0] as Options).settings).toBe(candidate)
  })

  it('falls back to the returned state when no state change reports a result', async () => {
    testBasicModelRequest.mockResolvedValue({
      testing: false,
      basicTest: { status: 'error', error: 'Incorrect API key' },
    })
    await expect(checkProviderKey('openai', 'gpt-4o')).resolves.toBe('rejected')
  })

  it("resolves 'unreachable' when the test itself throws", async () => {
    testBasicModelRequest.mockRejectedValue(new Error('boom'))
    await expect(checkProviderKey('openai', 'gpt-4o')).resolves.toBe('unreachable')
  })
})

describe('classifyKeyError', () => {
  it.each([
    ['401 Unauthorized', 'rejected'],
    ['403 Forbidden', 'rejected'],
    ['unauthorised', 'rejected'],
    ['Invalid x-api-key', 'rejected'],
    ['Incorrect API key provided', 'rejected'],
    [
      '{\n  "error": {\n    "code": 400,\n    "message": "API key not valid. Please pass a valid API key.",\n    "status": "INVALID_ARGUMENT"\n  }\n}',
      'rejected',
    ],
    ['{\n  "error": {\n    "status": "PERMISSION_DENIED"\n  }\n}', 'rejected'],
    ['{\n  "error": {\n    "status": "UNAUTHENTICATED"\n  }\n}', 'rejected'],
    ['{"type":"error","error":{"type":"authentication_error"}}', 'rejected'],
    ['invalid\n x-api-key', 'rejected'],
    ['429 RESOURCE_EXHAUSTED', 'unreachable'],
    ['fetch failed', 'unreachable'],
    [undefined, 'unreachable'],
  ])('%s → %s', (error, expected) => {
    expect(classifyKeyError(error)).toBe(expected)
  })
})

describe('firstModelId', () => {
  it('picks the first model whose id has no "preview"', () => {
    expect(
      firstModelId('gemini', { models: [{ modelId: 'gemini-3-pro-preview' }, { modelId: 'gemini-2.5-flash' }] })
    ).toBe('gemini-2.5-flash')
  })
  it('falls back to the first model when every id is a preview', () => {
    expect(firstModelId('gemini', { models: [{ modelId: 'a-preview' }, { modelId: 'b-preview' }] })).toBe('a-preview')
  })
  it("uses the definition's defaults when nothing is saved", () => {
    expect(firstModelId('gemini', undefined)).toBe('gemini-2.5-flash')
    expect(firstModelId('claude', undefined)).toBe('claude-opus-4-1')
  })
})
