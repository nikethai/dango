import { ApiError } from '@shared/models/errors'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  desktop: false,
  desktopFetch: vi.fn(),
}))

vi.mock('@shared/utils/desktop-http-fetch', () => ({
  hasDesktopHttpTransport: () => m.desktop,
  createDesktopAwareFetch: () => m.desktopFetch,
}))
vi.mock('@/platform', () => ({ default: { type: 'web', getVersion: async () => '0.0.0' }, isCapacitorMobile: false }))
vi.mock('./mobile-request', () => ({ handleMobileRequest: vi.fn() }))

import { apiRequest } from './request'

const rateLimited = () =>
  new Response('{"error":{"message":"Rate limit reached."}}', { status: 429, headers: { 'Retry-After': '2' } })

async function failure(): Promise<ApiError> {
  try {
    await apiRequest.post('https://api.example.com/v1/chat/completions', {}, '{}')
  } catch (error) {
    return error as ApiError
  }
  throw new Error('expected the request to fail')
}

describe('apiRequest keeps the status and Retry-After of a failed call', () => {
  beforeEach(() => {
    m.desktop = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => rateLimited())
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('in the browser', async () => {
    const error = await failure()
    expect(error).toBeInstanceOf(ApiError)
    expect(error.message).toContain('Status Code 429')
    expect(error.status).toBe(429)
    expect(error.retryAfterMs).toBe(2_000)
    expect(error.responseBody).toContain('Rate limit reached.')
  })

  it('on desktop, through native HTTP', async () => {
    m.desktop = true
    m.desktopFetch.mockImplementation(async () => rateLimited())
    const error = await failure()
    expect(error.status).toBe(429)
    expect(error.retryAfterMs).toBe(2_000)
  })

  it('leaves the wait empty when the provider sent none', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('busy', { status: 503 }))
    )
    const error = await failure()
    expect(error.status).toBe(503)
    expect(error.retryAfterMs).toBeUndefined()
  })
})
