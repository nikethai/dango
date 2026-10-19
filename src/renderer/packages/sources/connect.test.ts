import type { BackgroundJob } from '@shared/types/background'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import type { ConnectedSource, SourceDraft, SourceKind } from '@shared/types/sources'
import type { WorkspaceDescriptor } from '@shared/types/workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { NeedsUserError, registerFixHandler, startJob } from '@/packages/background'
import { completeConnectorOAuth, startConnectorOAuth } from '@/packages/integrations'
import platform from '@/platform'
import { router } from '@/router'
import { waitForLocalOAuthCallback } from '@/utils/oauth-local-callback'
import {
  _resetSourceKindsForTests,
  _resetSourcesForTests,
  addSource,
  BACKGROUND_REVIEW_LINE,
  connectSource,
  discardSourceDraft,
  draftWasDiscarded,
  getSource,
  getSourceKind,
  isOAuthClientIdError,
  listSources,
  OAuthClientIdError,
  pickSource,
  registerBuiltinSourceKinds,
  registerSourceAdapter,
  registerSourceFixHandlers,
  SourceRuleError,
} from './index'

const h = vi.hoisted(() => {
  const accounts: { id: string; connectorId: string; accountHint?: string; label: string; status: string }[] = []
  return {
    memory: new Map<string, unknown>(),
    failRead: false,
    accounts,
    settings: {} as Record<string, unknown>,
    removeAccount: null as unknown as (id: string) => Promise<void>,
  }
})

vi.mock('@/storage', () => ({
  StorageKey: { Sources: 'sources' },
  default: {
    getItem: <T>(key: string, fallback: T): Promise<T> =>
      h.failRead
        ? Promise.reject(new Error('read failed'))
        : Promise.resolve(h.memory.has(key) ? (structuredClone(h.memory.get(key)) as T) : fallback),
    setItemNow: (key: string, value: unknown): Promise<void> => {
      h.memory.set(key, structuredClone(value))
      return Promise.resolve()
    },
    removeItem: (key: string): Promise<void> => {
      h.memory.delete(key)
      return Promise.resolve()
    },
  },
}))
vi.mock('@/platform', () => ({
  default: {
    pickAndBindProject: vi.fn(),
    adoptDraftFolderBinding: vi.fn(),
    unbindProject: vi.fn(async () => undefined),
    relinkProject: vi.fn(),
    restoreProjectBinding: vi.fn(),
    listWorkspaceChildren: vi.fn(),
    readWorkspaceFile: vi.fn(),
    detectCodexThreads: vi.fn(),
    listCodexThreads: vi.fn(),
    readCodexThread: vi.fn(),
    getKnowledgeBaseController: vi.fn(),
  },
  platformCapabilities: {
    supportsProjectWorkspace: true,
    supportsKnowledgeBase: true,
    supportsCodexThreads: true,
  },
}))
vi.mock('@/packages/background', async () => {
  const { NeedsUserError } = await import('@/packages/background/errors')
  let n = 0
  return {
    NeedsUserError,
    startJob: vi.fn((input: Partial<BackgroundJob>) => ({ ...input, id: `job-${++n}` })),
    registerFixHandler: vi.fn(),
    listJobs: vi.fn(() => []),
    stopJob: vi.fn(async () => undefined),
    setJobSourceResolver: vi.fn(),
  }
})
vi.mock('@/packages/knowledge', () => ({ markSourceRemoved: vi.fn(async () => 0) }))
vi.mock('@/packages/review', () => ({
  loadReviewEntries: vi.fn(async () => undefined),
  reviewStore: { getState: () => ({ entries: [] }) },
  setReviewEntryState: vi.fn(async () => undefined),
}))
vi.mock('@/hooks/useScopes', () => ({ readScopes: vi.fn(async () => []) }))
vi.mock('@/stores/integrationsStore', () => {
  h.removeAccount = vi.fn((id: string) => {
    const i = h.accounts.findIndex((a) => a.id === id)
    if (i >= 0) h.accounts.splice(i, 1)
    return Promise.resolve()
  })
  return {
    ensureIntegrationsStoreInit: vi.fn(async () => undefined),
    integrationsStore: {
      getState: () => ({
        getAccount: (id: string) => h.accounts.find((a) => a.id === id),
        removeAccount: h.removeAccount,
      }),
    },
  }
})
vi.mock('@/packages/integrations', () => ({
  startConnectorOAuth: vi.fn(),
  completeConnectorOAuth: vi.fn(),
}))
vi.mock('@/utils/oauth-local-callback', () => ({
  waitForLocalOAuthCallback: vi.fn(),
  canUseLocalOAuthCallback: () => true,
}))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: { getState: () => ({ getSettings: () => h.settings }) },
}))
vi.mock('@/stores/lastUsedModelStore', () => ({
  lastUsedModelStore: { getState: () => ({ chat: undefined }) },
}))
vi.mock('@/router', () => ({ router: { navigate: vi.fn(async () => undefined) } }))

