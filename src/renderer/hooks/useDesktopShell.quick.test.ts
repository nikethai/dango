/**
 * @vitest-environment jsdom
 */

import { act, cleanup, renderHook } from '@testing-library/react'
import { getDefaultStore } from 'jotai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler<T> = (payload: T) => void | Promise<void>

const shell = vi.hoisted(() => ({
  label: 'quick',
  pathname: '/quick',
  screenshot: undefined as Handler<unknown> | undefined,
  clipboard: undefined as Handler<unknown> | undefined,
  navigate: undefined as Handler<string> | undefined,
  blobs: new Map<string, string>(),
  navigations: [] as unknown[],
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/platform', () => ({
  default: {
    type: 'desktop',
    ensureShortcutConfig: vi.fn(async () => {}),
    getWindowLabel: vi.fn(async () => shell.label),
    onScreenshotCaptured: (cb: Handler<unknown>) => {
      shell.screenshot = cb
      return () => {}
    },
    onClipboardCaptured: (cb: Handler<unknown>) => {
      shell.clipboard = cb
      return () => {}
    },
    onNavigate: (cb: Handler<string>) => {
      shell.navigate = cb
      return () => {}
    },
  },
}))

vi.mock('@/router', () => ({
  router: {
    state: {
      get location() {
        return { pathname: shell.pathname }
      },
    },
    navigate: vi.fn((opts: unknown) => {
      shell.navigations.push(opts)
      return Promise.resolve()
    }),
  },
}))

vi.mock('@/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage')>()
  return {
    ...actual,
    default: {
      ...actual.default,
      setBlob: vi.fn((key: string, value: string) => {
        shell.blobs.set(key, value)
        return Promise.resolve()
      }),
    },
  }
})

vi.mock('@/stores/chatStore', () => ({
  invalidateAndRefetchSession: vi.fn(async () => {}),
  listSessionsMeta: vi.fn(async () => []),
}))

vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: () => ({ shortcuts: {}, keepInTray: true, quickWindowAlwaysOnTop: true, setSettings: () => {} }),
  },
}))

vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}))

const { useDesktopShell } = await import('./useDesktopShell')
const atoms = await import('@/stores/atoms')

function emptyCapture() {
  return { text: null, pictureKeys: [] as string[] }
}

