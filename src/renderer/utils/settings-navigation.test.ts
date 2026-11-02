import { describe, expect, it, vi } from 'vitest'
import {
  getSettingsParentPath,
  resolveSettingsEntryPath,
  resolveSettingsExit,
  resolveSettingsExitTarget,
  settingsOpenerHref,
} from './settings-navigation'

describe('getSettingsParentPath', () => {
  it('returns null at settings root', () => {
    expect(getSettingsParentPath('/settings')).toBeNull()
    expect(getSettingsParentPath('/settings/')).toBeNull()
  })

  it('returns settings root for first-level pages', () => {
    expect(getSettingsParentPath('/settings/provider')).toBe('/settings')
    expect(getSettingsParentPath('/settings/general')).toBe('/settings')
    expect(getSettingsParentPath('/settings/chat')).toBe('/settings')
  })

  it('returns parent for nested provider pages', () => {
    expect(getSettingsParentPath('/settings/provider/openai')).toBe('/settings/provider')
    expect(getSettingsParentPath('/settings/provider/custom-id')).toBe('/settings/provider')
  })

  it('returns null for non-settings paths', () => {
    expect(getSettingsParentPath('/')).toBeNull()
    expect(getSettingsParentPath('/session/abc')).toBeNull()
  })
})

describe('resolveSettingsExitTarget', () => {
  it('returns last session when available', () => {
    expect(resolveSettingsExitTarget('sess-1')).toEqual({
      to: '/session/$sessionId',
      params: { sessionId: 'sess-1' },
    })
  })

  it('treats the transient new-chat route as home', () => {
    expect(resolveSettingsExitTarget('new')).toEqual({ to: '/new' })
  })

  it('falls back to home when the cached session no longer exists', () => {
    expect(resolveSettingsExitTarget('deleted-session', false)).toEqual({ to: '/' })
    expect(resolveSettingsExitTarget('new', false)).toEqual({ to: '/' })
  })

  it('keeps the cached session when storage confirms it exists', () => {
    expect(resolveSettingsExitTarget('sess-1', true)).toEqual({
      to: '/session/$sessionId',
      params: { sessionId: 'sess-1' },
    })
  })

  it('falls back to home without a session', () => {
    expect(resolveSettingsExitTarget(null)).toEqual({ to: '/' })
    expect(resolveSettingsExitTarget(undefined)).toEqual({ to: '/' })
    expect(resolveSettingsExitTarget('')).toEqual({ to: '/' })
  })
})

describe('resolveSettingsExit', () => {
  it('returns to /new from a new chat without looking the draft up in storage', async () => {
    const exists = vi.fn(async () => false)
    expect(await resolveSettingsExit('new', exists)).toEqual({ to: '/new' })
    expect(exists).not.toHaveBeenCalled()
  })

  it('returns to a stored session and falls back to home for a missing one', async () => {
    expect(await resolveSettingsExit('sess-1', async (id) => id === 'sess-1')).toEqual({
      to: '/session/$sessionId',
      params: { sessionId: 'sess-1' },
    })
    expect(await resolveSettingsExit('gone', async () => false)).toEqual({ to: '/' })
    expect(await resolveSettingsExit(null, async () => true)).toEqual({ to: '/' })
  })
})

describe('resolveSettingsEntryPath', () => {
  it('defaults to provider settings', () => {
    expect(resolveSettingsEntryPath()).toBe('/settings/provider')
    expect(resolveSettingsEntryPath('/')).toBe('/settings/provider')
  })

  it('normalizes absolute and relative suffixes', () => {
    expect(resolveSettingsEntryPath('/mcp')).toBe('/settings/mcp')
    expect(resolveSettingsEntryPath('chat')).toBe('/settings/chat')
    expect(resolveSettingsEntryPath('/provider/openai')).toBe('/settings/provider/openai')
  })
})

describe('settingsOpenerHref', () => {
  it('returns to the page Settings was opened from, with its tab', () => {
    expect(settingsOpenerHref({ pathname: '/scope/s1', href: '/scope/s1?tab=knowledge' })).toBe(
      '/scope/s1?tab=knowledge'
    )
    expect(settingsOpenerHref({ pathname: '/', href: '/' })).toBe('/')
  })

  it('leaves a chat and the new-chat draft to resolveSettingsExit, which checks the chat still exists', () => {
    expect(settingsOpenerHref({ pathname: '/session/deleted', href: '/session/deleted' })).toBeNull()
    expect(settingsOpenerHref({ pathname: '/new', href: '/new' })).toBeNull()
  })

  it('has nothing to return to on cold entry', () => {
    expect(settingsOpenerHref(undefined)).toBeNull()
    expect(settingsOpenerHref({ pathname: '/settings/provider', href: '/settings/provider' })).toBeNull()
  })
})