type Mocked = { [K in keyof typeof platform]-?: ReturnType<typeof vi.fn> }
const p = platform as unknown as Mocked

function need<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing')
  return value
}
const kindOf = (kind: SourceKind) => need(getSourceKind(kind))

const descriptor = (displayPath: string, over: Partial<WorkspaceDescriptor> = {}): WorkspaceDescriptor => ({
  projectId: 'x',
  capabilityId: 'cap-1',
  rootGeneration: 'g1',
  displayPath,
  status: 'ready',
  ...over,
})

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const session = { connectorId: 'google_workspace', redirectUri: 'http://127.0.0.1:19847/oauth/callback', state: 's' }

function signInWorks(accountId = 'new-acct', hint = 'me@work.com') {
  vi.mocked(startConnectorOAuth).mockResolvedValue({ session, authUrl: 'https://auth' } as never)
  vi.mocked(waitForLocalOAuthCallback).mockResolvedValue({
    redirectUrl: 'http://127.0.0.1:19847/oauth/callback?code=c',
  })
  vi.mocked(completeConnectorOAuth).mockImplementation(() => {
    h.accounts.push({
      id: accountId,
      connectorId: 'google_workspace',
      accountHint: hint,
      label: hint,
      status: 'active',
    })
    return Promise.resolve({ accountId })
  })
}

const sourceOf = (over: Partial<ConnectedSource>): ConnectedSource => ({
  id: 's1',
  kind: 'folder',
  scopeId: 'acme',
  label: 'Acme',
  backgroundReview: false,
  localOnly: false,
  config: {},
  connectedAt: 1,
  ...over,
})

const ctx = () => ({ signal: new AbortController().signal, progress: vi.fn() })

