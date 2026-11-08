/**
 * Desktop OAuth flow for integrations: open browser, paste redirect, exchange code.
 */
import {
  createPkceAuthSession,
  exchangeAuthorizationCode,
  getConnector,
  parseOAuthRedirect,
  type PkceSession,
} from '@shared/integrations'
import type { IntegrationAccountWrite } from '@shared/types/integrations'
import { isTauriRuntime } from '@/platform/tauri_ipc_adapter'
import platform from '@/platform'
import { ensureIntegrationsStoreInit, integrationsStore } from '@/stores/integrationsStore'

export type OAuthFlowStart = {
  session: PkceSession
  authUrl: string
}

export async function startConnectorOAuth(options: {
  connectorId: string
  scopes?: string[]
  clientId?: string
  clientSecret?: string
  redirectUri?: string
}): Promise<OAuthFlowStart> {
  const connector = getConnector(options.connectorId)
  if (!connector?.oauth || !connector.oauthEnabled) {
    throw new Error('OAuth is not available for this connector')
  }
  await ensureIntegrationsStoreInit()
  const overrides = integrationsStore.getState().catalog.oauthClientOverrides?.[options.connectorId]
  const clientId =
    options.clientId?.trim() ||
    overrides?.clientId ||
    connector.oauth.defaultClientId ||
    ''
  if (!clientId && connector.oauth.requiresClientId) {
    throw new Error(
      'OAuth client ID is required. Add your app client id under Advanced, or set it in Settings → Accounts.'
    )
  }
  const redirectUri =
    options.redirectUri?.trim() ||
    overrides?.redirectUri ||
    connector.oauth.redirectUri
  const scopes = options.scopes?.length ? options.scopes : connector.oauth.scopes

  const session = await createPkceAuthSession({
    connectorId: options.connectorId,
    authorizationUrl: connector.oauth.authorizationUrl,
    clientId: clientId || 'public',
    redirectUri,
    scopes,
    usesPkce: connector.oauth.usesPkce !== false,
    extraAuthParams: connector.oauth.extraAuthParams,
  })

  // Open system browser when possible
  try {
    await platform.openLink(session.authUrl)
  } catch {
    try {
      if (typeof window !== 'undefined') {
        window.open(session.authUrl, '_blank', 'noopener,noreferrer')
      }
    } catch {
      // User can open authUrl manually
    }
  }

  return { session, authUrl: session.authUrl }
}

export async function completeConnectorOAuth(options: {
  session: PkceSession
  redirectOrCode: string
  label?: string
  config?: Record<string, string>
  clientSecret?: string
  isDefault?: boolean
}): Promise<{ accountId: string }> {
  const connector = getConnector(options.session.connectorId)
  if (!connector?.oauth) throw new Error('Unknown OAuth connector')

  const parsed = parseOAuthRedirect(options.redirectOrCode)
  if (parsed.error) throw new Error(parsed.error)
  if (!parsed.code) throw new Error('Authorization code missing. Paste the full redirect URL.')
  if (parsed.state && parsed.state !== options.session.state) {
    throw new Error('OAuth state mismatch. Start Connect with OAuth again.')
  }

  await ensureIntegrationsStoreInit()
  const overrides = integrationsStore.getState().catalog.oauthClientOverrides?.[options.session.connectorId]
  const tokens = await exchangeAuthorizationCode({
    tokenUrl: connector.oauth.tokenUrl,
    clientId: options.session.clientId,
    clientSecret: options.clientSecret || overrides?.clientSecret,
    code: parsed.code,
    redirectUri: options.session.redirectUri,
    codeVerifier: connector.oauth.usesPkce === false ? undefined : options.session.verifier,
  })

  let accountHint: string | undefined
  if (connector.oauth.userInfoUrl && tokens.accessToken) {
    try {
      const res = await fetch(connector.oauth.userInfoUrl, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      })
      if (res.ok) {
        const info = (await res.json()) as { email?: string; login?: string; name?: string }
        accountHint = info.email || info.login || info.name
      }
    } catch {
      /* ignore */
    }
  }

  const write: IntegrationAccountWrite = {
    connectorId: options.session.connectorId,
    label: options.label?.trim() || accountHint || `${connector.name} account`,
    accountHint,
    authType: 'oauth',
    isDefault: options.isDefault,
    config: {
      ...(options.config || {}),
      oauthClientId: options.session.clientId,
    },
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    tokenType: tokens.tokenType,
    scopes: connector.oauth.scopes,
  }

  const account = await integrationsStore.getState().addAccount(write)
  return { accountId: account.id }
}

export function isDesktopOAuthSupported(): boolean {
  return isTauriRuntime() || platform.type === 'web'
}
