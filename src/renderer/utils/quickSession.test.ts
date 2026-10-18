import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  QUICK_SESSION_REUSE_WINDOW_MS,
  QUICK_SESSION_STORAGE_KEY,
  readQuickSessionSnapshot,
  resolveQuickSessionId,
  writeQuickSessionSnapshot,
} from './quickSession'

describe('resolveQuickSessionId', () => {
  const now = 10_000

  it('reuses the last quick session through the three-minute boundary', () => {
    expect(
      resolveQuickSessionId(
        { sessionId: 'quick-1', lastOpenedAt: now - QUICK_SESSION_REUSE_WINDOW_MS, lastScopeId: null },
        ['quick-1', 'other'],
        now
      )
    ).toBe('quick-1')
  })

  it('starts fresh after three minutes or when the saved session is missing', () => {
    expect(
      resolveQuickSessionId(
        { sessionId: 'quick-1', lastOpenedAt: now - QUICK_SESSION_REUSE_WINDOW_MS - 1, lastScopeId: null },
        ['quick-1'],
        now
      )
    ).toBeNull()
    expect(
      resolveQuickSessionId({ sessionId: 'quick-1', lastOpenedAt: now, lastScopeId: null }, ['other'], now)
    ).toBeNull()
  })
})

describe('null session id', () => {
  it('resolves to null', () => {
    expect(
      resolveQuickSessionId({ sessionId: null, lastOpenedAt: 10_000, lastScopeId: 'acme' }, ['a'], 10_000)
    ).toBeNull()
  })
})

describe('snapshot storage', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('reads an old snapshot without lastScopeId as null scope', () => {
    store.set(QUICK_SESSION_STORAGE_KEY, JSON.stringify({ sessionId: 'a', lastOpenedAt: 1 }))
    expect(readQuickSessionSnapshot()).toEqual({ sessionId: 'a', lastOpenedAt: 1, lastScopeId: null })
  })

  it('round-trips a scope and a null session', () => {
    writeQuickSessionSnapshot({ sessionId: null, lastOpenedAt: 5, lastScopeId: 'acme' })
    expect(readQuickSessionSnapshot()).toEqual({ sessionId: null, lastOpenedAt: 5, lastScopeId: 'acme' })
  })

  it('falls back to defaults on bad JSON or wrong types', () => {
    store.set(QUICK_SESSION_STORAGE_KEY, '{nope')
    expect(readQuickSessionSnapshot()).toBeNull()
    store.set(QUICK_SESSION_STORAGE_KEY, 'null')
    expect(readQuickSessionSnapshot()).toBeNull()
    store.set(QUICK_SESSION_STORAGE_KEY, JSON.stringify({ sessionId: 5, lastOpenedAt: 'x', lastScopeId: 7 }))
    expect(readQuickSessionSnapshot()).toEqual({ sessionId: null, lastOpenedAt: 0, lastScopeId: null })
  })

  it('survives throwing storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    })
    expect(readQuickSessionSnapshot()).toBeNull()
    expect(() => writeQuickSessionSnapshot({ sessionId: 'a', lastOpenedAt: 1, lastScopeId: null })).not.toThrow()
  })
})
