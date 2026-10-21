import { describe, expect, it } from 'vitest'
import { getSidebarToggleResult, sidebarToggleLabel } from './sidebarToggle'

describe('getSidebarToggleResult', () => {
  it('medium flips the rail peek and never writes the layout preference', () => {
    expect(getSidebarToggleResult({ mode: 'medium', sidebarLayout: 'expanded', railPeek: false })).toEqual({
      sidebarLayout: 'expanded',
      railPeek: true,
    })
    expect(getSidebarToggleResult({ mode: 'medium', sidebarLayout: 'rail', railPeek: true })).toEqual({
      sidebarLayout: 'rail',
      railPeek: false,
    })
  })

  it('wide flips the layout and clears the peek', () => {
    expect(getSidebarToggleResult({ mode: 'wide', sidebarLayout: 'rail', railPeek: true })).toEqual({
      sidebarLayout: 'expanded',
      railPeek: false,
    })
    expect(getSidebarToggleResult({ mode: 'wide', sidebarLayout: 'expanded', railPeek: false })).toEqual({
      sidebarLayout: 'rail',
      railPeek: false,
    })
  })

  it('phone is a no-op', () => {
    const state = { mode: 'phone', sidebarLayout: 'expanded', railPeek: false } as const
    expect(getSidebarToggleResult(state)).toEqual({ sidebarLayout: 'expanded', railPeek: false })
    const open = { mode: 'phone', sidebarLayout: 'rail', railPeek: true } as const
    expect(getSidebarToggleResult(open)).toEqual({ sidebarLayout: 'rail', railPeek: true })
  })
})

describe('sidebarToggleLabel', () => {
  const t = (key: string) => `t:${key}`

  it('names the action: Expand at wide (rail), Show or Hide the peek at medium', () => {
    expect(sidebarToggleLabel(t, 'wide', false)).toBe('t:Expand sidebar')
    expect(sidebarToggleLabel(t, 'wide', true)).toBe('t:Expand sidebar')
    expect(sidebarToggleLabel(t, 'medium', false)).toBe('t:Show sidebar')
    expect(sidebarToggleLabel(t, 'medium', true)).toBe('t:Hide sidebar')
  })
})
