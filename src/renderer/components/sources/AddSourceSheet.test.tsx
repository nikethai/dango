/**
 * @vitest-environment jsdom
 */

import NiceModal from '@ebay/nice-modal-react'
import type { SourceDraft, SourceKind } from '@shared/types/sources'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const interpolate = (key: string, opts?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(opts?.[name] ?? ''))
  class SourceRuleError extends Error {
    code: string
    constructor(code: string) {
      super(code === 'folder-taken' ? 'This scope already has a folder.' : code)
      this.name = 'SourceRuleError'
      this.code = code
    }
  }
  class OAuthClientIdError extends Error {
    readonly actionLabel = 'Open Integrations'
    readonly to = '/settings/integrations'
    constructor() {
      super('Add an OAuth client ID in Integrations.')
      this.name = 'OAuthClientIdError'
    }
  }
  return {
    interpolate,
    SourceRuleError,
    OAuthClientIdError,
    // undefined = still looking; null = unavailable.
    codex: undefined as { found: boolean; threadCount: number; displayPath: string } | null | undefined,
    accounts: [] as Array<{ id: string; connectorId: string; label: string; accountHint?: string; status: string }>,
    kbs: [] as Array<{ id: number; name: string }> | undefined,
    windowLabel: 'main' as string,
    available: { folder: true, gmail: true, asana: true, 'codex-threads': true, documents: true } as Record<
      string,
      boolean
    >,
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: h.interpolate }),
}))

vi.mock('@/packages/sources', () => {
  const kind = (k: string, name: string, hint: string, extra: Record<string, unknown> = {}) => ({
    kind: k,
    name,
    hint,
    supportsBackgroundReview: k !== 'documents',
    isAvailable: () => h.available[k],
    unavailableHint: 'Needs the desktop app.',
    pick: vi.fn(),
    ...extra,
  })
  return {
    listSourceKinds: () => [
      kind('folder', 'Folder', 'A folder on this computer. Dango reads the files in it.'),
      kind('gmail', 'Gmail', 'Your mail. Opens Google sign-in in your browser.', { connectorId: 'google_workspace' }),
      kind('asana', 'Asana', 'Tasks and comments. Opens Asana sign-in in your browser.', { connectorId: 'asana' }),
      kind('codex-threads', 'Codex threads', 'No Codex threads on this computer.'),
      kind('documents', 'Documents', 'Files Dango searches when answering. Never treated as approved knowledge.'),
    ],
    MCP_SOURCE_OPTION: {
      name: 'MCP server',
      badge: 'Advanced',
      hint: 'Tools and data from an MCP server. Set up in Advanced.',
      to: '/settings/mcp',
    },
    pickSource: vi.fn(),
    connectSource: vi.fn(),
    discardSourceDraft: vi.fn(async () => undefined),
    draftWasDiscarded: (e: unknown) =>
      e instanceof h.SourceRuleError || (e as { discarded?: boolean } | null)?.discarded === true,
    revokeSource: vi.fn(async () => undefined),
    useCodexDetection: () => h.codex,
    codexThreadsFound: (d: { found: boolean; threadCount: number } | null | undefined) =>
      !!d?.found && d.threadCount > 0,
    codexThreadsHint: (d: { found: boolean; threadCount: number; displayPath: string } | null | undefined) => {
      if (d === undefined) return 'Looking for Codex threads…'
      if (!d?.found || d.threadCount === 0) return 'No Codex threads on this computer.'
      return `Found ${d.threadCount} threads in ${d.displayPath}. Dango reads them only after you connect.`
    },
    isOAuthClientIdError: (e: unknown) => e instanceof h.OAuthClientIdError,
    SourceRuleError: h.SourceRuleError,
    sourceRuleErrorText: (e: Error) => e.message,
  }
})
vi.mock('@/packages/undo', () => ({ pushUndo: vi.fn() }))
vi.mock('@/hooks/useScopes', () => ({
  useScopes: () => ({
    scopes: [
      { id: 'dango', name: 'Dango', kind: 'project' },
      { id: 'acme', name: 'Acme Co', kind: 'client' },
    ],
  }),
}))
vi.mock('@/hooks/knowledge-base', () => ({ useKnowledgeBases: () => ({ data: h.kbs }) }))
vi.mock('@/stores/integrationsStore', () => ({
  ensureIntegrationsStoreInit: vi.fn(async () => undefined),
  useIntegrationsStore: <T,>(selector: (s: unknown) => T) =>
    selector({ ready: true, catalog: { accounts: h.accounts } }),
}))
vi.mock('@/platform', () => ({
  default: {
    getWindowLabel: vi.fn(async () => h.windowLabel),
    openInMain: vi.fn(async () => undefined),
  },
}))
vi.mock('@/router', () => ({ router: { navigate: vi.fn(async () => undefined) } }))

