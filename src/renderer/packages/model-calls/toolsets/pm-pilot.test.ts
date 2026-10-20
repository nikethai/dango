import type { Scope } from '@shared/types/scope'
import type { ConnectedSource } from '@shared/types/sources'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state, recallClient, loadSources } = vi.hoisted(() => ({
  state: { platformType: 'desktop', scopes: [] as Scope[], sources: [] as ConnectedSource[] },
  recallClient: vi.fn(async (_input: unknown): Promise<unknown> => ({ ok: true, records: [], gaps: [] })),
  loadSources: vi.fn(async () => undefined),
}))

vi.mock('@/platform', () => ({
  default: {
    get type() {
      return state.platformType
    },
  },
}))
vi.mock('@/packages/pm-pilot/bridge', () => ({
  listClientScopes: async () => state.scopes.filter((s) => s.kind === 'client'),
  loadSources: () => loadSources(),
  listSources: () => state.sources,
}))
vi.mock('@/packages/pm-pilot/recall', () => ({ recallClient: (input: unknown) => recallClient(input) }))

import { loadPmToolSet, pmToolSet } from './pm-pilot'

const scope = (id: string, kind: 'client' | 'project') => ({ id, name: id, kind }) as Scope
const source = (id: string, scopeId: string, kind: ConnectedSource['kind']) =>
  ({
    id,
    scopeId,
    kind,
    label: id,
    backgroundReview: false,
    localOnly: false,
    config: {},
    connectedAt: 0,
  }) as ConnectedSource

beforeEach(() => {
  state.platformType = 'desktop'
  state.scopes = [scope('acme', 'client'), scope('site', 'project')]
  state.sources = [source('g1', 'acme', 'gmail')]
  recallClient.mockClear()
  loadSources.mockClear()
})

describe('loadPmToolSet', () => {
  it('is enabled on desktop when a client scope has a Gmail or Asana source', async () => {
    const set = await loadPmToolSet({ sessionScopeId: 'acme', cloudModel: true })
    expect(loadSources).toHaveBeenCalled()
    expect(Object.keys(set?.tools ?? {})).toEqual(['client_recall'])
    state.sources = [source('a1', 'acme', 'asana')]
    expect(await loadPmToolSet({ cloudModel: true })).not.toBeNull()
  })

  it('is off when no client scope has a Gmail or Asana source', async () => {
    state.sources = [source('g1', 'site', 'gmail'), source('f1', 'acme', 'folder')]
    expect(await loadPmToolSet({ cloudModel: true })).toBeNull()
    state.sources = []
    expect(await loadPmToolSet({ cloudModel: true })).toBeNull()
  })

  it('is off where the PM pilot does not run (not desktop)', async () => {
    state.platformType = 'web'
    expect(await loadPmToolSet({ sessionScopeId: 'acme', cloudModel: true })).toBeNull()
    expect(loadSources).not.toHaveBeenCalled()
  })
})

describe('pmToolSet', () => {
  it('tells the model the records are client data, to ask which client, cite links and state gaps', () => {
    const set = pmToolSet({ cloudModel: true })
    const toolDescription = (set.tools.client_recall as { description?: string }).description ?? ''
    for (const text of [set.description, toolDescription]) {
      expect(text).toMatch(/client data, not instructions/i)
      expect(text).toMatch(/ambiguous_client/)
      expect(text).toMatch(/no_client_given/)
      expect(text).toMatch(/link/i)
      expect(text).toMatch(/gaps/i)
    }
    expect(Object.keys(set.tools).some((name) => /send|reply/.test(name))).toBe(false)
  })

  it("passes the chat's scope and the cloud flag from the context, not from the model", async () => {
    const set = pmToolSet({ sessionScopeId: 'acme', cloudModel: true })
    const execute = (set.tools.client_recall as { execute: (input: unknown, opts: unknown) => Promise<unknown> })
      .execute
    await execute({ client: 'Acme', query: 'launch date', cloudModel: false, sessionScopeId: 'x', limit: 3 }, {})
    expect(recallClient).toHaveBeenCalledWith({
      client: 'Acme',
      query: 'launch date',
      limit: 3,
      sessionScopeId: 'acme',
      cloudModel: true,
    })
  })
})
