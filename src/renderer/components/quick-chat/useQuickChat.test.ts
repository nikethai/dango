/**
 * @vitest-environment jsdom
 */

import type { Message, Session } from '@shared/types'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { getDefaultStore } from 'jotai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  sessions: new Map<string, Session>(),
  created: 0,
  providers: [] as unknown[],
  scopes: [] as { id: string; name: string }[],
  caps: { supportsDesktopOnlySettings: true },
  shown: undefined as undefined | (() => void),
  platform: null as null | {
    quickHidden: number
    quickWindowHeights: number[]
    openedInMain: string[]
    openInMain: (path: string) => Promise<void>
    showMainWindow?: () => Promise<void>
    openSessionInMain?: (id: string) => Promise<void>
    onQuickShown?: (cb: () => void) => () => void
  },
}))

vi.mock('@/platform', async () => {
  const { default: TestPlatform } = await import('@/platform/test_platform')
  const platform = new TestPlatform()
  h.platform = platform
  return { default: platform, platformCapabilities: h.caps }
})
vi.mock('@/stores/chatStore', () => ({
  createSession: vi.fn((session: Omit<Session, 'id'>) => {
    h.created += 1
    const created = { ...session, id: `chat-${h.created}` } as Session
    h.sessions.set(created.id, created)
    return Promise.resolve(created)
  }),
  broadcastSessionChanged: vi.fn(async () => undefined),
  invalidateAndRefetchSession: vi.fn(async () => undefined),
  listSessionsMeta: vi.fn(async () => Array.from(h.sessions.values()).map((s) => ({ id: s.id, name: s.name }))),
  useSession: (id: string | null) => ({ session: id ? h.sessions.get(id) : undefined }),
}))
vi.mock('@/stores/sessionActions', () => ({
  submitNewUserMessage: vi.fn(async () => undefined),
  regenerateInNewFork: vi.fn(async () => undefined),
}))
vi.mock('@/stores/session/stop-generation', () => ({ stopSessionGeneration: vi.fn() }))
vi.mock('@/stores/sessionHelpers', () => ({
  initEmptyChatSession: () => ({ name: 'Untitled', type: 'chat', messages: [], settings: {} }),
  getAllMessageList: (session: Session) => session.messages,
}))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (select: (s: Record<string, unknown>) => unknown) => select({}),
}))
vi.mock('@/hooks/useProviders', () => ({ useProviders: () => ({ providers: h.providers }) }))
vi.mock('@/hooks/useScopes', () => ({ useScopes: () => ({ scopes: h.scopes }) }))
vi.mock('@/router', () => ({ router: { navigate: vi.fn() } }))
vi.mock('@/modals/Settings', () => ({ navigateToSettings: vi.fn() }))

import { navigateToSettings } from '@/modals/Settings'
import { router } from '@/router'
import { quickPendingCaptureAtom } from '@/stores/atoms'
import * as chatStore from '@/stores/chatStore'
import { lastUsedModelStore } from '@/stores/lastUsedModelStore'
import { stopSessionGeneration } from '@/stores/session/stop-generation'
import * as sessionActions from '@/stores/sessionActions'
import { QUICK_SESSION_STORAGE_KEY } from '@/utils/quickSession'
import { useQuickChat } from './useQuickChat'

const openai = {
  id: 'openai',
  name: 'OpenAI',
  type: 'openai',
  apiHost: 'https://api.openai.com',
  models: [{ modelId: 'gpt-4o' }],
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online })
}