import { connectSource, discardSourceDraft, pickSource, revokeSource } from '@/packages/sources'
import { pushUndo } from '@/packages/undo'
import platform from '@/platform'
import { router } from '@/router'
import AddSourceSheet, { openAddSourceSheet } from './AddSourceSheet'

const BACKGROUND_LINE =
  'Lets Dango read this source on a schedule to propose knowledge. Reading never makes anything authoritative.'

const pick = vi.mocked(pickSource)
const connect = vi.mocked(connectSource)
const discard = vi.mocked(discardSourceDraft)

const folderDraft: SourceDraft = { kind: 'folder', label: 'chaeboxi', ref: '~/Work/chaeboxi', config: {} }
const gmailDraft: SourceDraft = { kind: 'gmail', label: 'me@example.com', config: { accountId: 'a1' } }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function open(opts?: { scopeId?: string; kind?: SourceKind }) {
  render(
    <NiceModal.Provider>
      <div />
    </NiceModal.Provider>
  )
  let result!: Promise<{ sourceId: string } | null>
  act(() => {
    result = openAddSourceSheet(opts)
  })
  return result
}

const row = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) })

async function toConnectStep(draft: SourceDraft, kindName: string, opts?: { scopeId?: string }) {
  pick.mockResolvedValueOnce(draft)
  const result = open(opts)
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${kindName}`) }))
  await screen.findByRole('heading', { name: `Connect ${kindName}` })
  // Wrapped: an async function returning the promise would wait for it.
  return { result }
}

beforeEach(() => {
  NiceModal.register('add-source', AddSourceSheet)
  h.codex = { found: true, threadCount: 12, displayPath: '~/.codex/sessions' }
  h.accounts = []
  h.kbs = [{ id: 3, name: 'Handbook' }]
  h.windowLabel = 'main'
  for (const k of Object.keys(h.available)) h.available[k] = true
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('AddSourceSheet', () => {
  it('lists the six options in order', async () => {
    open()
    await screen.findByRole('heading', { name: 'Add a source' })
    const names = screen
      .getAllByRole('button')
      .map((b) => b.getAttribute('data-kind'))
      .filter(Boolean)
    expect(names).toEqual(['folder', 'gmail', 'asana', 'codex-threads', 'documents', 'mcp'])
    expect(row('Folder').textContent).toContain('A folder on this computer. Dango reads the files in it.')
    expect(row('MCP server').textContent).toContain('Advanced')
    expect(row('MCP server').textContent).toContain('Tools and data from an MCP server. Set up in Advanced.')
  })

  it('disables unavailable kinds with their hint', async () => {
    h.available.gmail = false
    open()
    const gmail = await screen.findByRole('button', { name: /^Gmail/ })
    expect((gmail as HTMLButtonElement).disabled).toBe(true)
    expect(gmail.textContent).toContain('Needs the desktop app.')
  })

  it('preselects the scope it was opened from', async () => {
    await toConnectStep(gmailDraft, 'Gmail', { scopeId: 'acme' })
    expect((screen.getByLabelText('Scope') as HTMLSelectElement).value).toBe('acme')
  })

  it('offers Everywhere first and preselects it without a scope', async () => {
    await toConnectStep(gmailDraft, 'Gmail')
    const select = screen.getByLabelText('Scope') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Everywhere', 'Dango', 'Acme Co'])
    expect(select.value).toBe('everywhere')
  })

  it('folder hides Everywhere from the scope list', async () => {
    await toConnectStep(folderDraft, 'Folder', { scopeId: 'everywhere' })
    const select = screen.getByLabelText('Scope') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['dango', 'acme'])
    expect(select.value).toBe('dango')
  })

  it('background review is off by default and shows the line', async () => {
    await toConnectStep(gmailDraft, 'Gmail')
    const toggle = screen.getByRole('switch', { name: 'Background review' })
    expect(toggle.className).toBe('dg-switch')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    const hint = screen.getByText(BACKGROUND_LINE)
    expect(hint.className).toBe('dg-sheet__hint')
  })

  it('documents has no background review', async () => {
    const result = open()
    fireEvent.click(await screen.findByRole('button', { name: /^Documents/ }))
    pick.mockResolvedValueOnce({ kind: 'documents', label: 'Handbook', config: { kbId: 3 } })
    fireEvent.click(screen.getByRole('button', { name: 'Handbook' }))
    await screen.findByRole('heading', { name: 'Connect Documents' })
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByText(BACKGROUND_LINE)).toBeNull()
    void result
  })

  it('cancel during sign-in aborts', async () => {
    const pending = deferred<SourceDraft | null>()
    pick.mockReturnValueOnce(pending.promise)
    const result = open()
    fireEvent.click(await screen.findByRole('button', { name: /^Gmail/ }))
    await screen.findByText('Waiting for the browser…')
    const signal = pick.mock.calls[0][1]?.signal as AbortSignal
    expect(pick.mock.calls[0][0]).toBe('gmail')
    expect(signal.aborted).toBe(false)
    // Only Cancel while the browser is open.
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Cancel'])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(signal.aborted).toBe(true)
    await expect(result).resolves.toBeNull()
    pending.resolve(null)
    await Promise.resolve()
    expect(connect).not.toHaveBeenCalled()
  })

  it('a folder pick shows where to choose', async () => {
    pick.mockReturnValueOnce(new Promise(() => {}))
    open()
    fireEvent.click(await screen.findByRole('button', { name: /^Folder/ }))
    await screen.findByText('Choose a folder in the window that opened.')
  })

  it('Esc during a pick aborts like Cancel', async () => {
    pick.mockReturnValueOnce(new Promise(() => {}))
    const result = open()
    fireEvent.click(await screen.findByRole('button', { name: /^Folder/ }))
    await screen.findByText('Choose a folder in the window that opened.')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect((pick.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true)
    await expect(result).resolves.toBeNull()
  })

  it('a draft that arrives after cancel is discarded', async () => {
    const pending = deferred<SourceDraft | null>()
    pick.mockReturnValueOnce(pending.promise)
    const result = open()
    fireEvent.click(await screen.findByRole('button', { name: /^Folder/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await expect(result).resolves.toBeNull()
    await act(async () => pending.resolve(folderDraft))
    expect(discard).toHaveBeenCalledWith(folderDraft)
    expect(connect).not.toHaveBeenCalled()
  })

  it('a null draft returns to the picker', async () => {
    pick.mockResolvedValueOnce(null)
    open()
    fireEvent.click(await screen.findByRole('button', { name: /^Folder/ }))
    await screen.findByRole('heading', { name: 'Add a source' })
    expect(await screen.findByRole('button', { name: /^Gmail/ })).toBeTruthy()
  })

  it('cancel after pick discards the draft', async () => {
    const { result } = await toConnectStep(folderDraft, 'Folder')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await expect(result).resolves.toBeNull()
    expect(discard).toHaveBeenCalledTimes(1)
    expect(discard).toHaveBeenCalledWith(folderDraft)
    expect(connect).not.toHaveBeenCalled()
  })

  it('Esc after pick discards the draft', async () => {
    const { result } = await toConnectStep(folderDraft, 'Folder')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await expect(result).resolves.toBeNull()
    expect(discard).toHaveBeenCalledTimes(1)
  })

  it('connect passes scope and switch, then pushes an undo', async () => {
    connect.mockResolvedValueOnce({ sourceId: 's1', jobId: 'j1' })
    const { result } = await toConnectStep(folderDraft, 'Folder', { scopeId: 'dango' })
    expect(screen.getByText('chaeboxi')).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: 'Background review' }))
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await expect(result).resolves.toEqual({ sourceId: 's1' })
    expect(connect).toHaveBeenCalledWith(folderDraft, { scopeId: 'dango', backgroundReview: true })
    expect(pushUndo).toHaveBeenCalledTimes(1)
    const input = vi.mocked(pushUndo).mock.calls[0][0]
    expect(input.message).toBe('Connected chaeboxi to Dango')
    expect(input.group).toBe('other')
    await input.undo()
    expect(revokeSource).toHaveBeenCalledWith('s1')
    expect(discard).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('connecting to Everywhere names Everywhere in the undo', async () => {
    connect.mockResolvedValueOnce({ sourceId: 's2' })
    const { result } = await toConnectStep(gmailDraft, 'Gmail')
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await result
    expect(connect).toHaveBeenCalledWith(gmailDraft, { scopeId: 'everywhere', backgroundReview: false })
    expect(vi.mocked(pushUndo).mock.calls[0][0].message).toBe('Connected me@example.com to Everywhere')
  })

  it('a scope rule error shows its copy and returns to the picker', async () => {
    connect.mockRejectedValueOnce(new h.SourceRuleError('folder-taken'))
    await toConnectStep(folderDraft, 'Folder', { scopeId: 'dango' })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByText('This scope already has a folder.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Add a source' })).toBeTruthy()
    expect(pushUndo).not.toHaveBeenCalled()
  })

  it('another connect error stays on the step, and Cancel then discards', async () => {
    connect.mockRejectedValueOnce(new Error('Disk full'))
    const { result } = await toConnectStep(folderDraft, 'Folder', { scopeId: 'dango' })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByText('Disk full')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Connect Folder' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await expect(result).resolves.toBeNull()
    expect(discard).toHaveBeenCalledWith(folderDraft)
  })

  it('a connect error that discarded the draft returns to the picker', async () => {
    connect.mockRejectedValueOnce(Object.assign(new Error('Sources could not be read'), { discarded: true }))
    await toConnectStep(folderDraft, 'Folder', { scopeId: 'dango' })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByText('Sources could not be read')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Add a source' })).toBeTruthy()
  })

  it('undo of a connect that signed in to a new account removes that account too', async () => {
    const created: SourceDraft = { ...gmailDraft, createdAccountId: 'a-new' }
    connect.mockResolvedValueOnce({ sourceId: 's3' })
    const { result } = await toConnectStep(created, 'Gmail')
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await result
    await vi.mocked(pushUndo).mock.calls[0][0].undo()
    expect(revokeSource).toHaveBeenCalledWith('s3')
    expect(discard).toHaveBeenCalledWith(created)
    expect(vi.mocked(revokeSource).mock.invocationCallOrder[0]).toBeLessThan(discard.mock.invocationCallOrder[0])
  })

  it('the client-ID error offers Open Integrations', async () => {
    pick.mockRejectedValueOnce(new h.OAuthClientIdError())
    const result = open()
    fireEvent.click(await screen.findByRole('button', { name: /^Gmail/ }))
    expect(await screen.findByText('Add an OAuth client ID in Integrations.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open Integrations' }))
    await expect(result).resolves.toBeNull()
    await waitFor(() => expect(router.navigate).toHaveBeenCalledWith({ to: '/settings/integrations' }))
  })

  it('Codex threads shows the detected count', async () => {
    pick.mockResolvedValueOnce({ kind: 'codex-threads', label: 'Codex threads', config: {} })
    open()
    const codex = await screen.findByRole('button', { name: /^Codex threads/ })
    expect(codex.textContent).toContain(
      'Found 12 threads in ~/.codex/sessions. Dango reads them only after you connect.'
    )
    expect((codex as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(codex)
    await screen.findByRole('heading', { name: 'Connect Codex threads' })
  })

  it('Codex threads is disabled while looking, without saying none were found', async () => {
    h.codex = undefined
    open()
    const codex = await screen.findByRole('button', { name: /^Codex threads/ })
    expect((codex as HTMLButtonElement).disabled).toBe(true)
    expect(codex.textContent).toContain('Looking for Codex threads…')
    expect(codex.textContent).not.toContain('No Codex threads on this computer.')
  })

  it('Codex threads is disabled when none were found', async () => {
    h.codex = { found: false, threadCount: 0, displayPath: '~/.codex/sessions' }
    open()
    const codex = await screen.findByRole('button', { name: /^Codex threads/ })
    expect((codex as HTMLButtonElement).disabled).toBe(true)
    expect(codex.textContent).toContain('No Codex threads on this computer.')
  })

  it('Gmail with an account offers it and another account', async () => {
    h.accounts = [
      { id: 'a1', connectorId: 'google_workspace', label: 'Work', accountHint: 'me@example.com', status: 'active' },
      { id: 'a2', connectorId: 'google_workspace', label: 'Old', accountHint: 'old@example.com', status: 'revoked' },
      { id: 'a3', connectorId: 'asana', label: 'Asana', accountHint: 'me@asana', status: 'active' },
    ]
    pick.mockResolvedValueOnce(gmailDraft)
    open()
    fireEvent.click(await screen.findByRole('button', { name: /^Gmail/ }))
    expect(pick).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Use old@example.com' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Use me@asana' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Another account' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use me@example.com' }))
    await screen.findByRole('heading', { name: 'Connect Gmail' })
    expect(pick.mock.calls[0][0]).toBe('gmail')
    expect(pick.mock.calls[0][1]?.choice).toEqual({ accountId: 'a1' })
  })

  it('Another account signs in again', async () => {
    h.accounts = [
      { id: 'a1', connectorId: 'google_workspace', label: 'Work', accountHint: 'me@example.com', status: 'active' },
    ]
    pick.mockReturnValueOnce(new Promise(() => {}))
    open()
    fireEvent.click(await screen.findByRole('button', { name: /^Gmail/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Another account' }))
    await screen.findByText('Waiting for the browser…')
    expect(pick.mock.calls[0][1]?.choice).toBeUndefined()
  })

  it('Documents asks for the collection first', async () => {
    pick.mockResolvedValueOnce({ kind: 'documents', label: 'Handbook', config: { kbId: 3 } })
    open()
    fireEvent.click(await screen.findByRole('button', { name: /^Documents/ }))
    expect(pick).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Handbook' }))
    await screen.findByRole('heading', { name: 'Connect Documents' })
    expect(pick.mock.calls[0][0]).toBe('documents')
    expect(pick.mock.calls[0][1]?.choice).toEqual({ kbId: 3 })
  })

  it('Documents without collections offers Add documents', async () => {
    h.kbs = []
    const result = open()
    fireEvent.click(await screen.findByRole('button', { name: /^Documents/ }))
    const list = screen.getByRole('group', { name: 'Documents' })
    expect(within(list).getByText('No documents yet')).toBeTruthy()
    fireEvent.click(within(list).getByRole('button', { name: 'Add documents' }))
    await expect(result).resolves.toBeNull()
    await waitFor(() => expect(router.navigate).toHaveBeenCalledWith({ to: '/settings/knowledge-base' }))
    expect(pick).not.toHaveBeenCalled()
  })

  it('MCP server opens its settings and closes', async () => {
    const result = open()
    fireEvent.click(await screen.findByRole('button', { name: /^MCP server/ }))
    await expect(result).resolves.toBeNull()
    await waitFor(() => expect(router.navigate).toHaveBeenCalledWith({ to: '/settings/mcp' }))
    expect(pick).not.toHaveBeenCalled()
  })

  it('a kind passed in starts the pick at once', async () => {
    pick.mockReturnValueOnce(new Promise(() => {}))
    open({ kind: 'folder' })
    await screen.findByText('Choose a folder in the window that opened.')
    expect(pick.mock.calls[0][0]).toBe('folder')
  })

  it('Documents passed in opens its collections instead of picking', async () => {
    open({ kind: 'documents' })
    expect(await screen.findByRole('button', { name: 'Handbook' })).toBeTruthy()
    expect(pick).not.toHaveBeenCalled()
  })

  it('in the quick window it opens Sources in the main window instead', async () => {
    h.windowLabel = 'quick'
    const result = open()
    await expect(result).resolves.toBeNull()
    expect(platform.openInMain).toHaveBeenCalledWith('/settings/sources')
    expect(router.navigate).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
