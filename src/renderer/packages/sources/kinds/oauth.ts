import { getConnector } from '@shared/integrations'
import type { SourceDraft, SourceKind } from '@shared/types/sources'
import i18n from '@/i18n'
import { completeConnectorOAuth, startConnectorOAuth } from '@/packages/integrations'
import { ensureIntegrationsStoreInit, integrationsStore } from '@/stores/integrationsStore'
import { canUseLocalOAuthCallback, waitForLocalOAuthCallback } from '@/utils/oauth-local-callback'
import type { SourceKindDefinition } from '../kinds'
import { updateSource } from '../store'
import { UNAVAILABLE_HINT } from './common'

/** Integrations route the client-ID error points at. */
export const INTEGRATIONS_ROUTE = '/settings/integrations'

// `startConnectorOAuth` throws this raw English sentence when a connector needs the user's own OAuth app.
const CLIENT_ID_REQUIRED_PREFIX = 'OAuth client ID is required'

/**
 * The connector has no OAuth client ID yet. `message` is translated; the sheet shows it with an `actionLabel`
 * button that opens `to`.
 */
export class OAuthClientIdError extends Error {
  readonly actionLabel: string
  readonly to = INTEGRATIONS_ROUTE

  constructor() {
    super(i18n.t('Add an OAuth client ID in Integrations.'))
    this.name = 'OAuthClientIdError'
    this.actionLabel = i18n.t('Open Integrations')
  }
}

export function isOAuthClientIdError(error: unknown): error is OAuthClientIdError {
  return error instanceof OAuthClientIdError
}

type OAuthKindSpec = {
  kind: Extract<SourceKind, 'gmail' | 'asana'>
  name: string
  hint: string
  connectorId: string
  /** Narrower scopes than the connector's full list (Gmail: the mail scope pack). */
  scopes?: () => string[] | undefined
  /** Non-secret account config passed to `completeConnectorOAuth`. */
  accountConfig?: Record<string, string>
}

/**
 * Opens the browser sign-in and waits for the local callback. Resolves to the new account id, or null when `signal`
 * was aborted first: then no account is created, and one finished after the abort is removed again.
 */
async function signIn(spec: OAuthKindSpec, signal: AbortSignal): Promise<string | null> {
  if (signal.aborted) return null
  let start: Awaited<ReturnType<typeof startConnectorOAuth>>
  try {
    start = await startConnectorOAuth({ connectorId: spec.connectorId, scopes: spec.scopes?.() })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(CLIENT_ID_REQUIRED_PREFIX)) throw new OAuthClientIdError()
    throw error
  }
  if (signal.aborted) return null
  // The session's redirect honours an Integrations override, so its port is the one the browser comes back to.
  // Without an explicit port the browser comes back on the protocol's default port, never the helper's own.
  const redirect = new URL(start.session.redirectUri)
  const port = Number(redirect.port) || (redirect.protocol === 'https:' ? 443 : 80)
  let redirectUrl: string
  try {
    ;({ redirectUrl } = await waitForLocalOAuthCallback({ port, signal }))
  } catch (error) {
    // The helper rejects with "OAuth callback cancelled" on abort: that is a cancel, not a failure.
    if (signal.aborted) return null
    throw error
  }
  if (signal.aborted) return null
  const { accountId } = await completeConnectorOAuth({
    session: start.session,
    redirectOrCode: redirectUrl,
    config: spec.accountConfig,
  })
  if (signal.aborted) {
    await integrationsStore.getState().removeAccount(accountId)
    return null
  }
  return accountId
}

async function draftFor(spec: OAuthKindSpec, accountId: string, created: boolean): Promise<SourceDraft> {
  await ensureIntegrationsStoreInit()
  const hint = integrationsStore.getState().getAccount(accountId)?.accountHint
  return {
    kind: spec.kind,
    // Account hint is external text (an address or name); the kind name is the fallback.
    label: hint || i18n.t(spec.name),
    ref: hint,
    config: { accountId },
    ...(created ? { createdAccountId: accountId } : {}),
  }
}

function oauthKind(spec: OAuthKindSpec): SourceKindDefinition {
  return {
    kind: spec.kind,
    name: spec.name,
    hint: spec.hint,
    connectorId: spec.connectorId,
    supportsBackgroundReview: true,
    isAvailable: () => canUseLocalOAuthCallback(),
    unavailableHint: UNAVAILABLE_HINT,

    async pick({ signal, choice }) {
      if (signal.aborted) return null
      if (choice?.accountId) {
        await ensureIntegrationsStoreInit()
        const account = integrationsStore.getState().getAccount(choice.accountId)
        if (account && account.connectorId === spec.connectorId && account.status === 'active') {
          return draftFor(spec, account.id, false)
        }
      }
      const accountId = await signIn(spec, signal)
      return accountId ? draftFor(spec, accountId, true) : null
    },

    // Removes only an account this draft created; an account the user already had stays.
    async discard(draft) {
      if (!draft.createdAccountId) return
      await ensureIntegrationsStoreInit()
      await integrationsStore.getState().removeAccount(draft.createdAccountId)
    },

    async reconnect(source) {
      const accountId = await signIn(spec, new AbortController().signal)
      if (!accountId) return false
      await updateSource(source.id, { config: { ...source.config, accountId } })
      return true
    },
    // No `revoke`: the Integrations account stays. No `sync`/`read` until slice 10 registers adapters.
  }
}

export const gmailKind = oauthKind({
  kind: 'gmail',
  name: 'Gmail',
  hint: 'Your mail. Opens Google sign-in in your browser.',
  connectorId: 'google_workspace',
  scopes: () => getConnector('google_workspace')?.scopePacks?.mail,
  accountConfig: { scopePack: 'mail' },
})

export const asanaKind = oauthKind({
  kind: 'asana',
  name: 'Asana',
  hint: 'Tasks and comments. Opens Asana sign-in in your browser.',
  connectorId: 'asana',
})
