/**
 * Resolve vault credentials and produce MCP transport overlays at runtime.
 * Never persists tokens into MCP settings JSON.
 */
import {
  buildMcpInjectPayload,
  ensureFreshSecret,
  getConnector,
  mergeHttpHeaders,
  mergeStdioEnv,
  redactInjectForLog,
  refreshAccessToken,
  type McpInjectPayload,
} from '@shared/integrations'
import type { MCPServerConfig, MCPTransportConfig } from '@shared/types/mcp'
import type { IntegrationAccount, IntegrationSecret } from '@shared/types/integrations'
import { getIntegrationSecret, setIntegrationSecret } from './secret-store'
import { ensureIntegrationsStoreInit, integrationsStore } from '@/stores/integrationsStore'
import { getLogger } from '@/lib/utils'

const log = getLogger('integrations-mcp-inject')

export type InjectedTransportResult = {
  transport: MCPTransportConfig
  usedAccount?: { id: string; label: string; connectorId: string }
  error?: string
}

/** Refresh an OAuth secret with the connector's token endpoint and store it. Also used by the PM pilot (slice 10). */
export async function refreshForAccount(
  secret: IntegrationSecret,
  account: IntegrationAccount
): Promise<IntegrationSecret> {
  const connector = getConnector(account.connectorId)
  const oauth = connector?.oauth
  if (!oauth || !secret.refreshToken) {
    throw new Error('Refresh not available')
  }
  const overrides = integrationsStore.getState().catalog.oauthClientOverrides?.[account.connectorId]
  const clientId =
    overrides?.clientId ||
    oauth.defaultClientId ||
    account.config.oauthClientId ||
    ''
  if (!clientId) {
    throw new Error('OAuth client id missing for refresh')
  }
  const tokens = await refreshAccessToken({
    tokenUrl: oauth.tokenUrl,
    clientId,
    clientSecret: overrides?.clientSecret || account.config.oauthClientSecret,
    refreshToken: secret.refreshToken,
  })
  const next: IntegrationSecret = {
    ...secret,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? secret.refreshToken,
    expiresAt: tokens.expiresAt,
    tokenType: tokens.tokenType,
  }
  await setIntegrationSecret(next)
  return next
}

export async function resolveMcpInjectForAccount(accountId: string): Promise<
  | { ok: true; payload: McpInjectPayload }
  | { ok: false; message: string }
> {
  await ensureIntegrationsStoreInit()
  const account = integrationsStore.getState().getAccount(accountId)
  if (!account) {
    return { ok: false, message: 'Linked integration account not found' }
  }
  const connector = getConnector(account.connectorId)
  if (!connector) {
    return { ok: false, message: `Unknown connector ${account.connectorId}` }
  }
  const secret = await getIntegrationSecret(accountId)
  const fresh = await ensureFreshSecret(account, secret, {
    refresh: refreshForAccount,
  })
  if (!fresh.ok) {
    await integrationsStore.getState().markStatus(accountId, 'needs_reauth', fresh.message)
    return { ok: false, message: fresh.message }
  }
  if (fresh.refreshed) {
    await integrationsStore.getState().markStatus(accountId, 'active')
  }
  const payload = buildMcpInjectPayload(connector.runtimeBinding, account, fresh.secret)
  log.debug('mcp inject ready', redactInjectForLog(payload))
  void integrationsStore.getState().touchUsed(accountId)
  return { ok: true, payload }
}

/**
 * Apply catalog MCP bindings: if this server is linked to an account, inject env/headers.
 */
export async function applyIntegrationInjectToServerConfig(
  serverConfig: MCPServerConfig
): Promise<InjectedTransportResult> {
  try {
    await ensureIntegrationsStoreInit()
    const binding = integrationsStore
      .getState()
      .catalog.mcpBindings?.find((b) => b.mcpServerId === serverConfig.id)
    if (!binding) {
      return { transport: serverConfig.transport }
    }
    const resolved = await resolveMcpInjectForAccount(binding.accountId)
    if (!resolved.ok) {
      return {
        transport: serverConfig.transport,
        error: resolved.message,
      }
    }
    const { payload } = resolved
    const transport = serverConfig.transport
    if (transport.type === 'stdio') {
      return {
        transport: {
          ...transport,
          env: mergeStdioEnv(transport.env, payload.env),
        },
        usedAccount: {
          id: payload.accountId,
          label: payload.accountLabel,
          connectorId: payload.connectorId,
        },
      }
    }
    if (transport.type === 'http') {
      return {
        transport: {
          ...transport,
          headers: mergeHttpHeaders(transport.headers, payload.headers),
        },
        usedAccount: {
          id: payload.accountId,
          label: payload.accountLabel,
          connectorId: payload.connectorId,
        },
      }
    }
    return { transport }
  } catch (err) {
    log.error('mcp inject failed', err)
    return {
      transport: serverConfig.transport,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
