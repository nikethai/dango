import { type Evidence, recordId, type SourceRecord } from '@shared/pm-pilot'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  choice: { provider: 'openai', modelId: 'gpt-x' } as { provider: string; modelId: string } | null,
  usable: true,
  sources: [] as Array<{ id: string; localOnly: boolean }>,
}))

vi.mock('./bridge', () => ({
  backgroundModelChoice: () => state.choice,
  hasUsableModel: () => state.usable,
  isLocalModelProvider: (p: string) => p === 'ollama' || p === 'lm-studio',
  loadSources: vi.fn(async () => undefined),
  listSources: () => state.sources,
}))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: () => ({ getSettings: () => ({ provider: 'session-provider', modelId: 'session-model' }) }),
  },
}))
vi.mock('@/stores/lastUsedModelStore', () => ({ lastUsedModelStore: { getState: () => ({ chat: undefined }) } }))
vi.mock('@/platform', () => ({ default: { getConfig: vi.fn(async () => ({})) } }))
vi.mock('@shared/models', () => ({ getModel: vi.fn(() => ({ name: 'model' })) }))
vi.mock('@/adapters', () => ({ createModelDependencies: vi.fn(async () => ({})) }))
vi.mock('@/packages/model-calls', () => ({ generateText: vi.fn() }))

import { getModel } from '@shared/models'
import { generateText } from '@/packages/model-calls'
import { judgeThread } from './judge-call'

const SECRET_MAIL = 'Our secret budget is 48000 USD'
const inbound: SourceRecord = {
  id: recordId('gmail', 'in1'),
  sourceKind: 'gmail',
  sourceId: 'src-gmail',
  accountId: 'acc1',
  externalId: 'in1',
  threadOrTaskId: 'thread-in',
  scopeId: 'acme',
  author: 'jo@acme.com',
  participants: ['jo@acme.com'],
  occurredAt: Date.UTC(2026, 8, 12, 12),
  title: 'Launch date?',
  text: `When is the launch? ${SECRET_MAIL}`,
  sentByMe: false,
  noise: false,
  link: { label: 'Gmail thread', url: 'https://mail.google.com/mail/#all/x' },
}

function ev(id: string, sourceId?: string): Evidence {
  return {
    id,
    label: 'your 12 Sep email',
    date: 0,
    text: 'Launch is 12 Sep.',
    source: { kind: 'email', label: 'x', sourceId },
  }
}

function reply(text: string) {
  vi.mocked(generateText).mockResolvedValueOnce({ contentParts: [{ type: 'text', text }] } as never)
}

const promptOf = () => {
  const messages = vi.mocked(generateText).mock.calls[0][1] as Array<{ contentParts: Array<{ text?: string }> }>
  return messages.map((m) => m.contentParts.map((p) => p.text ?? '').join('')).join('\n')
}

beforeEach(() => {
  vi.mocked(generateText).mockReset()
  vi.mocked(getModel).mockClear()
  state.choice = { provider: 'openai', modelId: 'gpt-x' }
  state.usable = true
  state.sources = []
})

describe('judgeThread', () => {
  it('judges with the background model and keeps only evidence it was given', async () => {
    reply(
      JSON.stringify({
        intent: 'question',
        summary: 'Jo asks for the launch date.',
        answer: '12 Sep',
        evidenceIds: ['r:gmail:a', 'r:gmail:made-up'],
        confidence: 0.9,
        candidates: [],
      })
    )
    const out = await judgeThread({ scopeName: 'Acme', inbound, evidence: [ev('r:gmail:a')] })
    expect(out.error).toBeUndefined()
    expect(out.judgement).toMatchObject({ answer: '12 Sep', evidenceIds: ['r:gmail:a'] })
    expect(getModel).toHaveBeenCalledTimes(1)
    expect(vi.mocked(getModel).mock.calls[0][0]).toMatchObject({ provider: 'openai', modelId: 'gpt-x' })
  })

  it('returns an error for an unreadable reply', async () => {
    reply('Sure! The launch is on 12 Sep.')
    const out = await judgeThread({ scopeName: 'Acme', inbound, evidence: [] })
    expect(out.judgement).toBeNull()
    expect(out.error).toBeTruthy()
  })

  it('never throws, never falls back to another model, and keeps prompt text, mail and keys out of the error', async () => {
    vi.mocked(generateText).mockRejectedValueOnce(
      new Error(`401 for key sk-live-ABC123 while sending: ${SECRET_MAIL} Launch date?`)
    )
    const out = await judgeThread({ scopeName: 'Acme', inbound, evidence: [ev('r:gmail:a')] })
    expect(out.judgement).toBeNull()
    expect(out.error).toBeTruthy()
    expect(out.error).not.toContain('sk-live')
    expect(out.error).not.toContain('48000')
    expect(out.error).not.toContain('Launch')
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(getModel).toHaveBeenCalledTimes(1)

    vi.mocked(getModel).mockImplementationOnce(() => {
      throw new Error(`bad config ${SECRET_MAIL}`)
    })
    const out2 = await judgeThread({ scopeName: 'Acme', inbound, evidence: [] })
    expect(out2.judgement).toBeNull()
    expect(out2.error).not.toContain('48000')
  })

  it('returns an error without a call when no model is set up', async () => {
    state.choice = null
    state.usable = false
    const out = await judgeThread({ scopeName: 'Acme', inbound, evidence: [] })
    expect(out).toMatchObject({ judgement: null, error: expect.any(String) })
    expect(getModel).not.toHaveBeenCalled()
    expect(generateText).not.toHaveBeenCalled()
  })

  it('refuses a local-only inbound record on a cloud model without calling it', async () => {
    state.sources = [{ id: 'src-gmail', localOnly: true }]
    const out = await judgeThread({ scopeName: 'Acme', inbound, evidence: [] })
    expect(out).toMatchObject({ judgement: null, error: expect.any(String) })
    expect(generateText).not.toHaveBeenCalled()
    expect(getModel).not.toHaveBeenCalled()

    const explicit = await judgeThread({
      scopeName: 'Acme',
      inbound,
      evidence: [],
      localOnlySourceIds: new Set(['src-gmail']),
    })
    expect(explicit.judgement).toBeNull()
    expect(generateText).not.toHaveBeenCalled()
  })

  it('drops local-only evidence on a cloud model and keeps it on a local one', async () => {
    state.sources = [{ id: 'src-local', localOnly: true }]
    const json = JSON.stringify({ intent: 'fyi', summary: 'x', evidenceIds: [], confidence: 0, candidates: [] })
    reply(json)
    await judgeThread({ scopeName: 'Acme', inbound, evidence: [ev('r:gmail:a'), ev('r:gmail:secret', 'src-local')] })
    expect(promptOf()).toContain('r:gmail:a')
    expect(promptOf()).not.toContain('r:gmail:secret')

    vi.mocked(generateText).mockReset()
    state.choice = { provider: 'ollama', modelId: 'llama' }
    reply(json)
    await judgeThread({ scopeName: 'Acme', inbound, evidence: [ev('r:gmail:a'), ev('r:gmail:secret', 'src-local')] })
    expect(promptOf()).toContain('r:gmail:secret')
  })
})