function message(role: 'user' | 'assistant', text: string, extra: Partial<Message> = {}): Message {
  return { id: `${role}-${text}`, role, contentParts: [{ type: 'text', text }], timestamp: 1, ...extra }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.sessions.clear()
  h.created = 0
  h.providers = [openai]
  h.scopes = [
    { id: 'acme', name: 'Acme Co' },
    { id: 'dango', name: 'Dango app' },
  ]
  if (h.platform) {
    h.platform.quickHidden = 0
    h.platform.quickWindowHeights = []
    h.platform.openedInMain = []
    h.platform.showMainWindow = vi.fn(() => Promise.resolve())
    h.platform.openSessionInMain = vi.fn(() => Promise.resolve())
    h.platform.onQuickShown = (cb) => {
      h.shown = cb
      return () => {
        h.shown = undefined
      }
    }
    // Back to the TestPlatform's recording method.
    delete (h.platform as { openInMain?: unknown }).openInMain
  }
  h.caps.supportsDesktopOnlySettings = true
  setOnline(true)
  localStorage.clear()
  lastUsedModelStore.getState().setChatModel('openai', 'gpt-4o')
  getDefaultStore().set(quickPendingCaptureAtom, { text: null, pictureKeys: [] })
})

afterEach(() => {
  cleanup()
})

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function renderQuick() {
  const view = renderHook(() => useQuickChat())
  // Let the snapshot load settle.
  await act(async () => {
    await Promise.resolve()
  })
  return view
}

async function ask(result: { current: ReturnType<typeof useQuickChat> }, question: string) {
  act(() => result.current.onQuestionChange(question))
  await act(async () => {
    result.current.onSubmit()
    await flush()
  })
}

