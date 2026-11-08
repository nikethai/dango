import type {
  IntegrationAccount,
  IntegrationsCatalog,
  ResolveResult,
} from '../types/integrations'

export type ResolveContext = {
  /** Explicit message or session credential ids (highest priority). */
  credentialIds?: string[]
  /** Prefer this connector when filtering. */
  connectorId?: string
}

function activeAccounts(catalog: IntegrationsCatalog, connectorId?: string): IntegrationAccount[] {
  return catalog.accounts.filter((a) => {
    if (a.status === 'disabled' || a.status === 'revoked') return false
    if (connectorId && a.connectorId !== connectorId) return false
    return true
  })
}

/**
 * Resolve which integration account tools should use.
 * Product rules:
 * - 0 → not_connected
 * - 1 active → that account (even without tag)
 * - 2+ → explicit credentialIds, else isDefault, else ambiguous
 */
export function resolveAccount(catalog: IntegrationsCatalog, ctx: ResolveContext = {}): ResolveResult {
  const { credentialIds, connectorId } = ctx

  if (credentialIds && credentialIds.length > 0) {
    const matched = credentialIds
      .map((id) => catalog.accounts.find((a) => a.id === id))
      .filter((a): a is IntegrationAccount => Boolean(a))
      .filter((a) => !connectorId || a.connectorId === connectorId)

    if (matched.length === 0) {
      return {
        ok: false,
        code: 'not_found',
        message: 'Selected account was not found. Pick another in Settings → Accounts or chat chips.',
      }
    }

    const usable = matched.filter((a) => a.status !== 'disabled' && a.status !== 'revoked')
    if (usable.length === 0) {
      return {
        ok: false,
        code: 'disabled',
        message: 'Selected account is disabled or revoked. Reconnect it in Settings → Accounts.',
        candidates: matched,
      }
    }

    if (usable.length > 1 && connectorId) {
      // Multiple chips for same connector — prefer default among them, else first
      const def = usable.find((a) => a.isDefault)
      return { ok: true, account: def ?? usable[0] }
    }

    const account = usable[0]
    if (account.status === 'needs_reauth' || account.status === 'expired') {
      return {
        ok: false,
        code: 'needs_reauth',
        message: `Reconnect “${account.label}” in Settings → Accounts.`,
        candidates: [account],
      }
    }
    return { ok: true, account }
  }

  const pool = activeAccounts(catalog, connectorId)

  if (pool.length === 0) {
    const name = connectorId ?? 'this service'
    return {
      ok: false,
      code: 'not_connected',
      message: `No connected account for ${name}. Connect one in Settings → Accounts.`,
    }
  }

  if (pool.length === 1) {
    const account = pool[0]
    if (account.status === 'needs_reauth' || account.status === 'expired') {
      return {
        ok: false,
        code: 'needs_reauth',
        message: `Reconnect “${account.label}” in Settings → Accounts.`,
        candidates: [account],
      }
    }
    return { ok: true, account }
  }

  const defaults = pool.filter((a) => a.isDefault)
  if (defaults.length === 1) {
    const account = defaults[0]
    if (account.status === 'needs_reauth' || account.status === 'expired') {
      return {
        ok: false,
        code: 'needs_reauth',
        message: `Reconnect “${account.label}” in Settings → Accounts.`,
        candidates: [account],
      }
    }
    return { ok: true, account }
  }

  return {
    ok: false,
    code: 'ambiguous_account',
    message: connectorId
      ? `Multiple ${connectorId} accounts connected. Set a default or tag one with # in chat.`
      : 'Multiple accounts connected. Set a default or tag one with # in chat.',
    candidates: pool,
  }
}

/** Ensure only one default per connector; `preferredId` wins when setting default. */
export function normalizeDefaults(
  accounts: IntegrationAccount[],
  preferredId?: string
): IntegrationAccount[] {
  const byConnector = new Map<string, IntegrationAccount[]>()
  for (const a of accounts) {
    const list = byConnector.get(a.connectorId) ?? []
    list.push(a)
    byConnector.set(a.connectorId, list)
  }

  const defaultIds = new Set<string>()
  for (const [, list] of byConnector) {
    if (preferredId && list.some((a) => a.id === preferredId)) {
      const pref = list.find((a) => a.id === preferredId)!
      if (pref.isDefault) defaultIds.add(pref.id)
      continue
    }
    const marked = list.filter((a) => a.isDefault)
    if (marked.length === 1) {
      defaultIds.add(marked[0].id)
    } else if (marked.length > 1) {
      // Keep most recently updated
      const winner = [...marked].sort((a, b) => b.updatedAt - a.updatedAt)[0]
      defaultIds.add(winner.id)
    }
  }

  return accounts.map((a) => ({
    ...a,
    isDefault: defaultIds.has(a.id) ? true : a.isDefault ? false : a.isDefault,
  }))
}

/** Force `accountId` as the only default for its connector. */
export function setDefaultAccount(accounts: IntegrationAccount[], accountId: string): IntegrationAccount[] {
  const target = accounts.find((a) => a.id === accountId)
  if (!target) return accounts
  const now = Date.now()
  return accounts.map((a) => {
    if (a.connectorId !== target.connectorId) return a
    if (a.id === accountId) {
      return { ...a, isDefault: true, updatedAt: now }
    }
    if (a.isDefault) {
      return { ...a, isDefault: false, updatedAt: now }
    }
    return a
  })
}
