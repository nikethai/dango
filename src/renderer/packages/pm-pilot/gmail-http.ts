import { FetchError, ofetch } from 'ofetch'

// Slice 10: the one way pm-pilot talks to the Gmail API, with the error mapping the sync and the writes share.

export const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'

/** 403 reasons that mean "slow down", not "sign in again". */
const RATE_LIMIT_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'dailyLimitExceeded',
  'quotaExceeded',
])

/**
 * Never send (slice 10 constraint): Dango only reads mail, writes drafts and sets labels. Only the method and path
 * pairs below are allowed, the path checked raw and again on the URL that would be requested, so `messages/send`,
 * `drafts/send`, `messages/import`, `POST messages` (messages.insert) and any encoded, dotted or appended variant
 * are refused before any request.
 */
type GmailMethod = 'GET' | 'POST' | 'DELETE'
const ID = '[A-Za-z0-9_-]+'
const ALLOWED: Readonly<Record<GmailMethod, readonly RegExp[]>> = {
  GET: [
    /^profile$/,
    /^messages$/,
    /^history$/,
    /^labels$/,
    new RegExp(`^threads/${ID}$`),
    new RegExp(`^drafts/${ID}$`),
  ],
  POST: [/^labels$/, /^drafts$/, new RegExp(`^threads/${ID}/modify$`)],
  DELETE: [new RegExp(`^drafts/${ID}$`)],
}
const RESERVED_SEGMENTS = new Set(['send', 'import'])

function isAllowedRequest(method: string, path: string): boolean {
  const patterns = Object.hasOwn(ALLOWED, method) ? ALLOWED[method as GmailMethod] : undefined
  if (!patterns?.some((re) => re.test(path))) return false
  if (path.split('/').some((segment) => RESERVED_SEGMENTS.has(segment.toLowerCase()))) return false
  let url: URL
  try {
    url = new URL(path, `${GMAIL_API}/`)
  } catch {
    return false
  }
  return url.origin === new URL(GMAIL_API).origin && url.pathname === `${new URL(GMAIL_API).pathname}/${path}`
}

/** Gmail refused the token (401 or 403): the account needs signing in again. */
export class GmailAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string
  ) {
    super(message)
    this.name = 'GmailAuthError'
  }
}

/** Gmail is rate-limiting or out of quota (429, or a 403 with a usage-limit reason). Retry later; not a sign-in problem. */
export class GmailRateLimitError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter?: number,
    readonly reason?: string
  ) {
    super(`Gmail is busy, try again later (${status})`)
    this.name = 'GmailRateLimitError'
  }
}

/**
 * Any other failed Gmail request. These errors carry only status, Gmail's reason and retryAfter: never the URL
 * (whose `q=` names client addresses) and no `cause`, so nothing about the request can reach logs or Sentry.
 */
export class GmailRequestError extends Error {
  constructor(
    readonly status: number | undefined,
    readonly reason?: string
  ) {
    super(`Gmail request failed (${status ?? 'network'})`)
    this.name = 'GmailRequestError'
  }
}

export function gmailStatus(error: unknown): number | undefined {
  if (error instanceof GmailRequestError) return error.status
  if (error instanceof FetchError) return error.status ?? error.response?.status
  return undefined
}

function errorReasons(error: FetchError): string[] {
  const errors = (error.data as { error?: { errors?: Array<{ reason?: unknown }> } } | undefined)?.error?.errors
  return Array.isArray(errors) ? errors.map((e) => String(e?.reason ?? '')) : []
}

function retryAfterSeconds(error: FetchError): number | undefined {
  const value = Number(error.response?.headers.get('retry-after'))
  return Number.isFinite(value) && value > 0 ? value : undefined
}

export type GmailRequestOptions = {
  query?: Record<string, string | number | string[] | undefined>
  body?: unknown
  signal?: AbortSignal
}

/**
 * One Gmail API call on `users/me/{path}`. Failures become `GmailRateLimitError` (429, or 403 with a usage-limit
 * reason), `GmailAuthError` (other 401/403) or `GmailRequestError`, none holding the URL or a cause. No retry: the
 * job runner retries, and an immediate retry would only hammer a rate limit.
 */
export async function gmailRequest<T>(
  token: string,
  method: GmailMethod,
  path: string,
  options: GmailRequestOptions = {}
): Promise<T> {
  if (!isAllowedRequest(method, path)) throw new Error('Dango does not make this Gmail request')
  const { query, body, signal } = options
  try {
    return await ofetch<T>(`${GMAIL_API}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      query,
      body: body as Record<string, unknown> | undefined,
      signal,
      retry: 0,
    })
  } catch (error) {
    if (!(error instanceof FetchError)) throw error
    if (signal?.aborted) throw signal.reason ?? error
    const status = gmailStatus(error)
    const reasons = errorReasons(error)
    const reason = reasons.find((r) => r.length > 0)
    if (status === 429 || (status === 403 && reasons.some((r) => RATE_LIMIT_REASONS.has(r)))) {
      throw new GmailRateLimitError(status, retryAfterSeconds(error), reason)
    }
    if (status === 401 || status === 403) {
      throw new GmailAuthError(`Gmail refused the sign-in (${status})`, status, reason)
    }
    throw new GmailRequestError(status, reason)
  }
}
