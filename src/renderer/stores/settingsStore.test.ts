import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  stored: null as unknown,
  ensureShortcutConfig: vi.fn(async () => undefined),
}))

vi.mock('@/platform', () => ({
  default: {
    ensureShortcutConfig: h.ensureShortcutConfig,
    ensureProxyConfig: vi.fn(async () => undefined),
    ensureAutoLaunch: vi.fn(async () => undefined),
  },
  platformCapabilities: { supportsDesktopOnlySettings: true },
}))
vi.mock('@/storage', () => ({
  default: {
    getItem: vi.fn(async () => h.stored),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}))

import { settingsStore } from './settingsStore'

afterEach(() => {
  h.ensureShortcutConfig.mockClear()
})

describe('settingsStore shortcut sync', () => {
  it('re-reading the same shortcuts (a rehydrate in another window) does not re-register them', async () => {
    const shortcuts = settingsStore.getState().shortcuts
    h.stored = { ...settingsStore.getState().getSettings(), shortcuts: structuredClone(shortcuts), __version: 2 }
    await settingsStore.persist.rehydrate()
    expect(settingsStore.getState().shortcuts).not.toBe(shortcuts)
    expect(h.ensureShortcutConfig).not.toHaveBeenCalled()
  })

  it('changed shortcuts are registered', () => {
    const shortcuts = settingsStore.getState().shortcuts
    settingsStore.getState().setSettings({ shortcuts: { ...shortcuts, quickToggle: 'Alt+Q' } as typeof shortcuts })
    expect(h.ensureShortcutConfig).toHaveBeenCalledTimes(1)
  })
})
