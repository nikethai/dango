import { z } from 'zod'

export const MAX_WRITING_INPUT_CHARS = 8_000
export const MAX_WRITING_OUTPUT_CHARS = 16_000

export const WritingStyleSchema = z.enum(['clearer', 'friendlier', 'shorter', 'formal', 'translate'])
export type WritingStyle = z.infer<typeof WritingStyleSchema>

/** A language name only: letters, combining marks, spaces, parentheses, apostrophes, hyphens. Never instructions. */
export const TARGET_LANGUAGE_RE = /^\p{L}[\p{L}\p{M} ()'-]{1,39}$/u

export const WritingModelSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
})
export type WritingModel = z.infer<typeof WritingModelSchema>

/** Deliberately no session, history, attachments, agent, memory, or tool fields. */
export const WritingRequestSchema = z
  .object({
    draft: z
      .string()
      .max(MAX_WRITING_INPUT_CHARS)
      .refine((draft) => draft.trim().length > 0),
    style: WritingStyleSchema,
    targetLanguage: z.string().regex(TARGET_LANGUAGE_RE).optional(),
    model: WritingModelSchema.strict(),
  })
  .strict()
  .refine((request) => (request.style === 'translate') === (request.targetLanguage !== undefined))
export type WritingRequest = z.infer<typeof WritingRequestSchema>

export type WritingErrorCode = 'invalid_input' | 'unsupported_model' | 'request_failed' | 'incomplete' | 'timeout'

export class WritingError extends Error {
  constructor(public readonly code: WritingErrorCode) {
    // Never include drafts or provider response bodies in error messages.
    super(code)
    this.name = 'WritingError'
  }
}
