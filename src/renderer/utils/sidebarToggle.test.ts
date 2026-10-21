import { describe, expect, it } from 'vitest'
import { getSidebarToggleResult } from './sidebarToggle'

describe('getSidebarToggleResult', () => {
  it('medium flips the rail peek and never writes the layout preference', () => {
    expect(
      getSidebarToggleResult({ mode: 'medium', sidebarLayout: 'expanded', showSidebar: true, railPeek: false })
    ).toEqual({ sidebarLayout: 'expanded', showSidebar: true, railPeek: true })
    expect(
      getSidebarToggleResult({ mode: 'medium', sidebarLayout: 'rail', showSidebar: true, railPeek: true })
    ).toEqual({ sidebarLayout: 'rail', showSidebar: true, railPeek: false })
  })

  it('wide flips the layout and clears the peek', () => {
    expect(getSidebarToggleResult({ mode: 'wide', sidebarLayout: 'rail', showSidebar: true, railPeek: true })).toEqual({
      sidebarLayout: 'expanded',
      showSidebar: true,
      railPeek: false,
    })
    expect(
      getSidebarToggleResult({ mode: 'wide', sidebarLayout: 'expanded', showSidebar: true, railPeek: false })
    ).toEqual({ sidebarLayout: 'rail', showSidebar: true, railPeek: false })
  })

  it('phone is a no-op', () => {
    const state = { mode: 'phone', sidebarLayout: 'expanded', showSidebar: false, railPeek: false } as const
    expect(getSidebarToggleResult(state)).toEqual({ sidebarLayout: 'expanded', showSidebar: false, railPeek: false })
    const open = { mode: 'phone', sidebarLayout: 'rail', showSidebar: true, railPeek: true } as const
    expect(getSidebarToggleResult(open)).toEqual({ sidebarLayout: 'rail', showSidebar: true, railPeek: true })
  })
})
