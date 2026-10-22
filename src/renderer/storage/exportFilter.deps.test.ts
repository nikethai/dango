import { describe, expect, it, vi } from 'vitest'

// The export filter must not load the chat-history module (i18next, model checks, providers) to find device-only chats.
vi.mock('@/platform', () => ({ default: {} }))
vi.mock('@/packages/model-calls/toolsets/pm-pilot-history', () => {
  throw new Error('exportFilter loaded pm-pilot-history')
})
vi.mock('i18next', () => {
  throw new Error('exportFilter loaded i18next')
})
vi.mock('@/packages/sources/model-check', () => {
  throw new Error('exportFilter loaded sources/model-check')
})

describe('exportFilter dependencies', () => {
  it('finds a device-only chat without the chat-history module', async () => {
    const { sessionHoldsDeviceOnly } = await import('./exportFilter')
    expect(
      sessionHoldsDeviceOnly({ messages: [{ id: 'm', role: 'assistant', contentParts: [], pmLocalOnly: true }] })
    ).toBe(true)
    expect(sessionHoldsDeviceOnly({ messages: [{ id: 'm', role: 'user', contentParts: [] }] })).toBe(false)
  })
})
