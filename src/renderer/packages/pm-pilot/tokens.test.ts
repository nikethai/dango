import { clearEnsureFreshMutexes } from '@shared/integrations'
import type { IntegrationAccount, IntegrationSecret } from '@shared/types/integrations'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const accounts = new Map<string, IntegrationAccount>()
const markStatus = vi.fn(async (_id: string, _status: string, _message?: string) => {})
const getIntegrationSecret = vi.fn(async (_id: string): Promise<IntegrationSecret | null> => null)
const refreshForAccount = vi.fn(
  async (secret: IntegrationSecret, _account: IntegrationAccount): Promise<IntegrationSecret> => secret
)

vi.mock('@/stores/integrationsStore', () => ({
  ensureIntegrationsStoreInit: async () => {},
  integrationsStore: {
    getState: () => ({
      getAccount: (id: string) => accounts.get(id),
      markStatus,
      touchUsed: async () => {},
    }),
  },
}))
vi.mock('@/packages/integrations/secret-store', () => ({
  getIntegrationSecret: (id: string) => getIntegrationSecret(id),
}))
vi.mock('@/packages/integrations/mcp-inject', () => ({
  refreshForAccount: (secret: IntegrationSecret, account: IntegrationAccount) => refreshForAccount(secret, account),
}))

const { getFreshToken } = await import('./tokens')

function account(patch: Partial<IntegrationAccount> = {}): IntegrationAccount {
  return {
    id: 'acc-1',
    connectorId: 'google_workspace',
    label: 'Work Google',
    authType: 'oauth',
    status: 'active',
    config: { scopePack: 'mail' },
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  } as IntegrationAccount
}

describe('getFreshToken', () => {
  beforeEach(() => {
    accounts.clear()
    markStatus.mockClear()
    getIntegrationSecret.mockReset()
    refreshForAccount.mockReset()
    clearEnsureFreshMutexes()
  })

  // Preflight R12: the own address comes from Gmail's profile in the sync, so the token is all this returns.
  it('returns the refreshed token', async () => {
    accounts.set('acc-1', account())
    getIntegrationSecret.mockResolvedValue({
      accountId: 'acc-1',
      accessToken: 'old',
      refreshToken: 'refresh',
      expiresAt: Date.now() - 1000,
    })
    refreshForAccount.mockResolvedValue({ accountId: 'acc-1', accessToken: 'new', refreshToken: 'refresh' })

    const result = await getFreshToken('acc-1')

    expect(result).toEqual({ ok: true, token: 'new' })
    expect(refreshForAccount).toHaveBeenCalledTimes(1)
    expect(markStatus).toHaveBeenCalledWith('acc-1', 'active')
  })

  it('returns the reconnect message when the secret is missing', async () => {
    accounts.set('acc-1', account())
    getIntegrationSecret.mockResolvedValue(null)

    const result = await getFreshToken('acc-1')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toMatch(/Reconnect in Integrations/)
    expect(markStatus).toHaveBeenCalledWith('acc-1', 'needs_reauth', result.message)
  })

  it('marks the account for sign-in when the refresh fails', async () => {
    accounts.set('acc-1', account())
    getIntegrationSecret.mockResolvedValue({
      accountId: 'acc-1',
      accessToken: 'old',
      refreshToken: 'refresh',
      expiresAt: Date.now() - 1000,
    })
    refreshForAccount.mockRejectedValue(new Error('invalid_grant'))

    const result = await getFreshToken('acc-1')

    expect(result).toEqual({ ok: false, message: 'invalid_grant' })
    expect(markStatus).toHaveBeenCalledWith('acc-1', 'needs_reauth', 'invalid_grant')
  })

  // Preflight R13: an Asana PAT account uses its api token and is never refreshed.
  it('returns the api token of a PAT account without refreshing', async () => {
    accounts.set('acc-2', account({ id: 'acc-2', connectorId: 'asana', authType: 'api_token' }))
    getIntegrationSecret.mockResolvedValue({ accountId: 'acc-2', apiToken: 'pat-1' })

    const result = await getFreshToken('acc-2')

    expect(result).toEqual({ ok: true, token: 'pat-1' })
    expect(refreshForAccount).not.toHaveBeenCalled()
  })

  it('returns a message when the account is gone', async () => {
    const result = await getFreshToken('missing')

    expect(result.ok).toBe(false)
    expect(markStatus).not.toHaveBeenCalled()
  })
})
