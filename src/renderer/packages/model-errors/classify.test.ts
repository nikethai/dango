import type { Message } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { classifyModelError, isContextLengthError, modelErrorProviderName } from './classify'

type ErrorFields = Pick<Message, 'error' | 'errorCode' | 'errorExtra'>

const apiError = (status?: number, responseBody?: string, extra: Partial<ErrorFields> = {}): ErrorFields => ({
  error: 'API Error: Error from OpenAI',
  errorCode: 10001,
  errorExtra: { aiProvider: 'openai', status, responseBody },
  ...extra,
})

describe('classifyModelError', () => {
  it('too long: context length in the error or the body', () => {
    expect(classifyModelError(apiError(400, '{"error":{"code":"context_length_exceeded"}}'))).toBe('too-long')
    expect(
      classifyModelError(apiError(400, undefined, { error: 'API Error: prompt is too long: 210000 tokens' }))
    ).toBe('too-long')
    expect(classifyModelError(apiError(400, 'prompt is too long'))).toBe('too-long')
  })

  it('out of credit: quota exhausted, code 10004, status 402', () => {
    expect(classifyModelError(apiError(400, 'You exceeded your current quota'))).toBe('out-of-credit')
    expect(classifyModelError({ error: 'quota', errorCode: 10004 })).toBe('out-of-credit')
    expect(classifyModelError(apiError(402, 'Payment required'))).toBe('out-of-credit')
  })

  it('a 429 whose body says insufficient_quota is out of credit', () => {
    expect(classifyModelError(apiError(429, '{"error":{"type":"insufficient_quota"}}'))).toBe('out-of-credit')
  })

  it('rate limit: quota rate_limit, code 20005, status 429', () => {
    expect(classifyModelError(apiError(undefined, 'Rate limit reached for requests'))).toBe('rate-limit')
    expect(classifyModelError({ error: 'limit', errorCode: 20005 })).toBe('rate-limit')
    expect(classifyModelError(apiError(429, '{}'))).toBe('rate-limit')
  })

  it('invalid key: 401, 403 not exhausted, codes 20002-20004, key wording', () => {
    expect(classifyModelError(apiError(401, '{}'))).toBe('invalid-key')
    expect(classifyModelError(apiError(403, 'Forbidden'))).toBe('invalid-key')
    expect(classifyModelError({ error: 'license', errorCode: 20002 })).toBe('invalid-key')
    expect(classifyModelError({ error: 'license', errorCode: 20003 })).toBe('invalid-key')
    expect(classifyModelError({ error: 'license', errorCode: 20004 })).toBe('invalid-key')
    expect(classifyModelError(apiError(undefined, '{"error":{"code":"invalid_api_key"}}'))).toBe('invalid-key')
    expect(classifyModelError(apiError(undefined, 'Incorrect API key provided'))).toBe('invalid-key')
    expect(classifyModelError(apiError(undefined, 'Unauthorized'))).toBe('invalid-key')
    expect(classifyModelError(apiError(undefined, 'authentication_error'))).toBe('invalid-key')
  })

  it('a 403 that says the quota is used up is out of credit', () => {
    expect(classifyModelError(apiError(403, 'Your credit balance is too low'))).toBe('out-of-credit')
  })

  it('network: Network Error prefix or code 10002', () => {
    expect(classifyModelError({ error: 'Network Error: fetch failed', errorExtra: { host: 'api.openai.com' } })).toBe(
      'network'
    )
    expect(classifyModelError({ error: 'failed', errorCode: 10002 })).toBe('network')
  })

  it('anything else is a provider error', () => {
    expect(classifyModelError(apiError(500, 'Internal server error'))).toBe('provider')
    expect(classifyModelError({ error: 'API Error: Error from OpenAI: boom' })).toBe('provider')
  })
})

describe('isContextLengthError', () => {
  it('matches the wording providers use', () => {
    expect(isContextLengthError('This model maximum context length is 8192 tokens')).toBe(true)
    expect(isContextLengthError('input token limit exceeded')).toBe(true)
    expect(isContextLengthError('bad request')).toBe(false)
    expect(isContextLengthError(undefined)).toBe(false)
  })
})

describe('modelErrorProviderName', () => {
  it('names built-in, custom and unknown providers', () => {
    expect(modelErrorProviderName('openai')).toBe('OpenAI')
    expect(modelErrorProviderName('custom-1', [{ id: 'custom-1', name: 'My Proxy' }])).toBe('My Proxy')
    expect(modelErrorProviderName('mystery')).toBe('mystery')
    expect(modelErrorProviderName(undefined)).toBeUndefined()
  })
})
