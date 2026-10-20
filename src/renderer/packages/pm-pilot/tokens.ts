import { ensureFreshSecret } from '@shared/integrations'
import { refreshForAccount } from '@/packages/integrations/mcp-inject'
import { getIntegrationSecret } from '@/packages/integrations/secret-store'
import { ensureIntegrationsStoreInit, integrationsStore } from '@/stores/integrationsStore'

export type FreshToken = { ok: true; token: string } | { ok: false; message: string }

/**
 * A usable bearer token for an Integrations account (Gmail on `google_workspace`, Asana on `asana`).
 * OAuth tokens near expiry are refreshed; an api-token (Asana PAT) account is used as is (preflight R13).
 * On failure the account is marked `needs_reauth`, as `resolveMcpInjectForAccount` does.
 * The mailbox's own address comes from Gmail's profile in the sync, not from here (preflight R12).
 */
export async function getFreshToken(accountId: string): Promise<FreshToken> {
  await ensureIntegrationsStoreInit()
  const store = integrationsStore.getState()
  const account = store.getAccount(accountId)
  if (!account) {
    return { ok: false, message: 'Linked integration account not found' }
  }
  const secret = await getIntegrationSecret(accountId)
  const fresh = await ensureFreshSecret(account, secret, { refresh: refreshForAccount })
  if (!fresh.ok) {
    await store.markStatus(accountId, 'needs_reauth', fresh.message)
    return { ok: false, message: fresh.message }
  }
  if (fresh.refreshed) {
    await store.markStatus(accountId, 'active')
  }
  const token =
    account.authType === 'api_token'
      ? fresh.secret.apiToken || fresh.secret.accessToken
      : fresh.secret.accessToken || fresh.secret.apiToken
  if (!token) {
    const message = `No token for “${account.label}”. Reconnect in Integrations.`
    await store.markStatus(accountId, 'needs_reauth', message)
    return { ok: false, message }
  }
  void store.touchUsed(accountId)
  return { ok: true, token }
}
