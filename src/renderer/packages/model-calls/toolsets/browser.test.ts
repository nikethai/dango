import { beforeEach, describe, expect, it, vi } from 'vitest'

const platformMock = vi.hoisted(() => ({
  type: 'desktop' as string,
  browserSessionStart: vi.fn(async () => ({ ok: true })),
  browserSessionStatus: vi.fn(async () => ({ running: false })),
  browserSessionStop: vi.fn(async () => ({ stopped: true })),
  browserNavigate: vi.fn(async () => ({ url: 'https://example.com' })),
  browserSnapshot: vi.fn(async () => ({
    url: 'https://example.com',
    title: 'Example',
    snapshot: '[e1] heading "Hi"',
  })),
  browserAct: vi.fn(async () => ({ ok: true })),
  browserTabs: vi.fn(async () => ({ tabs: [] })),
  browserScreenshot: vi.fn(async () => ({ mimeType: 'image/png', base64: 'xx' })),
}))

vi.mock('@/platform', () => ({
  default: platformMock,
}))

vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: () => ({
      getSettings: () => ({
        extension: {
          browserAgent: { enabled: true, headless: false, allowlist: [], maxStepsPerTurn: 12 },
        },
      }),
    }),
  },
}))

const uiMock = vi.hoisted(() => ({
  bySession: {} as Record<string, unknown>,
  setStatus: vi.fn(),
  patchStatus: vi.fn(),
}))

vi.mock('@/stores/browserAgentUiStore', () => ({
  browserAgentUiStore: {
    getState: () => uiMock,
  },
}))

import { clearAllBrowserLocks } from '@/packages/browser/lock'
import {
  createBrowserToolSet,
  recordBrowserToolUse,
  resetBrowserTurnState,
  shouldForceBrowserSnapshot,
  getLastBrowserTool,
  getLastBrowserObservationEmbedded,
  stopBrowserSession,
} from './browser'

type ExecTool<A = object> = { execute: (a: A) => Promise<unknown> }

function asExec<A = object>(tool: unknown): ExecTool<A> {
  return tool as ExecTool<A>
}

