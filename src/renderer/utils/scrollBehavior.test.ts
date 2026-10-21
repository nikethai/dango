// A11Y1 rule 2 (slice 09 Task 10 fix round): scrolling jumps instead of gliding when reduced motion is on.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ scrollToIndex: vi.fn() }))

vi.mock('@/stores/chatStore', () => ({ getSession: vi.fn() }))
vi.mock('@/stores/sessionHelpers', () => ({ getAllMessageList: vi.fn() }))
vi.mock('@/stores/uiStore', () => ({
  uiStore: { getState: () => ({ messageScrolling: { current: { scrollToIndex: h.scrollToIndex } } }) },
}))

import { scrollToBottom, scrollToIndex } from '@/stores/scrollActions'
import { motionScrollBehavior, prefersReducedMotion } from './scrollBehavior'

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal('window', {
    matchMedia: (media: string) => ({ matches: media === '(prefers-reduced-motion: reduce)' ? matches : false, media }),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  h.scrollToIndex.mockClear()
})

describe('motionScrollBehavior', () => {
  it('keeps smooth without reduced motion and jumps with it', () => {
    stubReducedMotion(false)
    expect(prefersReducedMotion()).toBe(false)
    expect(motionScrollBehavior()).toBe('smooth')
    expect(motionScrollBehavior('smooth')).toBe('smooth')
    expect(motionScrollBehavior('auto')).toBe('auto')
    stubReducedMotion(true)
    expect(prefersReducedMotion()).toBe(true)
    expect(motionScrollBehavior()).toBe('auto')
    expect(motionScrollBehavior('smooth')).toBe('auto')
  })

  it('without matchMedia (or window) it keeps the asked behaviour', () => {
    vi.stubGlobal('window', {})
    expect(motionScrollBehavior()).toBe('smooth')
    vi.stubGlobal('window', undefined)
    expect(prefersReducedMotion()).toBe(false)
  })
})

describe('scrollActions honour reduced motion', () => {
  it('scrollToIndex and scrollToBottom ask the message list for smooth only without reduced motion', () => {
    stubReducedMotion(false)
    scrollToIndex(3, 'start', 'smooth')
    expect(h.scrollToIndex).toHaveBeenLastCalledWith({ index: 3, align: 'start', behavior: 'smooth' })
    stubReducedMotion(true)
    scrollToIndex(3, 'start', 'smooth')
    expect(h.scrollToIndex).toHaveBeenLastCalledWith({ index: 3, align: 'start', behavior: 'auto' })
    scrollToBottom('smooth')
    expect(h.scrollToIndex).toHaveBeenLastCalledWith({ index: 'LAST', align: 'end', behavior: 'auto' })
  })
})

describe('no hard-coded smooth scrolling', () => {
  const RENDERER = resolve(process.cwd(), 'src/renderer')
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full, out)
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
    }
    return out
  }

  it("no renderer file passes behavior: 'smooth' directly (MessageList, the Android keyboard hook, …)", () => {
    const offenders = walk(RENDERER)
      .filter((full) => /behavior:\s*['"]smooth['"]/.test(readFileSync(full, 'utf8')))
      .map((full) => relative(RENDERER, full).split(sep).join('/'))
    expect(offenders).toEqual([])
  })
})
