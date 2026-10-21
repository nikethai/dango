import { describe, expect, it } from 'vitest'
import TestPlatform from './test_platform'

describe('TestPlatform quick window shell', () => {
  it('records quick window heights', async () => {
    const platform = new TestPlatform()
    await platform.setQuickWindowHeight(300)
    await platform.setQuickWindowHeight(132)
    expect(platform.quickWindowHeights).toEqual([300, 132])
  })

  it('counts quick window hides', async () => {
    const platform = new TestPlatform()
    expect(platform.quickHidden).toBe(0)
    await platform.hideQuickWindow()
    await platform.hideQuickWindow()
    expect(platform.quickHidden).toBe(2)
  })
})

describe('TestPlatform raw store reads', () => {
  it('returns the stored value as text, a stored null as "null", and null when nothing is stored', async () => {
    const platform = new TestPlatform()
    await platform.setStoreValue('knowledge', { version: 1 })
    await platform.setStoreValue('empty', null)
    expect(await platform.getStoreRaw('knowledge')).toBe('{"version":1}')
    expect(await platform.getStoreRaw('empty')).toBe('null')
    expect(await platform.getStoreRaw('missing')).toBeNull()
  })
})
