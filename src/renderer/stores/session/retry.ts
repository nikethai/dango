import type { Message } from '@shared/types'
import { generate, getOverflowTruncateLimit, type ModelOverride } from './generation'

function failedModelOverride(msg: Message): ModelOverride | undefined {
  const value = msg.errorExtra?.modelOverride
  if (!value || typeof value !== 'object') return undefined
  const { provider, modelId } = value as Partial<ModelOverride>
  return typeof provider === 'string' && typeof modelId === 'string' ? { provider, modelId } : undefined
}

/**
 * Answer a failed message again, in place, with the model that failed: a failed Redo ▾ answer keeps its picked model
 * (`errorExtra.modelOverride`); the chat's own settings are never touched.
 */
export async function retryFailedMessage(sessionId: string, msg: Message): Promise<void> {
  const truncateTokenLimit = await getOverflowTruncateLimit(sessionId)
  await generate(sessionId, msg, {
    operationType: 'regenerate',
    truncateTokenLimit,
    modelOverride: failedModelOverride(msg),
  })
}
