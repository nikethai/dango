import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rewriteDraft } from '@/packages/writing/rewrite'
import type { ModelDependencies } from '../../../types/adapters'
import Perplexity, { perplexityModels } from './perplexity'

const fetchMock = vi.fn()
const dependencies = {
  storage: { saveImage: vi.fn(), getImage: vi.fn() },
  request: { apiRequest: vi.fn(), fetchWithOptions: vi.fn() },
  sentry: { withScope: vi.fn(), captureException: vi.fn() },
  getRemoteConfig: vi.fn(),
} satisfies ModelDependencies

function model(modelId = 'sonar') {
  return new Perplexity({ model: { modelId }, perplexityApiKey: 'offline-placeholder', stream: true }, dependencies)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation((_url, init) => {
    const body = JSON.parse(String(init.body))
    const chunk = {
      id: 'offline-response',
      created: 1,
      model: body.model,
      choices: [{ delta: { role: 'assistant', content: 'Revised draft' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8, num_search_queries: 0 },
    }
    return Promise.resolve(
      new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    )
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('Perplexity writing wire policy (real SDK, mocked HTTP)', () => {
  it.each(perplexityModels)('%s: serializes disable_search with only the editing policy and draft', async (modelId) => {
    const request = { draft: 'Original draft', style: 'clearer' as const, model: { provider: 'perplexity', modelId } }
    const result = await rewriteDraft(model(modelId), request, { signal: new AbortController().signal })

    expect(result.text).toBe('Revised draft')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(body.model).toBe(modelId)
    expect(body.stream).toBe(true)
    expect(body.disable_search).toBe(true)
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1]).toEqual({ role: 'user', content: request.draft })
    expect(body.tools).toBeUndefined()
  })

  it('does not change search behavior in ordinary chat, even when diagnostics are ephemeral', async () => {
    await model().chat([{ role: 'user', content: 'General chat' }], { contentPrivacy: 'ephemeral' })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(body.disable_search).toBeUndefined()
  })

  it('never retries a rejected writing policy with search enabled or another model', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 400, message: 'Unsupported writing parameter' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    await expect(
      rewriteDraft(
        model(),
        { draft: 'Original draft', style: 'clearer', model: { provider: 'perplexity', modelId: 'sonar' } },
        { signal: new AbortController().signal }
      )
    ).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).disable_search).toBe(true)
    expect(dependencies.sentry.withScope).not.toHaveBeenCalled()
  })
})
