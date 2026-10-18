/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetInitForTests, initKnowledge } from './init'

const register = vi.fn(() => vi.fn())
const ensure = vi.hoisted(() => vi.fn(async (_opts?: { fresh?: boolean }) => undefined))
vi.mock('./review/register', () => ({ registerKnowledgeRenderers: () => register() }))
vi.mock('./review-sync', () => ({ startReviewSync: () => () => undefined }))
vi.mock('./scopes', () => ({ watchScopes: () => () => undefined }))
vi.mock('./store', () => ({ ensureKnowledgeLoaded: ensure }))

const visibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => ensure.mockClear())
afterEach(_resetInitForTests)

describe('initKnowledge', () => {
  it('registers the Review renderers once', async () => {
    await initKnowledge()
    await initKnowledge()
    expect(register).toHaveBeenCalledTimes(1)
  })

  it('re-reads knowledge fresh on focus and when the window becomes visible', async () => {
    await initKnowledge()
    expect(ensure).toHaveBeenCalledTimes(1)
    expect(ensure).toHaveBeenLastCalledWith()

    window.dispatchEvent(new Event('focus'))
    expect(ensure).toHaveBeenCalledTimes(2)
    expect(ensure).toHaveBeenLastCalledWith({ fresh: true })

    visibility('hidden')
    expect(ensure).toHaveBeenCalledTimes(2)
    visibility('visible')
    expect(ensure).toHaveBeenCalledTimes(3)
    expect(ensure).toHaveBeenLastCalledWith({ fresh: true })
  })

  it('stops listening after a reset', async () => {
    await initKnowledge()
    _resetInitForTests()
    ensure.mockClear()
    window.dispatchEvent(new Event('focus'))
    visibility('visible')
    expect(ensure).not.toHaveBeenCalled()
  })
})
