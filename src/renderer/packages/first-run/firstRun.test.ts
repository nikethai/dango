import * as defaults from '@shared/defaults'
import { SettingsSchema } from '@shared/types/settings'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  state: { firstRun: undefined as unknown },
  setSettings: vi.fn(),
}))

vi.mock('@/stores/settingsStore', () => ({
  settingsStore: { getState: () => ({ ...h.state, setSettings: h.setSettings }) },
}))

import {
  type FirstRunResolution,
  firstRunFrom,
  firstRunRedirect,
  resolveFirstRun,
  setFirstRun,
  stepAfterModel,
} from './firstRun'

const show: FirstRunResolution = { show: true, step: 1, modelOnly: false }

beforeEach(() => {
  h.state.firstRun = undefined
  h.setSettings.mockReset()
})

describe('resolveFirstRun', () => {
  it('shows step 1 to a new user and nothing to an upgrading user with a model', () => {
    expect(resolveFirstRun(undefined, false)).toEqual({ show: true, step: 1, modelOnly: false })
    expect(resolveFirstRun(undefined, true)).toEqual({ show: false })
  })

  it('resumes at the saved step, or step 1 while there is no model', () => {
    const record = { step: 3, sourceSkipped: false } as const
    expect(resolveFirstRun(record, true)).toEqual({ show: true, step: 3, modelOnly: false })
    expect(resolveFirstRun(record, false)).toEqual({ show: true, step: 1, modelOnly: false })
    expect(stepAfterModel(record)).toBe(3)
    expect(stepAfterModel(undefined)).toBe(2)
  })

  it('moves a saved step 1 on once a model exists', () => {
    expect(resolveFirstRun({ step: 1, sourceSkipped: false }, true)).toEqual({ show: true, step: 2, modelOnly: false })
    expect(stepAfterModel({ step: 1, sourceSkipped: false })).toBe(2)
  })

  it('after completion shows only step 1, and only when every model is gone', () => {
    const done = { step: 4, sourceSkipped: false, completedAt: 1 } as const
    expect(resolveFirstRun(done, true)).toEqual({ show: false })
    expect(resolveFirstRun(done, false)).toEqual({ show: true, step: 1, modelOnly: true })
  })
})

describe('firstRunRedirect', () => {
  it('never redirects the quick window', () => {
    expect(firstRunRedirect('/', true, show)).toBeNull()
  })

  it('leaves first run, settings and quick paths alone', () => {
    expect(firstRunRedirect('/first-run', false, show)).toBeNull()
    expect(firstRunRedirect('/settings/provider', false, show)).toBeNull()
    expect(firstRunRedirect('/settings/provider/openai', false, show)).toBeNull()
    expect(firstRunRedirect('/settings/mcp', false, show)).toBeNull()
    expect(firstRunRedirect('/settings/knowledge-base', false, show)).toBeNull()
    expect(firstRunRedirect('/settings', false, show)).toBeNull()
    expect(firstRunRedirect('/quick', false, show)).toBeNull()
  })

  it('sends any other path to /first-run', () => {
    expect(firstRunRedirect('/', false, show)).toBe('/first-run')
    expect(firstRunRedirect('/session/abc', false, show)).toBe('/first-run')
    expect(firstRunRedirect('/settingsx', false, show)).toBe('/first-run')
  })

  it('does nothing when first run is not shown', () => {
    for (const path of ['/', '/first-run', '/session/abc', '/settings/provider']) {
      expect(firstRunRedirect(path, false, { show: false })).toBeNull()
    }
  })
})

describe('firstRunFrom', () => {
  it('keeps an in-app path and drops anything else', () => {
    expect(firstRunFrom('/session/abc')).toBe('/session/abc')
    expect(firstRunFrom('/')).toBe('/')
    expect(firstRunFrom('//evil.example')).toBeUndefined()
    expect(firstRunFrom('//evil.com')).toBeUndefined()
    expect(firstRunFrom('/\\evil.com')).toBeUndefined()
    expect(firstRunFrom('/a\\b')).toBeUndefined()
    expect(firstRunFrom('/first-run?from=/x')).toBeUndefined()
    expect(firstRunFrom('https://evil.example')).toBeUndefined()
    expect(firstRunFrom('/first-run')).toBeUndefined()
    expect(firstRunFrom(undefined)).toBeUndefined()
    expect(firstRunFrom(42)).toBeUndefined()
  })

  it('keeps the query and hash', () => {
    expect(firstRunFrom('/session/abc?thread=t1#m2')).toBe('/session/abc?thread=t1#m2')
    expect(firstRunFrom('/settings/provider?x=1')).toBe('/settings/provider?x=1')
  })

  it('after an upgrade marked completed, removing every model shows only step 1', () => {
    const upgraded = { step: 5, sourceSkipped: false, completedAt: 1 } as const
    expect(resolveFirstRun(upgraded, true)).toEqual({ show: false })
    expect(resolveFirstRun(upgraded, false)).toEqual({ show: true, step: 1, modelOnly: true })
  })
})

describe('setFirstRun', () => {
  it('starts a record at step 1 when none exists', () => {
    setFirstRun({ step: 2 })
    expect(h.setSettings).toHaveBeenCalledWith({ firstRun: { step: 2, sourceSkipped: false } })
  })

  it('merges into the saved record', () => {
    h.state.firstRun = { step: 2, sourceSkipped: false, scopeId: 's1' }
    setFirstRun({ step: 3, sourceSkipped: true })
    expect(h.setSettings).toHaveBeenCalledWith({ firstRun: { step: 3, sourceSkipped: true, scopeId: 's1' } })
  })
})

describe('SettingsSchema firstRun', () => {
  it('is undefined for old payloads and for an invalid record', () => {
    expect(SettingsSchema.parse({ ...defaults.settings() }).firstRun).toBeUndefined()
    expect(SettingsSchema.parse({ ...defaults.settings(), firstRun: { step: 9 } }).firstRun).toBeUndefined()
  })

  it('keeps a valid record and defaults sourceSkipped', () => {
    expect(SettingsSchema.parse({ ...defaults.settings(), firstRun: { step: 3, scopeId: 's1' } }).firstRun).toEqual({
      step: 3,
      sourceSkipped: false,
      scopeId: 's1',
    })
  })
})