describe('createBrowserToolSet', () => {
  beforeEach(() => {
    clearAllBrowserLocks()
    platformMock.type = 'desktop'
    vi.clearAllMocks()
  })

  it('registers browser_* tools', () => {
    const set = createBrowserToolSet({ sessionId: 's1' })
    expect(Object.keys(set.tools).sort()).toEqual(
      [
        'browser_click',
        'browser_navigate',
        'browser_screenshot',
        'browser_scroll',
        'browser_snapshot',
        'browser_tabs',
        'browser_type',
      ].sort()
    )
  })

  it('navigate blocks file urls', async () => {
    const set = createBrowserToolSet({ sessionId: 's1' })
    const nav = asExec<{ url: string }>(set.tools.browser_navigate)
    const result = (await nav.execute({ url: 'file:///tmp/x' })) as { error?: string }
    expect(result.error).toBe('SECURITY_BLOCKED')
    expect(platformMock.browserNavigate).not.toHaveBeenCalled()
  })

  it('navigate works on https when enabled', async () => {
    const set = createBrowserToolSet({ sessionId: 's1', runId: 'r1' })
    const nav = asExec<{ url: string }>(set.tools.browser_navigate)
    await nav.execute({ url: 'https://example.com' })
    expect(platformMock.browserSessionStart).toHaveBeenCalled()
    expect(platformMock.browserNavigate).toHaveBeenCalledWith('s1', 'https://example.com/')
  })

  it('navigate attaches snapshot when host omits it', async () => {
    platformMock.browserNavigate.mockResolvedValueOnce({ url: 'https://example.com/', title: 'Example' } as never)
    const set = createBrowserToolSet({ sessionId: 's1', runId: 'r1' })
    const nav = asExec<{ url: string }>(set.tools.browser_navigate)
    const result = (await nav.execute({ url: 'https://example.com' })) as { snapshot?: string }
    expect(platformMock.browserSnapshot).toHaveBeenCalled()
    expect(result.snapshot).toContain('[e1]')
  })

  it('click returns host snapshot without extra fetch when present', async () => {
    platformMock.browserAct.mockResolvedValueOnce({
      ok: true,
      action: 'click',
      ref: 'e1',
      snapshot: '[e2] button "Next"',
      url: 'https://example.com/next',
    } as never)
    const set = createBrowserToolSet({ sessionId: 's1', runId: 'r1' })
    // Warm session so ensureSession does not fail lock
    await asExec(set.tools.browser_snapshot).execute({})
    platformMock.browserSnapshot.mockClear()
    const click = asExec<{ ref: string }>(set.tools.browser_click)
    const result = (await click.execute({ ref: 'e1' })) as { snapshot?: string; ok?: boolean }
    expect(result.ok).toBe(true)
    expect(result.snapshot).toContain('[e2]')
    expect(platformMock.browserSnapshot).not.toHaveBeenCalled()
  })

  it('click recovers snapshot on REF_INVALID payload', async () => {
    platformMock.browserAct.mockResolvedValueOnce({
      error: 'REF_INVALID',
      message: 'Invalid or stale ref: e9',
    } as never)
    const set = createBrowserToolSet({ sessionId: 's1', runId: 'r2' })
    await asExec(set.tools.browser_snapshot).execute({})
    platformMock.browserSnapshot.mockClear()
    platformMock.browserSnapshot.mockResolvedValueOnce({
      url: 'https://example.com',
      title: 'Example',
      snapshot: '[e3] link "Home"',
    } as never)
    const click = asExec<{ ref: string }>(set.tools.browser_click)
    const result = (await click.execute({ ref: 'e9' })) as {
      error?: string
      snapshot?: string
    }
    expect(result.error).toBe('REF_INVALID')
    expect(result.snapshot).toContain('[e3]')
    expect(platformMock.browserSnapshot).toHaveBeenCalled()
  })

  it('returns unsupported on web platform', async () => {
    platformMock.type = 'web'
    const set = createBrowserToolSet({ sessionId: 's1' })
    const snap = asExec(set.tools.browser_snapshot)
    const result = (await snap.execute({})) as { error?: string }
    expect(result.error).toBe('UNSUPPORTED_PLATFORM')
  })

  it('tracks last tool and force-snapshot policy', () => {
    resetBrowserTurnState('s-force')
    recordBrowserToolUse('s-force', 'browser_click', false)
    expect(getLastBrowserTool('s-force')).toBe('browser_click')
    expect(getLastBrowserObservationEmbedded('s-force')).toBe(false)
    expect(shouldForceBrowserSnapshot('browser_click', false)).toBe(true)
    expect(shouldForceBrowserSnapshot('browser_click', true)).toBe(false)
    expect(shouldForceBrowserSnapshot('browser_snapshot', false)).toBe(false)
  })

  it('restarts host when status throws (dead host recovery)', async () => {
    platformMock.browserSessionStatus.mockRejectedValueOnce(new Error('SESSION_NOT_FOUND'))
    const set = createBrowserToolSet({ sessionId: 's-dead', runId: 'r-dead' })
    const snap = asExec(set.tools.browser_snapshot)
    await snap.execute({})
    expect(platformMock.browserSessionStart).toHaveBeenCalled()
  })
})

describe('stopBrowserSession (every Stop calls it)', () => {
  beforeEach(() => {
    uiMock.bySession = {}
    uiMock.setStatus.mockClear()
  })

  it('leaves a chat that never used the browser without a status, so no browser panel opens (finding 1)', async () => {
    platformMock.browserSessionStop.mockResolvedValueOnce({ stopped: false, reason: 'not_running' } as never)
    await stopBrowserSession('chat-1')
    expect(uiMock.setStatus).not.toHaveBeenCalled()
  })

  it('records the stop when a browser was running', async () => {
    platformMock.browserSessionStop.mockResolvedValueOnce({ stopped: true })
    await stopBrowserSession('chat-1')
    expect(uiMock.setStatus).toHaveBeenCalledWith('chat-1', expect.objectContaining({ lastTool: 'session:stop' }))
  })

  it('updates a chat that already shows the browser', async () => {
    uiMock.bySession = { 'chat-1': { running: true, url: 'https://example.com', lastTool: 'navigate', error: null } }
    platformMock.browserSessionStop.mockResolvedValueOnce({ stopped: false, reason: 'not_running' } as never)
    await stopBrowserSession('chat-1')
    expect(uiMock.setStatus).toHaveBeenCalledWith('chat-1', expect.objectContaining({ running: false }))
  })
})
