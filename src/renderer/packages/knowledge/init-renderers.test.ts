import { afterEach, describe, expect, it, vi } from 'vitest'
import { _resetInitForTests, initKnowledge } from './init'

const register = vi.fn(() => vi.fn())
vi.mock('./review/register', () => ({ registerKnowledgeRenderers: () => register() }))
vi.mock('./review-sync', () => ({ startReviewSync: () => () => undefined }))
vi.mock('./scopes', () => ({ watchScopes: () => () => undefined }))
vi.mock('./store', () => ({ ensureKnowledgeLoaded: async () => undefined }))

afterEach(_resetInitForTests)

describe('initKnowledge', () => {
  it('registers the Review renderers once', async () => {
    await initKnowledge()
    await initKnowledge()
    expect(register).toHaveBeenCalledTimes(1)
  })
})