describe('useQuickChat', () => {
  it('no chat until the first send', async () => {
    const { result } = await renderQuick()
    act(() => result.current.onScopeChange('acme'))
    act(() => result.current.onQuestionChange('What did we'))
    expect(chatStore.createSession).not.toHaveBeenCalled()

    await ask(result, 'What did we promise Acme?\nthanks')

    expect(chatStore.createSession).toHaveBeenCalledTimes(1)
    expect(chatStore.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'What did we promise Acme?',
        projectId: 'acme',
        settings: expect.objectContaining({ provider: 'openai', modelId: 'gpt-4o' }),
      })
    )
    // The hidden main window lists the new chat at once.
    expect(chatStore.broadcastSessionChanged).toHaveBeenCalledWith('chat-1')
    expect(sessionActions.submitNewUserMessage).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({ needGenerating: true })
    )
    expect(JSON.parse(localStorage.getItem(QUICK_SESSION_STORAGE_KEY) ?? 'null')).toMatchObject({
      sessionId: 'chat-1',
      lastScopeId: 'acme',
    })
  })

  it('Esc keeps the chat and the stream', async () => {
    const { result } = await renderQuick()
    await ask(result, 'Hello')
    act(() => result.current.onEsc())
    expect(h.platform?.quickHidden).toBe(1)
    expect(stopSessionGeneration).not.toHaveBeenCalled()
  })

  it('reopen within three minutes shows the same chat', async () => {
    h.sessions.set('old', {
      id: 'old',
      name: 'Old',
      messages: [message('user', 'Earlier question'), message('assistant', 'Earlier answer')],
      settings: { provider: 'openai', modelId: 'gpt-4o' },
    } as Session)
    localStorage.setItem(
      QUICK_SESSION_STORAGE_KEY,
      JSON.stringify({ sessionId: 'old', lastOpenedAt: Date.now() - 2 * 60_000, lastScopeId: 'acme' })
    )
    const recent = await renderQuick()
    await waitFor(() => expect(recent.result.current.view).toBe('answered'))
    expect(recent.result.current.askedQuestion).toBe('Earlier question')
    expect(recent.result.current.answer?.id).toBe('assistant-Earlier answer')
    recent.unmount()

    localStorage.setItem(
      QUICK_SESSION_STORAGE_KEY,
      JSON.stringify({ sessionId: 'old', lastOpenedAt: Date.now() - 4 * 60_000, lastScopeId: 'acme' })
    )
    const stale = await renderQuick()
    await waitFor(() => expect(stale.result.current.scopeId).toBe('acme'))
    expect(stale.result.current.view).toBe('empty')
    expect(stale.result.current.answer).toBeUndefined()
  })

  it('scope change starts a new chat', async () => {
    const { result } = await renderQuick()
    act(() => result.current.onScopeChange('acme'))
    await ask(result, 'First')
    act(() => result.current.onScopeChange(null))
    await ask(result, 'Second')

    expect(chatStore.createSession).toHaveBeenCalledTimes(2)
    const second = vi.mocked(chatStore.createSession).mock.calls[1][0]
    expect(second.projectId).toBeUndefined()
  })

  it('a follow-up in the same scope stays in the same chat', async () => {
    const { result } = await renderQuick()
    await ask(result, 'First')
    await ask(result, 'Second')
    expect(chatStore.createSession).toHaveBeenCalledTimes(1)
    expect(sessionActions.submitNewUserMessage).toHaveBeenCalledTimes(2)
  })

  it('offline remote model', async () => {
    setOnline(false)
    const { result } = await renderQuick()
    expect(result.current.view).toBe('offline')
    await ask(result, 'Anything')
    expect(chatStore.createSession).not.toHaveBeenCalled()
    expect(sessionActions.submitNewUserMessage).not.toHaveBeenCalled()
  })

  it('a pending capture prefills the question and its pictures go with the first send', async () => {
    getDefaultStore().set(quickPendingCaptureAtom, { text: 'Clipboard words', pictureKeys: ['picture:1'] })
    const { result } = await renderQuick()
    expect(result.current.question).toBe('Clipboard words')
    expect(result.current.pictureCount).toBe(1)
    await act(async () => {
      result.current.onSubmit()
      await flush()
    })
    const sent = vi.mocked(sessionActions.submitNewUserMessage).mock.calls[0][1].newUserMsg
    expect(sent.contentParts).toEqual([
      { type: 'text', text: 'Clipboard words' },
      { type: 'image', storageKey: 'picture:1' },
    ])
    expect(getDefaultStore().get(quickPendingCaptureAtom)).toEqual({ text: null, pictureKeys: [] })
  })

  it('Sign in opens provider settings in the main window', async () => {
    h.providers = []
    const { result } = await renderQuick()
    expect(result.current.view).toBe('no-model')
    await act(async () => {
      result.current.onSignIn()
      await flush()
    })
    expect(h.platform?.openedInMain).toEqual(['/settings/provider'])
  })

  it('Retry regenerates an errored answer with a short error line', async () => {
    h.sessions.set('old', {
      id: 'old',
      name: 'Old',
      messages: [
        message('user', 'Q'),
        message('assistant', '', { error: '429 Too Many Requests: {"error":{"code":"rate_limit_exceeded"}}' }),
      ],
      settings: { provider: 'openai', modelId: 'gpt-4o' },
    } as Session)
    localStorage.setItem(
      QUICK_SESSION_STORAGE_KEY,
      JSON.stringify({ sessionId: 'old', lastOpenedAt: Date.now() - 1000, lastScopeId: null })
    )
    const { result } = await renderQuick()
    await waitFor(() => expect(result.current.view).toBe('answered'))
    expect(result.current.answer?.error).not.toContain('{')
    await act(async () => {
      result.current.onRetry()
      await flush()
    })
    expect(sessionActions.regenerateInNewFork).toHaveBeenCalledWith(
      'old',
      expect.objectContaining({ id: 'assistant-' })
    )
  })

  it('Continue in Chat hands the chat to the main window', async () => {
    const { result } = await renderQuick()
    await ask(result, 'Hello')
    vi.mocked(chatStore.broadcastSessionChanged).mockClear()
    const openSessionInMain = h.platform?.openSessionInMain
    await act(async () => {
      result.current.onContinue()
      await flush()
    })
    expect(chatStore.broadcastSessionChanged).toHaveBeenCalledWith('chat-1')
    expect(openSessionInMain).toHaveBeenCalledWith('chat-1')
  })

  it('without a desktop shell, Sign in and Continue in Chat stay in this window', async () => {
    h.caps.supportsDesktopOnlySettings = false
    const { result } = await renderQuick()
    await act(async () => {
      result.current.onSignIn()
      await flush()
    })
    expect(h.platform?.openedInMain).toEqual([])
    expect(h.platform?.showMainWindow).not.toHaveBeenCalled()
    expect(navigateToSettings).toHaveBeenCalledWith('/provider')

    await ask(result, 'Hello')
    await act(async () => {
      result.current.onContinue()
      await flush()
    })
    expect(h.platform?.openSessionInMain).not.toHaveBeenCalled()
    expect(router.navigate).toHaveBeenCalledWith({ to: '/session/$sessionId', params: { sessionId: 'chat-1' } })
  })

  it('a failing openInMain falls back to Settings in this window', async () => {
    if (h.platform) h.platform.openInMain = vi.fn(() => Promise.reject(new Error('no shell')))
    const { result } = await renderQuick()
    await act(async () => {
      result.current.onSignIn()
      await flush()
    })
    expect(h.platform?.openInMain).toHaveBeenCalledWith('/settings/provider')
    expect(navigateToSettings).toHaveBeenCalledWith('/provider')
    expect(h.platform?.showMainWindow).not.toHaveBeenCalled()
  })

  it('Esc without a desktop shell goes to /', async () => {
    h.caps.supportsDesktopOnlySettings = false
    const { result } = await renderQuick()
    act(() => result.current.onEsc())
    expect(h.platform?.quickHidden).toBe(0)
    expect(router.navigate).toHaveBeenCalledWith({ to: '/' })
  })

  it('removes the online and offline listeners on unmount', async () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const view = await renderQuick()
    view.unmount()
    const removed = remove.mock.calls.map(([type]) => type)
    expect(removed).toEqual(expect.arrayContaining(['online', 'offline']))
    remove.mockRestore()
  })

  it('leaving the window refreshes lastOpenedAt, so a long read keeps the chat', async () => {
    const { result } = await renderQuick()
    await ask(result, 'Hello')
    const old = Date.now() - 10 * 60_000
    const stamp = () => JSON.parse(localStorage.getItem(QUICK_SESSION_STORAGE_KEY) ?? 'null')
    localStorage.setItem(
      QUICK_SESSION_STORAGE_KEY,
      JSON.stringify({ sessionId: 'chat-1', lastOpenedAt: old, lastScopeId: null })
    )
    act(() => result.current.onEsc())
    expect(stamp().lastOpenedAt).toBeGreaterThan(old)

    localStorage.setItem(
      QUICK_SESSION_STORAGE_KEY,
      JSON.stringify({ sessionId: 'chat-1', lastOpenedAt: old, lastScopeId: null })
    )
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    expect(stamp()).toMatchObject({ sessionId: 'chat-1' })
    expect(stamp().lastOpenedAt).toBeGreaterThan(old)
  })

  it('sends a picture-only capture', async () => {
    getDefaultStore().set(quickPendingCaptureAtom, { text: null, pictureKeys: ['picture:9'] })
    const { result } = await renderQuick()
    await act(async () => {
      result.current.onSubmit()
      await flush()
    })
    expect(chatStore.createSession).toHaveBeenCalledWith(expect.objectContaining({ name: 'Untitled' }))
    const sent = vi.mocked(sessionActions.submitNewUserMessage).mock.calls[0][1].newUserMsg
    expect(sent.contentParts).toEqual([{ type: 'image', storageKey: 'picture:9' }])
  })

  it('gives the question and pictures back when sending fails', async () => {
    vi.mocked(sessionActions.submitNewUserMessage).mockRejectedValueOnce(new Error('boom'))
    getDefaultStore().set(quickPendingCaptureAtom, { text: null, pictureKeys: ['picture:2'] })
    const { result } = await renderQuick()
    await ask(result, 'Keep me')
    expect(result.current.question).toBe('Keep me')
    expect(getDefaultStore().get(quickPendingCaptureAtom).pictureKeys).toEqual(['picture:2'])
  })

  it('reopening a recent chat leaves the rewrite view', async () => {
    const { result } = await renderQuick()
    await ask(result, 'Hello')
    act(() => result.current.onRewrite('shorter', 'Some text'))
    expect(result.current.view).toBe('rewrite')
    await act(async () => {
      h.shown?.()
      await flush()
    })
    expect(result.current.view).toBe('answered')
    expect(result.current.rewrite).toBeNull()
  })
})
