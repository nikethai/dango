import { aiProviderNameHash } from '@shared/models'
import { getProviderDefinition } from '@shared/providers'
import { classifyQuotaError } from '@shared/providers/usage'
import type { Message } from '@shared/types'

/** What went wrong with a model call, by the fix it needs (ER1, ER2, ER3, ER5, CH5). */
export type ModelErrorKind = 'invalid-key' | 'out-of-credit' | 'rate-limit' | 'too-long' | 'network' | 'provider'

const INVALID_KEY_PATTERN = /invalid[_ ]?api[_ ]?key|incorrect api key|unauthori[sz]ed|authentication/i

/**
 * Detects if an error message indicates a context length exceeded error from various AI providers.
 */
export function isContextLengthError(errorText: string | null | undefined): boolean {
  if (!errorText) return false
  const text = errorText.toLowerCase()

  if (text.includes('context_length_exceeded')) return true
  if (text.includes('prompt is too long')) return true
  if (text.includes('maximum context length')) return true
  if (text.includes('input token limit')) return true
  if (text.includes('token') && text.includes('exceed') && text.includes('limit')) return true
  if (text.includes('exceed') && text.includes('max_prompt_tokens')) return true

  return false
}

function stringField(extra: Message['errorExtra'], key: string): string | undefined {
  const value = extra?.[key]
  return typeof value === 'string' ? value : undefined
}

function numberField(extra: Message['errorExtra'], key: string): number | undefined {
  const value = extra?.[key]
  return typeof value === 'number' ? value : undefined
}

/**
 * Sort a failed answer by its fix. Order matters: too long, out of credit, rate limited, bad key, offline, else the
 * provider's own error.
 */
export function classifyModelError(msg: Pick<Message, 'error' | 'errorCode' | 'errorExtra'>): ModelErrorKind {
  const error = msg.error ?? ''
  const responseBody = stringField(msg.errorExtra, 'responseBody')
  const status = numberField(msg.errorExtra, 'status')
  const code = msg.errorCode

  if (isContextLengthError(error) || isContextLengthError(responseBody)) return 'too-long'

  const quota = classifyQuotaError({ message: error, responseBody, status, errorCode: code }).kind
  if (quota === 'exhausted' || code === 10004 || status === 402) return 'out-of-credit'
  if (quota === 'rate_limit' || code === 20005 || status === 429) return 'rate-limit'

  if (
    status === 401 ||
    status === 403 ||
    (code !== undefined && code >= 20002 && code <= 20004) ||
    INVALID_KEY_PATTERN.test(error) ||
    (responseBody !== undefined && INVALID_KEY_PATTERN.test(responseBody))
  ) {
    return 'invalid-key'
  }

  if (error.startsWith('Network Error') || code === 10002) return 'network'
  return 'provider'
}

/** The provider's name as people know it: a custom provider's own name, else the built-in name, else its id. */
export function modelErrorProviderName(
  providerId: string | undefined,
  customProviders?: ReadonlyArray<{ id: string; name?: string }>
): string | undefined {
  if (!providerId) return undefined
  const custom = customProviders?.find((p) => p.id === providerId)?.name
  if (custom) return custom
  const builtIn = getProviderDefinition(providerId)?.name
  if (builtIn) return builtIn
  return (aiProviderNameHash as Record<string, string>)[providerId] ?? providerId
}
