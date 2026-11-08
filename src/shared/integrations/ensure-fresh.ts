import type { IntegrationAccount, IntegrationSecret } from '../types/integrations'

/** Refresh this many ms before expiresAt (product default 3 min). */
export const TOKEN_EXPIRY_SKEW_MS = 3 * 60_000

export type EnsureFreshResult =
  | { ok: true; secret: IntegrationSecret; refreshed: boolean }
  | {
      ok: false
      code: 'missing_secret' | 'needs_reauth' | 'refresh_failed'
      message: string
    }

export type RefreshFn = (secret: IntegrationSecret, account: IntegrationAccount) => Promise<IntegrationSecret>

const mutexByAccount = new Map<string, Promise<EnsureFreshResult>>()

export function isTokenExpired(expiresAt: number | undefined, now = Date.now(), skewMs = TOKEN_EXPIRY_SKEW_MS): boolean {
  if (!expiresAt) return false
  return expiresAt - skewMs <= now
}

/**
 * Ensure secret is usable for tools.
 * - PAT / api_token without expiry → ok
 * - OAuth access token near expiry → call refreshFn once (mutex per account)
 */
export async function ensureFreshSecret(
  account: IntegrationAccount,
  secret: IntegrationSecret | null,
  options?: {
    now?: number
    refresh?: RefreshFn
    skewMs?: number
  }
): Promise<EnsureFreshResult> {
  const accountId = account.id
  const existing = mutexByAccount.get(accountId)
  if (existing) return existing

  const run = doEnsureFresh(account, secret, options).finally(() => {
    mutexByAccount.delete(accountId)
  })
  mutexByAccount.set(accountId, run)
  return run
}

async function doEnsureFresh(
  account: IntegrationAccount,
  secret: IntegrationSecret | null,
  options?: {
    now?: number
    refresh?: RefreshFn
    skewMs?: number
  }
): Promise<EnsureFreshResult> {
  if (!secret) {
    return {
      ok: false,
      code: 'missing_secret',
      message: `No secret stored for “${account.label}”. Reconnect in Settings → Accounts.`,
    }
  }

  const token = secret.accessToken || secret.apiToken
  if (!token) {
    return {
      ok: false,
      code: 'missing_secret',
      message: `No token for “${account.label}”. Reconnect in Settings → Accounts.`,
    }
  }

  if (account.status === 'revoked' || account.status === 'disabled') {
    return {
      ok: false,
      code: 'needs_reauth',
      message: `Account “${account.label}” is ${account.status}. Reconnect in Settings → Accounts.`,
    }
  }

  const now = options?.now ?? Date.now()
  const skew = options?.skewMs ?? TOKEN_EXPIRY_SKEW_MS
  const needsRefresh = account.authType === 'oauth' && isTokenExpired(secret.expiresAt, now, skew)

  if (!needsRefresh) {
    if (account.status === 'needs_reauth' || account.status === 'expired') {
      // Still try if token present and not expired
      if (secret.accessToken || secret.apiToken) {
        return { ok: true, secret, refreshed: false }
      }
      return {
        ok: false,
        code: 'needs_reauth',
        message: `Reconnect “${account.label}” in Settings → Accounts.`,
      }
    }
    return { ok: true, secret, refreshed: false }
  }

  if (!options?.refresh || !secret.refreshToken) {
    return {
      ok: false,
      code: 'needs_reauth',
      message: `Session expired for “${account.label}”. Reconnect in Settings → Accounts.`,
    }
  }

  try {
    const next = await options.refresh(secret, account)
    if (!next.accessToken && !next.apiToken) {
      return {
        ok: false,
        code: 'refresh_failed',
        message: `Could not refresh “${account.label}”. Reconnect in Settings → Accounts.`,
      }
    }
    return { ok: true, secret: next, refreshed: true }
  } catch (err) {
    return {
      ok: false,
      code: 'refresh_failed',
      message:
        err instanceof Error
          ? err.message
          : `Could not refresh “${account.label}”. Reconnect in Settings → Accounts.`,
    }
  }
}

/** Test helper: clear mutex map. */
export function clearEnsureFreshMutexes(): void {
  mutexByAccount.clear()
}