beforeEach(() => {
  h.memory.clear()
  h.failRead = false
  h.accounts.length = 0
  h.settings = {}
  _resetSourcesForTests()
  _resetSourceKindsForTests()
  registerBuiltinSourceKinds()
  vi.clearAllMocks()
  p.unbindProject.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('folder', () => {
  it('folder pick binds a draft id; connect adopts it, adds the source and starts one sync job', async () => {
    p.pickAndBindProject.mockResolvedValue(descriptor('/Users/me/Work/Acme'))
    const draft = await pickSource('folder')
    const draftId = p.pickAndBindProject.mock.calls[0][0]
    expect(draftId).toMatch(/^draft:.+/)
    expect(draft).toMatchObject({ kind: 'folder', label: 'Acme', ref: '/Users/me/Work/Acme', draftBindingId: draftId })

    p.adoptDraftFolderBinding.mockResolvedValue(descriptor('/Users/me/Work/Acme', { projectId: 'acme' }))
    const result = await connectSource(draft as SourceDraft, { scopeId: 'acme', backgroundReview: true })

    expect(p.adoptDraftFolderBinding).toHaveBeenCalledWith(draftId, 'acme')
    expect(listSources()).toEqual([
      expect.objectContaining({
        id: result.sourceId,
        kind: 'folder',
        scopeId: 'acme',
        label: 'Acme',
        backgroundReview: true,
        config: { displayPath: '/Users/me/Work/Acme' },
      }),
    ])
    expect(startJob).toHaveBeenCalledTimes(1)
    expect(startJob).toHaveBeenCalledWith({
      kind: 'sync',
      label: 'Folder sync',
      scopeId: 'acme',
      sourceId: result.sourceId,
      sourceLabel: 'Acme',
    })
    expect(result.jobId).toBeDefined()
  })

  it('cancelled folder picker returns null and binds nothing', async () => {
    p.pickAndBindProject.mockResolvedValue(null)
    expect(await pickSource('folder')).toBeNull()
    expect(p.adoptDraftFolderBinding).not.toHaveBeenCalled()
    expect(p.unbindProject).not.toHaveBeenCalled()
    expect(listSources()).toEqual([])
  })

  it('aborting a folder pick removes the late draft binding', async () => {
    const picked = deferred<WorkspaceDescriptor | null>()
    p.pickAndBindProject.mockReturnValue(picked.promise)
    const controller = new AbortController()
    const pending = pickSource('folder', { signal: controller.signal })
    controller.abort()
    picked.resolve(descriptor('/Users/me/Acme'))
    expect(await pending).toBeNull()
    const draftId = p.pickAndBindProject.mock.calls[0][0]
    expect(p.unbindProject).toHaveBeenCalledWith(draftId)
    expect(p.adoptDraftFolderBinding).not.toHaveBeenCalled()
  })

  it('a rule error discards the draft and rethrows', async () => {
    p.pickAndBindProject.mockResolvedValue(descriptor('/Users/me/Acme'))
    const draft = (await pickSource('folder')) as SourceDraft
    const error = await connectSource(draft, { scopeId: EVERYWHERE_SCOPE_ID, backgroundReview: false }).catch((e) => e)
    expect(error).toBeInstanceOf(SourceRuleError)
    expect(error.code).toBe('folder-everywhere')
    expect(p.unbindProject).toHaveBeenCalledWith(draft.draftBindingId)
    expect(p.adoptDraftFolderBinding).not.toHaveBeenCalled()
    expect(listSources()).toEqual([])
    expect(startJob).not.toHaveBeenCalled()
  })

  it('a scope that already has a folder binding maps to folder-taken and discards the draft', async () => {
    p.pickAndBindProject.mockResolvedValue(descriptor('/Users/me/Acme'))
    const draft = (await pickSource('folder')) as SourceDraft
    p.adoptDraftFolderBinding.mockRejectedValue(
      Object.assign(new Error('ALREADY_EXISTS: This scope already has a folder.'), { code: 'ALREADY_EXISTS' })
    )
    const error = await connectSource(draft, { scopeId: 'acme', backgroundReview: false }).catch((e) => e)
    expect(error).toBeInstanceOf(SourceRuleError)
    expect(error.code).toBe('folder-taken')
    expect(p.unbindProject).toHaveBeenCalledWith(draft.draftBindingId)
    expect(listSources()).toEqual([])
  })

  it('a store rule error after adoption unbinds the adopted folder too', async () => {
    await addSource({
      kind: 'folder',
      scopeId: 'acme',
      label: 'Old',
      backgroundReview: false,
      localOnly: false,
      config: {},
    })
    p.pickAndBindProject.mockResolvedValue(descriptor('/Users/me/Acme'))
    const draft = (await pickSource('folder')) as SourceDraft
    p.adoptDraftFolderBinding.mockResolvedValue(descriptor('/Users/me/Acme', { projectId: 'acme' }))
    const error = await connectSource(draft, { scopeId: 'acme', backgroundReview: false }).catch((e) => e)
    expect(error.code).toBe('folder-taken')
    expect(p.unbindProject).toHaveBeenCalledWith('acme')
    expect(p.unbindProject).toHaveBeenCalledWith(draft.draftBindingId)
    expect(listSources()).toHaveLength(1)
  })

  it('any error after the folder was adopted unbinds it again and discards the draft', async () => {
    p.pickAndBindProject.mockResolvedValue(descriptor('/Users/me/Acme'))
    const draft = (await pickSource('folder')) as SourceDraft
    p.adoptDraftFolderBinding.mockResolvedValue(descriptor('/Users/me/Acme', { projectId: 'acme' }))
    // Storing the source fails with something other than a scope rule (sources cannot be read).
    h.failRead = true
    const error = await connectSource(draft, { scopeId: 'acme', backgroundReview: false }).catch((e) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(SourceRuleError)
    expect(p.unbindProject).toHaveBeenCalledWith('acme')
    expect(p.unbindProject).toHaveBeenCalledWith(draft.draftBindingId)
    expect(draftWasDiscarded(error)).toBe(true)
    expect(startJob).not.toHaveBeenCalled()
  })

  it('an attach that fails keeps the draft, so Connect can be tried again', async () => {
    p.pickAndBindProject.mockResolvedValue(descriptor('/Users/me/Acme'))
    const draft = (await pickSource('folder')) as SourceDraft
    p.adoptDraftFolderBinding.mockRejectedValue(new Error('disk busy'))
    const error = await connectSource(draft, { scopeId: 'acme', backgroundReview: false }).catch((e) => e)
    expect(error.message).toBe('disk busy')
    expect(p.unbindProject).not.toHaveBeenCalled()
    expect(draftWasDiscarded(error)).toBe(false)
  })

  it('folder sync raises a relink fix when the binding is missing', async () => {
    const def = kindOf('folder')
    p.restoreProjectBinding.mockResolvedValue(descriptor('/gone', { status: 'missing' }))
    const error = await need(def.sync)(sourceOf({}), ctx()).catch((e) => e)
    expect(error).toBeInstanceOf(NeedsUserError)
    expect(error.reason).toBe('the folder moved or was deleted')
    expect(error.fix).toEqual({ action: 'relink-folder', label: 'Find the folder' })

    p.restoreProjectBinding.mockRejectedValue(
      Object.assign(new Error('UNAUTHORIZED_ROOT: No native binding exists for this project'), {
        code: 'UNAUTHORIZED_ROOT',
      })
    )
    const unbound = await need(def.sync)(sourceOf({}), ctx()).catch((e) => e)
    expect(unbound).toBeInstanceOf(NeedsUserError)
    expect(unbound.fix.action).toBe('relink-folder')
  })

  it('folder sync walks the folder breadth-first, paging on the cursor, and reports progress', async () => {
    p.restoreProjectBinding.mockResolvedValue(descriptor('/Users/me/Acme'))
    const file = (relativePath: string) => ({
      name: relativePath.split('/').pop() as string,
      relativePath,
      kind: 'file',
    })
    const pages: Record<string, { entries: unknown[]; cursor: string | null }> = {
      '': { entries: [file('a.md'), { name: 'docs', relativePath: 'docs', kind: 'directory' }], cursor: 'next' },
      ':next': { entries: [file('b.txt')], cursor: null },
      docs: { entries: [file('docs/c.md')], cursor: null },
    }
    p.listWorkspaceChildren.mockImplementation((_cap: string, dir: string, cursor?: string) =>
      Promise.resolve((pages[cursor ? `${dir}:${cursor}` : dir] ?? { entries: [], cursor: null }) as never)
    )
    const c = ctx()
    const result = await need(kindOf('folder').sync)(sourceOf({}), c)
    expect(result.summary).toBe('Read 3 files from Acme')
    expect(p.listWorkspaceChildren).toHaveBeenCalledWith('cap-1', '', 'next')
    expect(c.progress).toHaveBeenLastCalledWith('Reading your folder · 3 files')
  })

  it('folder read takes changed text files under 200 KB and keeps their revisions in the cursor', async () => {
    p.restoreProjectBinding.mockResolvedValue(descriptor('/Users/me/Acme'))
    p.listWorkspaceChildren.mockResolvedValue({
      entries: [
        { name: 'a.md', relativePath: 'a.md', kind: 'file', size: 10, revision: 'r1' },
        { name: 'b.txt', relativePath: 'b.txt', kind: 'file', size: 10, revision: 'r2' },
        { name: 'big.md', relativePath: 'big.md', kind: 'file', size: 300 * 1024, revision: 'r3' },
        { name: 'pic.png', relativePath: 'pic.png', kind: 'file', size: 10, revision: 'r4' },
      ],
      cursor: null,
    })
    p.readWorkspaceFile.mockImplementation(async (_cap: string, rel: string) => ({
      content: `text of ${rel}`,
      revision: rel === 'a.md' ? 'r1' : 'r2',
      truncated: false,
      encoding: 'utf-8' as const,
      relativePath: rel,
      size: 10,
    }))
    const read = need(kindOf('folder').read)
    const result = await read(sourceOf({}), { signal: new AbortController().signal, cursor: '{"a.md":"r1"}' })
    expect(result.items).toEqual([{ ref: 'b.txt', label: 'b.txt', text: 'text of b.txt' }])
    expect(JSON.parse(result.cursor as string)).toEqual({ 'a.md': 'r1', 'b.txt': 'r2' })
  })

  it('folder read reaches every file across runs when the listing has no revisions', async () => {
    p.restoreProjectBinding.mockResolvedValue(descriptor('/Users/me/Acme'))
    const names = Array.from({ length: 41 }, (_, i) => `n${String(i).padStart(2, '0')}.md`)
    p.listWorkspaceChildren.mockResolvedValue({
      entries: names.map((name) => ({ name, relativePath: name, kind: 'file', size: 10 })),
      cursor: null,
    })
    p.readWorkspaceFile.mockImplementation((_cap: string, rel: string) =>
      Promise.resolve({ content: rel, revision: 'r', truncated: false, encoding: 'utf-8', relativePath: rel, size: 10 })
    )
    const read = need(kindOf('folder').read)
    const first = await read(sourceOf({}), { signal: new AbortController().signal, cursor: null })
    expect(first.items).toHaveLength(40)
    p.readWorkspaceFile.mockClear()
    const second = await read(sourceOf({}), { signal: new AbortController().signal, cursor: first.cursor })
    expect(p.readWorkspaceFile.mock.calls[0][1]).toBe('n40.md')
    expect(second.items.map((i) => i.ref)).toEqual(['n40.md'])
  })

  it('folder revoke unbinds the scope and reconnect relinks it', async () => {
    const def = kindOf('folder')
    await need(def.revoke)(sourceOf({}))
    expect(p.unbindProject).toHaveBeenCalledWith('acme')
    p.relinkProject.mockResolvedValue(null)
    expect(await need(def.reconnect)(sourceOf({}))).toBe(false)
    p.relinkProject.mockResolvedValue(descriptor('/Users/me/Moved/Acme'))
    expect(await need(def.reconnect)(sourceOf({}))).toBe(true)
    expect(p.relinkProject).toHaveBeenCalledWith('acme')
  })
})

describe('OAuth kinds', () => {
  it('aborting pick while waiting for the browser creates no account', async () => {
    vi.mocked(startConnectorOAuth).mockResolvedValue({ session, authUrl: 'https://auth' } as never)
    const callback = deferred<{ redirectUrl: string }>()
    vi.mocked(waitForLocalOAuthCallback).mockReturnValue(callback.promise)
    const controller = new AbortController()
    const pending = pickSource('gmail', { signal: controller.signal })
    await vi.waitFor(() => expect(waitForLocalOAuthCallback).toHaveBeenCalled())
    expect(vi.mocked(waitForLocalOAuthCallback).mock.calls[0][0]).toMatchObject({ port: 19847 })
    controller.abort()
    callback.resolve({ redirectUrl: 'http://127.0.0.1:19847/oauth/callback?code=late' })
    expect(await pending).toBeNull()
    expect(completeConnectorOAuth).not.toHaveBeenCalled()

    // The real helper rejects on abort ("OAuth callback cancelled"): still a plain cancel.
    vi.mocked(waitForLocalOAuthCallback).mockRejectedValue(new Error('OAuth callback cancelled'))
    const second = new AbortController()
    second.abort()
    expect(await pickSource('asana', { signal: second.signal })).toBeNull()
    expect(completeConnectorOAuth).not.toHaveBeenCalled()
  })

  it('a redirect URI without a port waits on the protocol default port', async () => {
    for (const [redirectUri, port] of [
      ['http://localhost/oauth/callback', 80],
      ['https://localhost/oauth/callback', 443],
    ] as const) {
      vi.mocked(waitForLocalOAuthCallback).mockClear()
      vi.mocked(startConnectorOAuth).mockResolvedValue({ session: { ...session, redirectUri }, authUrl: 'x' } as never)
      const callback = deferred<{ redirectUrl: string }>()
      vi.mocked(waitForLocalOAuthCallback).mockReturnValue(callback.promise)
      const controller = new AbortController()
      const pending = pickSource('gmail', { signal: controller.signal })
      await vi.waitFor(() => expect(waitForLocalOAuthCallback).toHaveBeenCalled())
      controller.abort()
      callback.reject(new Error('OAuth callback cancelled'))
      expect(await pending).toBeNull()
      expect(vi.mocked(waitForLocalOAuthCallback).mock.calls[0][0]).toMatchObject({ port })
    }
  })

  it('a sign-in that finishes after the abort removes the account it created', async () => {
    vi.mocked(startConnectorOAuth).mockResolvedValue({ session, authUrl: 'https://auth' } as never)
    vi.mocked(waitForLocalOAuthCallback).mockResolvedValue({ redirectUrl: 'http://127.0.0.1:19847/cb?code=c' })
    const controller = new AbortController()
    vi.mocked(completeConnectorOAuth).mockImplementation(() => {
      h.accounts.push({ id: 'late', connectorId: 'google_workspace', label: 'x', status: 'active' })
      controller.abort()
      return Promise.resolve({ accountId: 'late' })
    })
    expect(await pickSource('gmail', { signal: controller.signal })).toBeNull()
    expect(h.removeAccount).toHaveBeenCalledWith('late')
  })

  it('Gmail signs in with the mail scope pack and records the account it created', async () => {
    signInWorks()
    const draft = await pickSource('gmail')
    expect(startConnectorOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ connectorId: 'google_workspace', scopes: expect.arrayContaining(['email']) })
    )
    expect(vi.mocked(startConnectorOAuth).mock.calls[0][0].scopes).not.toContain(
      'https://www.googleapis.com/auth/drive'
    )
    expect(completeConnectorOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ config: { scopePack: 'mail' }, redirectOrCode: expect.stringContaining('code=c') })
    )
    expect(draft).toMatchObject({
      kind: 'gmail',
      label: 'me@work.com',
      ref: 'me@work.com',
      config: { accountId: 'new-acct' },
      createdAccountId: 'new-acct',
    })
  })

  it('an existing account is reused without the browser', async () => {
    h.accounts.push({
      id: 'a1',
      connectorId: 'google_workspace',
      accountHint: 'old@work.com',
      label: 'Old',
      status: 'active',
    })
    const draft = await pickSource('gmail', { choice: { accountId: 'a1' } })
    expect(draft).toMatchObject({ kind: 'gmail', label: 'old@work.com', config: { accountId: 'a1' } })
    expect(draft?.createdAccountId).toBeUndefined()
    expect(startConnectorOAuth).not.toHaveBeenCalled()
    expect(waitForLocalOAuthCallback).not.toHaveBeenCalled()
  })

  it('discard removes the draft binding and only a newly created account', async () => {
    p.pickAndBindProject.mockResolvedValue(descriptor('/Users/me/Acme'))
    const folder = (await pickSource('folder')) as SourceDraft
    await discardSourceDraft(folder)
    expect(p.unbindProject).toHaveBeenCalledWith(folder.draftBindingId)

    signInWorks('fresh')
    const created = (await pickSource('gmail')) as SourceDraft
    await discardSourceDraft(created)
    expect(h.removeAccount).toHaveBeenCalledTimes(1)
    expect(h.removeAccount).toHaveBeenCalledWith('fresh')

    h.accounts.push({ id: 'kept', connectorId: 'asana', label: 'Me', status: 'active' })
    const reused = (await pickSource('asana', { choice: { accountId: 'kept' } })) as SourceDraft
    await discardSourceDraft(reused)
    expect(h.removeAccount).toHaveBeenCalledTimes(1)
    expect(h.accounts.map((a) => a.id)).toContain('kept')
  })

  it('Gmail with no adapter registered starts no job', async () => {
    signInWorks()
    const draft = (await pickSource('gmail')) as SourceDraft
    const first = await connectSource(draft, { scopeId: 'acme', backgroundReview: false })
    expect(first.jobId).toBeUndefined()
    expect(startJob).not.toHaveBeenCalled()

    registerSourceAdapter('gmail', { sync: async () => ({ summary: 'ok' }) })
    const second = await connectSource(draft, { scopeId: 'beta', backgroundReview: false })
    expect(second.jobId).toBeDefined()
    expect(startJob).toHaveBeenCalledWith({
      kind: 'sync',
      label: 'Gmail sync',
      scopeId: 'beta',
      sourceId: second.sourceId,
      sourceLabel: 'me@work.com',
    })
  })

  it('connect stores backgroundReview as given', async () => {
    h.accounts.push({ id: 'a1', connectorId: 'asana', accountHint: 'me', label: 'me', status: 'active' })
    const draft = (await pickSource('asana', { choice: { accountId: 'a1' } })) as SourceDraft
    const on = await connectSource(draft, { scopeId: 'acme', backgroundReview: true })
    const off = await connectSource(draft, { scopeId: 'beta', backgroundReview: false })
    expect(getSource(on.sourceId)?.backgroundReview).toBe(true)
    expect(getSource(off.sourceId)?.backgroundReview).toBe(false)
  })

  it('a missing OAuth client ID becomes a translated error that points at Integrations', async () => {
    vi.mocked(startConnectorOAuth).mockRejectedValue(
      new Error(
        'OAuth client ID is required. Add your app client id under Advanced, or set it in Integrations settings.'
      )
    )
    const error = await pickSource('gmail').catch((e) => e)
    expect(error).toBeInstanceOf(OAuthClientIdError)
    expect(isOAuthClientIdError(error)).toBe(true)
    expect(error.message).toBe('Add an OAuth client ID in Integrations.')
    expect(error.actionLabel).toBe('Open Integrations')
    expect(error.to).toBe('/settings/integrations')
  })

  it('reconnect signs in again and stores the new account', async () => {
    const stored = await addSource({
      kind: 'gmail',
      scopeId: 'acme',
      label: 'me@work.com',
      backgroundReview: false,
      localOnly: false,
      config: { accountId: 'old' },
    })
    signInWorks('renewed')
    expect(await need(kindOf('gmail').reconnect)(stored)).toBe(true)
    expect(getSource(stored.id)?.config.accountId).toBe('renewed')
  })
})

