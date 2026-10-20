// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

const readScopes = vi.fn()
vi.mock('@/hooks/useScopes', () => ({ readScopes: () => readScopes() }))

import { asanaConfig, getScope, gmailConfig, listClientScopes } from './bridge'

describe('pm-pilot bridge', () => {
  it('reads client scopes and one scope by id', async () => {
    readScopes.mockResolvedValue([
      { id: 'p1', name: 'Site', kind: 'project' },
      { id: 'c1', name: 'Acme', kind: 'client' },
    ])
    expect((await listClientScopes()).map((s) => s.id)).toEqual(['c1'])
    expect((await getScope('p1'))?.name).toBe('Site')
    expect(await getScope('nope')).toBeUndefined()
  })

  it('parses source configs, with missing matchers as none', () => {
    expect(gmailConfig({ config: { accountId: 'a1' } })).toEqual({ accountId: 'a1', matchers: [] })
    expect(gmailConfig({ config: { accountId: 'a1', matchers: ['@acme.com', 3, ''] } })).toEqual({
      accountId: 'a1',
      matchers: ['@acme.com'],
    })
    expect(asanaConfig({ config: { accountId: 'a2' } })).toEqual({ accountId: 'a2' })
    expect(asanaConfig({ config: { accountId: 'a2', projectGid: '123' } })).toEqual({
      accountId: 'a2',
      projectGid: '123',
    })
  })

  it('does not expose Trust', async () => {
    expect('getTrustLevel' in (await import('./bridge'))).toBe(false)
  })
})
