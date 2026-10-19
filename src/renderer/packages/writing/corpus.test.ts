import type { CallChatCompletionOptions } from '@shared/models/types'
import {
  MAX_WRITING_INPUT_CHARS,
  MAX_WRITING_OUTPUT_CHARS,
  WritingRequestSchema,
  WritingStyleSchema,
} from '@shared/types/writing'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import corpus from './__fixtures__/corpus.json'
import { buildWritingMessages } from './prompt'
import { rewriteDraft } from './rewrite'

const coverageTags = [
  'grammar',
  'tone',
  'slang',
  'mixed-language',
  'emoji',
  'multiline',
  'markdown',
  'code',
  'urls',
  'mentions',
  'names',
  'dates',
  'numbers',
  'negation',
  'uncertainty',
  'commitments',
  'already-correct',
  'draft-as-data',
] as const

const fixtureSchema = z
  .object({
    id: z.string().regex(/^[a-z]+(?:-[a-z]+)+$/),
    style: WritingStyleSchema,
    targetLanguage: z.string().optional(),
    tags: z.array(z.enum(coverageTags)).min(1),
    draft: z.string().min(1).max(MAX_WRITING_INPUT_CHARS),
    referenceRewrite: z.string().min(1).max(MAX_WRITING_OUTPUT_CHARS),
    preserveExactly: z.array(z.string().min(1)).min(1),
    reviewNotes: z.string().min(1),
  })
  .strict()

describe('synthetic writing evaluation corpus', () => {
  it('has valid, unique cases covering every style and required risk category', () => {
    const cases = z.array(fixtureSchema).min(40).parse(corpus)
    expect(new Set(cases.map((fixture) => fixture.id)).size).toBe(cases.length)
    expect(new Set(cases.map((fixture) => fixture.draft)).size).toBe(cases.length)
    const tags = new Set(cases.flatMap((fixture) => fixture.tags))
    for (const tag of coverageTags) expect(tags.has(tag), tag).toBe(true)
    for (const style of WritingStyleSchema.options) {
      expect(cases.filter((fixture) => fixture.style === style).length, style).toBeGreaterThanOrEqual(8)
    }
  })

  it.each(corpus)('$id: keeps protected source text in its reference example', (fixture) => {
    for (const fragment of fixture.preserveExactly) {
      expect(fixture.draft).toContain(fragment)
      expect(fixture.referenceRewrite).toContain(fragment)
    }
    if (fixture.tags.includes('already-correct')) {
      expect(fixture.referenceRewrite).toBe(fixture.draft)
    }
  })

  // Mocked transport checks, not model-quality scores. References are authored examples.
  it.each(corpus)('$id: passes only the current draft and policy and preserves returned text', async (fixture) => {
    const request = WritingRequestSchema.parse({
      draft: fixture.draft,
      style: fixture.style,
      ...(fixture.targetLanguage ? { targetLanguage: fixture.targetLanguage } : {}),
      model: { provider: 'synthetic', modelId: 'offline-fixture' },
    })
    const signal = new AbortController().signal
    const onText = vi.fn()
    const chat = vi.fn().mockImplementation((_messages, options: CallChatCompletionOptions) => {
      const contentParts = [{ type: 'text' as const, text: fixture.referenceRewrite }]
      options.onResultChange?.({ contentParts })
      return Promise.resolve({ contentParts, finishReason: 'stop' })
    })

    const result = await rewriteDraft({ chat }, request, { signal, onText })

    expect(chat).toHaveBeenCalledTimes(1)
    expect(chat.mock.calls[0][0]).toEqual([buildWritingMessages(request)[0], { role: 'user', content: fixture.draft }])
    expect(chat.mock.calls[0][1]).toEqual({
      signal,
      purpose: 'writing',
      contentPrivacy: 'ephemeral',
      tools: {},
      maxSteps: 1,
      onResultChange: expect.any(Function),
    })
    expect(onText).toHaveBeenCalledExactlyOnceWith(fixture.referenceRewrite)
    expect(result.request).toEqual(request)
    expect(result.text).toBe(fixture.referenceRewrite)
  })
})