describe('documents', () => {
  it('Documents does not support background review', async () => {
    p.getKnowledgeBaseController.mockReturnValue({
      list: async () => [{ id: 7, name: 'Contracts' }],
    } as never)
    expect(getSourceKind('documents')?.supportsBackgroundReview).toBe(false)
    const draft = (await pickSource('documents', { choice: { kbId: 7 } })) as SourceDraft
    expect(draft).toMatchObject({ kind: 'documents', label: 'Contracts', ref: 'Contracts', config: { kbId: 7 } })
    const { sourceId } = await connectSource(draft, { scopeId: 'acme', backgroundReview: true })
    expect(getSource(sourceId)?.backgroundReview).toBe(false)
  })

  it('Documents sync counts ready and still indexing files', async () => {
    p.getKnowledgeBaseController.mockReturnValue({
      countFiles: async () => 3,
      listFiles: async () => [{ status: 'done' }, { status: 'done' }, { status: 'processing' }],
    } as never)
    const result = await need(kindOf('documents').sync)(sourceOf({ kind: 'documents', config: { kbId: 7 } }), ctx())
    expect(result.summary).toBe('2 documents ready to search, 1 still indexing')
  })

  it('Documents counts only finished files as ready; failed files are neither ready nor indexing', async () => {
    p.getKnowledgeBaseController.mockReturnValue({
      countFiles: async () => 6,
      listFiles: async () => [
        { status: 'done' },
        { status: 'done' },
        { status: 'failed' },
        { status: 'failed' },
        { status: 'pending' },
        { status: 'paused' },
      ],
    } as never)
    const result = await need(kindOf('documents').sync)(sourceOf({ kind: 'documents', config: { kbId: 7 } }), ctx())
    expect(result.summary).toBe('2 documents ready to search, 2 still indexing')
  })

  it('a Documents source without a collection fails with a translated message', async () => {
    const t = vi.spyOn(i18n, 't')
    try {
      await expect(need(kindOf('documents').sync)(sourceOf({ kind: 'documents', config: {} }), ctx())).rejects.toThrow(
        'This Documents source has no collection.'
      )
      expect(t).toHaveBeenCalledWith('This Documents source has no collection.')
    } finally {
      t.mockRestore()
    }
  })
})

