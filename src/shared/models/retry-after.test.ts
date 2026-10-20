import { APICallError, RetryError } from 'ai'
import { describe, expect, it } from 'vitest'
import { ApiError } from './errors'
import { apiErrorFromCallError, parseRetryAfter } from './retry-after'

const now = Date.UTC(2026, 9, 19, 12, 0, 0)

const callError = (statusCode: number, responseHeaders?: Record<string, string>, responseBody?: string) =>
  new APICallError({ message: 'x', url: 'u', requestBodyValues: {}, statusCode, responseHeaders, responseBody })

describe('parseRetryAfter', () => {
  it('parseRetryAfter handles dates, zero and junk', () => {
    expect(parseRetryAfter('12', now)).toBe(12_000)
    expect(parseRetryAfter('0', now)).toBe(1_000)
    expect(parseRetryAfter(new Date(now + 30_000).toUTCString(), now)).toBe(30_000)
    expect(parseRetryAfter(new Date(now - 60_000).toUTCString(), now)).toBe(1_000)
    expect(parseRetryAfter('soon', now)).toBeUndefined()
    expect(parseRetryAfter(undefined, now)).toBeUndefined()
  })

  it('reads fractional seconds and ignores surrounding space', () => {
    expect(parseRetryAfter(' 1.5 ', now)).toBe(1_500)
    expect(parseRetryAfter('', now)).toBeUndefined()
    expect(parseRetryAfter('-3', now)).toBeUndefined()
  })
})

describe('apiErrorFromCallError', () => {
  it('keeps the status and the Retry-After wait', () => {
    const error = apiErrorFromCallError(callError(429, { 'retry-after': '7' }), 'OpenAI', now)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(429)
    expect(error.retryAfterMs).toBe(7_000)
    expect(error.message).toBe('API Error: Error from OpenAI')
  })

  it('unwraps the AI SDK RetryError around a 429', () => {
    const lastError = callError(429, { 'retry-after': '7' }, '{"error":"rate"}')
    const wrapped = new RetryError({
      message: 'Failed after 3 attempts',
      reason: 'maxRetriesExceeded',
      errors: [lastError],
    })
    const error = apiErrorFromCallError(wrapped, 'OpenAI', now)
    expect(error.status).toBe(429)
    expect(error.retryAfterMs).toBe(7_000)
    expect(error.responseBody).toBe('{"error":"rate"}')
  })

  it('reads headers case-insensitively and prefers retry-after-ms', () => {
    expect(apiErrorFromCallError(callError(429, { 'Retry-After': '3' }), 'X', now).retryAfterMs).toBe(3_000)
    expect(
      apiErrorFromCallError(callError(429, { 'retry-after-ms': '2500', 'retry-after': '9' }), 'X', now).retryAfterMs
    ).toBe(2_500)
  })

  it('leaves the wait empty without a header', () => {
    const error = apiErrorFromCallError(callError(401), 'OpenAI', now)
    expect(error.status).toBe(401)
    expect(error.retryAfterMs).toBeUndefined()
  })
})
