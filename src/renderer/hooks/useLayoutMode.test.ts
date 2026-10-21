import { describe, expect, it, vi } from 'vitest'

// The live store clears the rail peek through uiStore; the pure functions under test here never touch it.
vi.mock('@/stores/uiStore', () => ({ uiStore: { getState: () => ({}) } }))

import { LAYOUT_MEDIUM_MIN, LAYOUT_WIDE_MIN, layoutModeForWidth, sidebarPresentation } from './useLayoutMode'

describe('layoutModeForWidth', () => {
  it('splits at 1200 and 760 px', () => {
    expect(LAYOUT_WIDE_MIN).toBe(1200)
    expect(LAYOUT_MEDIUM_MIN).toBe(760)
    expect(layoutModeForWidth(1200)).toBe('wide')
    expect(layoutModeForWidth(1199)).toBe('medium')
    expect(layoutModeForWidth(760)).toBe('medium')
    expect(layoutModeForWidth(759)).toBe('phone')
    expect(layoutModeForWidth(390)).toBe('phone')
  })
})

describe('sidebarPresentation', () => {
  const base = { expandedWidth: 220, railPeek: false } as const

  it('wide + expanded docks the expanded sidebar', () => {
    expect(sidebarPresentation({ ...base, mode: 'wide', sidebarLayout: 'expanded' })).toEqual({
      show: 'expanded',
      drawerWidth: 220,
      contentInset: 220,
    })
  })

  it('wide + rail shows the 56 px rail', () => {
    expect(sidebarPresentation({ ...base, mode: 'wide', sidebarLayout: 'rail' })).toEqual({
      show: 'rail',
      drawerWidth: 56,
      contentInset: 56,
    })
  })

  it('wide + rail + peek lays the expanded sidebar over the content', () => {
    expect(sidebarPresentation({ ...base, mode: 'wide', sidebarLayout: 'rail', railPeek: true })).toEqual({
      show: 'overlay',
      drawerWidth: 220,
      contentInset: 56,
    })
  })

  it('medium shows the rail even when the user prefers expanded', () => {
    expect(sidebarPresentation({ ...base, mode: 'medium', sidebarLayout: 'expanded' })).toEqual({
      show: 'rail',
      drawerWidth: 56,
      contentInset: 56,
    })
  })

  it('medium + peek lays the expanded sidebar over the content', () => {
    expect(sidebarPresentation({ ...base, mode: 'medium', sidebarLayout: 'expanded', railPeek: true })).toEqual({
      show: 'overlay',
      drawerWidth: 220,
      contentInset: 56,
    })
    expect(sidebarPresentation({ ...base, mode: 'medium', sidebarLayout: 'rail', railPeek: true })).toEqual({
      show: 'overlay',
      drawerWidth: 220,
      contentInset: 56,
    })
  })

  it('phone shows no sidebar whatever the inputs', () => {
    for (const sidebarLayout of ['expanded', 'rail'] as const) {
      for (const railPeek of [false, true]) {
        expect(sidebarPresentation({ mode: 'phone', sidebarLayout, railPeek, expandedWidth: 300 })).toEqual({
          show: 'none',
          drawerWidth: 0,
          contentInset: 0,
        })
      }
    }
  })

  it('a peek left open while widening does not leave an overlay (Review Focus)', () => {
    expect(sidebarPresentation({ ...base, mode: 'wide', sidebarLayout: 'expanded', railPeek: true }).show).toBe(
      'expanded'
    )
  })

  it('a dragged custom width is used for expanded and overlay', () => {
    expect(
      sidebarPresentation({ mode: 'wide', sidebarLayout: 'expanded', railPeek: false, expandedWidth: 300 })
    ).toEqual({ show: 'expanded', drawerWidth: 300, contentInset: 300 })
    expect(sidebarPresentation({ mode: 'medium', sidebarLayout: 'rail', railPeek: true, expandedWidth: 300 })).toEqual({
      show: 'overlay',
      drawerWidth: 300,
      contentInset: 56,
    })
  })
})
