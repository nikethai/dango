import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  desktop: true,
  label: 'main' as string | Error | undefined,
  hasLabel: true,
}))

vi.mock('@/platform', () => ({
  default: {
    get getWindowLabel() {
      if (!h.hasLabel) return undefined
      return () => (h.label instanceof Error ? Promise.reject(h.label) : Promise.resolve(h.label))
    },
  },
  platformCapabilities: {
    get supportsDesktopOnlySettings() {
      return h.desktop
    },
  },
}))

import { getWindowRole, knownWindowRole } from './windowRole'

beforeEach(() => {
  h.desktop = true
  h.label = 'main'
  h.hasLabel = true
})

describe('getWindowRole', () => {
  it('web and mobile: the only window runs jobs, known at once', async () => {
    h.desktop = false
    h.hasLabel = false
    expect(knownWindowRole()).toBe('jobs')
    expect(await getWindowRole()).toBe('jobs')
  })

  it('desktop: main runs jobs, quick is quick, any other window is other', async () => {
    expect(knownWindowRole()).toBeUndefined()
    expect(await getWindowRole()).toBe('jobs')
    h.label = 'quick'
    expect(await getWindowRole()).toBe('quick')
    h.label = 'settings'
    expect(await getWindowRole()).toBe('other')
  })

  it('desktop: a failed or missing label never runs jobs (R6)', async () => {
    h.label = new Error('ipc down')
    expect(await getWindowRole()).toBe('other')
    h.hasLabel = false
    expect(knownWindowRole()).toBeUndefined()
    expect(await getWindowRole()).toBe('other')
  })
})
