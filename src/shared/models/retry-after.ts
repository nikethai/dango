import { APICallError, RetryError } from 'ai'
import { ApiError } from './errors'

/** The shortest wait we honour: a `Retry-After` of 0 or a date in the past still waits this long. */
const MIN_RETRY_AFTER_MS = 1_000

/**
 * Read an HTTP `Retry-After` value (delay in seconds, or an HTTP date) as a wait in ms from `now`.
 * Zero and past dates wait the 1 s minimum; anything unreadable is `undefined` (the caller's own schedule applies).
 */
export function parseRetryAfter(value: string | undefined, now: number): number | undefined {
  const text = value?.trim()
  if (!text) return undefined
  if (/^\d+(\.\d+)?$/.test(text)) {
    return Math.max(MIN_RETRY_AFTER_MS, Math.round(Number(text) * 1_000))
  }
  // Only something that looks like a date: Date.parse also reads bare numbers such as '-3'.
  if (!/[a-z]/i.test(text)) return undefined
  const at = Date.parse(text)
  if (Number.isNaN(at)) return undefined
  return Math.max(MIN_RETRY_AFTER_MS, at - now)
}

function header(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value
  }
  return undefined
}

function headerRecord(headers: Headers | Record<string, string> | undefined): Record<string, string> | undefined {
  if (!(headers instanceof Headers)) return headers
  const record: Record<string, string> = {}
  headers.forEach((value, key) => {
    record[key] = value
  })
  return record
}

/** `retry-after-ms` (OpenAI, Azure) wins over `retry-after` when both are sent. */
function retryAfterFromHeaders(headers: Record<string, string> | undefined, now: number): number | undefined {
  const ms = header(headers, 'retry-after-ms')?.trim()
  if (ms && /^\d+(\.\d+)?$/.test(ms)) {
    return Math.max(MIN_RETRY_AFTER_MS, Math.round(Number(ms)))
  }
  return parseRetryAfter(header(headers, 'retry-after'), now)
}

/**
 * The `ApiError` for a non-OK response read by Dango's own fetch (web, desktop native HTTP, mobile), keeping its HTTP
 * status and Retry-After wait. The message stays `Status Code N`, which the 5xx retry check reads.
 */
export function apiErrorFromResponse(
  status: number,
  headers: Headers | Record<string, string> | undefined,
  responseBody: string | undefined,
  now = Date.now()
): ApiError {
  return new ApiError(`Status Code ${status}`, responseBody, {
    status,
    retryAfterMs: retryAfterFromHeaders(headerRecord(headers), now),
  })
}

/**
 * The `ApiError` for a failed provider call, keeping its HTTP status and Retry-After wait. `streamText` retries
 * in-request and then wraps the last failure in a `RetryError`; that wrapper is unwrapped here.
 */
export function apiErrorFromCallError(error: APICallError | RetryError, label: string, now = Date.now()): ApiError {
  const callError = RetryError.isInstance(error) ? error.lastError : error
  if (!APICallError.isInstance(callError)) {
    return new ApiError(`Error from ${label}: ${error}`)
  }
  return new ApiError(`Error from ${label}`, callError.responseBody, {
    status: callError.statusCode,
    retryAfterMs: retryAfterFromHeaders(callError.responseHeaders, now),
  })
}