describe('useDesktopShell in the quick window', () => {
  beforeEach(() => {
    shell.label = 'quick'
    shell.pathname = '/quick'
    shell.screenshot = undefined
    shell.clipboard = undefined
    shell.navigate = undefined
    shell.blobs.clear()
    shell.navigations = []
    getDefaultStore().set(atoms.quickPendingCaptureAtom, emptyCapture())
    localStorage.setItem('_currentSessionIdCachedAtom', JSON.stringify('s1'))
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('routes a screenshot to quickPendingCaptureAtom, not the composer', async () => {
    renderHook(() => useDesktopShell())
    const before = getDefaultStore().get(atoms.inputBoxPreConstructedMessageFamily('s1'))
    await act(async () => {
      await shell.screenshot?.({ base64: 'AAAA', mimeType: 'image/png', fileName: 'shot.png' })
    })
    const capture = getDefaultStore().get(atoms.quickPendingCaptureAtom)
    expect(capture.pictureKeys).toHaveLength(1)
    expect(shell.blobs.get(capture.pictureKeys[0])).toBe('data:image/png;base64,AAAA')
    expect(capture.text).toBeNull()
    expect(getDefaultStore().get(atoms.inputBoxPreConstructedMessageFamily('s1'))).toBe(before)
    expect(getDefaultStore().get(atoms.inputBoxPreConstructedMessageFamily('new'))).toEqual(
      expect.objectContaining({ pictureKeys: [] })
    )
  })

  it('routes clipboard text to quickPendingCaptureAtom.text', async () => {
    renderHook(() => useDesktopShell())
    const before = getDefaultStore().get(atoms.inputBoxPreConstructedMessageFamily('s1'))
    await act(async () => {
      await shell.clipboard?.({ type: 'text', text: 'hello from clipboard' })
    })
    const capture = getDefaultStore().get(atoms.quickPendingCaptureAtom)
    expect(capture.text).toBe('hello from clipboard')
    expect(capture.pictureKeys).toEqual([])
    expect(getDefaultStore().get(atoms.inputBoxPreConstructedMessageFamily('s1'))).toBe(before)
    expect(getDefaultStore().get(atoms.inputBoxPrefillTextFamily('s1'))).toBeNull()
  })

  it('keeps at most 8 picture keys', async () => {
    renderHook(() => useDesktopShell())
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        await shell.screenshot?.({ base64: `img${i}`, mimeType: 'image/png', fileName: `${i}.png` })
      })
    }
    expect(getDefaultStore().get(atoms.quickPendingCaptureAtom).pictureKeys).toHaveLength(8)
  })

  it('ignores navigate-to in the quick window', async () => {
    renderHook(() => useDesktopShell())
    shell.navigations = []
    await act(async () => {
      await shell.navigate?.('/')
    })
    expect(shell.navigations).toEqual([])
  })

  it('main window ignores screenshots, which are always meant for the quick window', async () => {
    shell.label = 'main'
    shell.pathname = '/'
    renderHook(() => useDesktopShell())
    shell.navigations = []
    const before = getDefaultStore().get(atoms.inputBoxPreConstructedMessageFamily('s1'))
    await act(async () => {
      await shell.screenshot?.({ base64: 'BBBB', mimeType: 'image/png', fileName: 'main.png' })
    })
    // Main stays on Review and no composer gets the picture.
    expect(shell.navigations).toEqual([])
    expect(shell.blobs.size).toBe(0)
    expect(getDefaultStore().get(atoms.inputBoxPreConstructedMessageFamily('s1'))).toBe(before)
    expect(getDefaultStore().get(atoms.inputBoxPreConstructedMessageFamily('new')).pictureKeys ?? []).toEqual([])
    expect(getDefaultStore().get(atoms.quickPendingCaptureAtom).pictureKeys).toEqual([])
  })

  it('routes a clipboard image to the quick panel and keeps the newest 8', async () => {
    renderHook(() => useDesktopShell())
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        await shell.clipboard?.({ type: 'image', base64: `clip${i}`, mimeType: 'image/png', fileName: `${i}.png` })
      })
    }
    const capture = getDefaultStore().get(atoms.quickPendingCaptureAtom)
    expect(capture.text).toBeNull()
    expect(capture.pictureKeys).toHaveLength(8)
    expect(capture.pictureKeys.map((key) => shell.blobs.get(key))).toEqual(
      [2, 3, 4, 5, 6, 7, 8, 9].map((i) => `data:image/png;base64,clip${i}`)
    )
  })

  it('a navigate-to whose window label cannot be read does nothing and does not throw', async () => {
    shell.label = 'main'
    renderHook(() => useDesktopShell())
    shell.navigations = []
    const { default: platform } = await import('@/platform')
    const getWindowLabel = platform.getWindowLabel as ReturnType<typeof vi.fn>
    getWindowLabel.mockRejectedValueOnce(new Error('gone'))
    await act(async () => {
      await expect(shell.navigate?.('/')).resolves.toBeUndefined()
    })
    expect(shell.navigations).toEqual([])
  })

  it('main window still follows navigate-to', async () => {
    shell.label = 'main'
    shell.pathname = '/session/s1'
    renderHook(() => useDesktopShell())
    shell.navigations = []
    await act(async () => {
      await shell.navigate?.('/')
    })
    expect(shell.navigations).toEqual([{ to: '/' }])
  })

  it('main window opens provider settings sent by the quick window, and rejects other paths', async () => {
    shell.label = 'main'
    shell.pathname = '/'
    renderHook(() => useDesktopShell())
    shell.navigations = []
    await act(async () => {
      await shell.navigate?.('/settings/provider')
      await shell.navigate?.('https://example.com')
      await shell.navigate?.('/admin')
    })
    expect(shell.navigations).toEqual([{ to: '/settings/provider' }])
  })
})