describe('fix handlers', () => {
  const handlerFor = (action: string) => {
    const call = vi.mocked(registerFixHandler).mock.calls.find(([a]) => a === action)
    return call?.[1] as (job: BackgroundJob) => Promise<boolean>
  }
  const job = (over: Partial<BackgroundJob> = {}): BackgroundJob => ({
    id: 'j1',
    scopeId: 'acme',
    kind: 'sync',
    label: 'Folder sync',
    status: 'needs-you',
    attempts: 0,
    startedAt: 1,
    ...over,
  })

  it('relink-folder relinks the job source and try-again is always true', async () => {
    registerSourceFixHandlers()
    const source = await addSource({
      kind: 'folder',
      scopeId: 'acme',
      label: 'Acme',
      backgroundReview: false,
      localOnly: false,
      config: {},
    })
    p.relinkProject.mockResolvedValue(descriptor('/Users/me/Acme'))
    expect(await handlerFor('relink-folder')(job({ sourceId: source.id }))).toBe(true)
    expect(p.relinkProject).toHaveBeenCalledWith('acme')
    expect(await handlerFor('try-again')(job())).toBe(true)
    expect(await handlerFor('reconnect')(job({ sourceId: 'missing' }))).toBe(false)
  })

  it('choose-model re-runs when a model is set up, and opens provider settings when not', async () => {
    registerSourceFixHandlers()
    const chooseModel = handlerFor('choose-model')
    expect(await chooseModel(job())).toBe(false)
    expect(router.navigate).toHaveBeenCalledWith({ to: '/settings/provider' })

    vi.mocked(router.navigate).mockClear()
    h.settings = {
      defaultChatModel: { provider: 'openai', model: 'gpt-4o' },
      providers: { openai: { apiKey: 'sk-test' } },
    }
    expect(await chooseModel(job())).toBe(true)
    expect(router.navigate).not.toHaveBeenCalled()
  })
})

it('one Background review line, shared by the sheet and the Sources rows', () => {
  expect(BACKGROUND_REVIEW_LINE).toBe(
    'Lets Dango read this source on a schedule to propose knowledge. Reading never makes anything authoritative.'
  )
})
