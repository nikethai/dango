import { describe, expect, it, vi } from 'vitest'
import {
  cancelSessionGeneration,
  clearGenerationCancel,
  registerGenerationCancel,
  wasGenerationCancelled,
} from './generation-cancel'

vi.mock('@/packages/model-calls/toolsets/browser', () => ({ stopBrowserSession: vi.fn() }))
vi.mock('@/platform', () => ({ default: {} }))
vi.mock('@/packages/browser/lock', () => ({ releaseBrowserLock: vi.fn() }))

describe('wasGenerationCancelled', () => {
  it('is false for a run that finished on its own', () => {
    const cancel = vi.fn()
    registerGenerationCancel('s1', 'm1', cancel)
    clearGenerationCancel('s1', 'm1')
    expect(wasGenerationCancelled('s1', 'm1')).toBe(false)
  })

  it('is true once Stop fires the registered cancel, and survives later updates from the same stream', () => {
    const cancel = vi.fn()
    registerGenerationCancel('s2', 'm1', cancel)
    expect(cancelSessionGeneration('s2')).toBe(true)
    expect(cancel).toHaveBeenCalled()
    expect(wasGenerationCancelled('s2', 'm1')).toBe(true)
    // A trailing stream update re-registers the same abort function: still stopped.
    registerGenerationCancel('s2', 'm1', cancel)
    expect(wasGenerationCancelled('s2', 'm1')).toBe(true)
    expect(wasGenerationCancelled('s2', 'other')).toBe(false)
  })

  it('clears when a new run registers for that message', () => {
    const first = vi.fn()
    registerGenerationCancel('s3', 'm1', first)
    cancelSessionGeneration('s3')
    expect(wasGenerationCancelled('s3', 'm1')).toBe(true)
    registerGenerationCancel('s3', 'm1', vi.fn())
    expect(wasGenerationCancelled('s3', 'm1')).toBe(false)
  })
})
