import { aiProviderNameHash } from '@shared/models'
import { getProviderDefinition } from '@shared/providers'
import { classifyQuotaError } from '@shared/providers/usage'
import type { Message } from '@shared/types'

/** What went wrong with a model call, by the fix it needs (ER1, ER2, ER3, ER5, CH5). */
export type ModelErrorKind =
  | 'budget'
  | 'invalid-key'
  | 'out-of-credit'
  | 'rate-limit'
  | 'too-long'
  | 'network'
  | 'provider'

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

/** Only wording that names the context window: a rate limit counted in tokens also "exceeds" a "token" "limit". */
function isExplicitContextLengthError(text: string | undefined): boolean {
  if (!text) return false
  const lower = text.toLowerCase()
  return (
    lower.includes('context_length_exceeded') ||
    lower.includes('prompt is too long') ||
    lower.includes('maximum context length')
  )
}

const RATE_LIMIT_BODY_PATTERN = /"type"\s*:\s*"rate_limit_error"/

/**
 * Gemini answers a per-minute quota with RESOURCE_EXHAUSTED and "You exceeded your current quota", wording the quota
 * classifier reads as used-up credit. A per-minute metric, a retry delay or the free-tier request counter means waiting
 * helps, unless the body also names credit or billing, or the quota is counted per day (it resets tomorrow, so three
 * retries over a few minutes would only end in a Needs you entry).
 */
const PER_MINUTE_QUOTA_PATTERN = /PerMinute|per[_ ]minute|retryDelay|free_tier_requests/i
const PER_DAY_QUOTA_PATTERN = /PerDay|per[_ ]day/i
const CREDIT_PATTERN = /insufficient[_ ]quota|credit[_ ]balance|out[_ ]of[_ ]credits?|billing[_ ]hard[_ ]limit/i

function isPerMinuteQuota(text: string): boolean {
  return (
    /RESOURCE_EXHAUSTED/.test(text) &&
    PER_MINUTE_QUOTA_PATTERN.test(text) &&
    !PER_DAY_QUOTA_PATTERN.test(text) &&
    !CREDIT_PATTERN.test(text)
  )
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
 * Sort a failed answer by its fix. Order matters: the usage budget (Dango's own stop), too long, out of credit, rate
 * limited, bad key, offline, else the provider's own error.
 */
export function classifyModelError(msg: Pick<Message, 'error' | 'errorCode' | 'errorExtra'>): ModelErrorKind {
  const error = msg.error ?? ''
  const responseBody = stringField(msg.errorExtra, 'responseBody')
  const status = numberField(msg.errorExtra, 'status')
  const code = msg.errorCode

  if (msg.errorExtra?.kind === 'budget') return 'budget'

  const rateLimited = status === 429 || (responseBody !== undefined && RATE_LIMIT_BODY_PATTERN.test(responseBody))
  const contextCheck = rateLimited ? isExplicitContextLengthError : isContextLengthError
  if (contextCheck(error) || contextCheck(responseBody)) return 'too-long'

  if (isPerMinuteQuota(`${error}\n${responseBody ?? ''}`)) return 'rate-limit'

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

/**
 * The provider a failed answer came from: the one the failed call used (`errorExtra.aiProvider`, which follows a Redo ▾
 * override), else the message's own provider. Shared by the error notice and the rate-limit Needs you entry.
 */
export function modelErrorProviderId(msg: Pick<Message, 'aiProvider' | 'errorExtra'>): string | undefined {
  const failedWith = msg.errorExtra?.aiProvider
  return typeof failedWith === 'string' && failedWith ? failedWith : msg.aiProvider
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
