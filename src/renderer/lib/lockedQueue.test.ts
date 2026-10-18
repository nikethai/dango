import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLockedQueue } from './lockedQueue'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createLockedQueue', () => {
  it('runs tasks one at a time, in order, and a failure does not block the next', async () => {
    const enqueue = createLockedQueue('test')
    const order: string[] = []
    const slow = enqueue(async () => {
      await new Promise((r) => setTimeout(r, 5))
      order.push('slow')
    })
    const failing = enqueue(() => {
      order.push('failing')
      return Promise.reject(new Error('boom'))
    })
    const fast = enqueue(() => {
      order.push('fast')
      return Promise.resolve(3)
    })
    await slow
    await expect(failing).rejects.toThrow('boom')
    await expect(fast).resolves.toBe(3)
    expect(order).toEqual(['slow', 'failing', 'fast'])
  })

  it('takes the named Web Lock when navigator.locks exists', async () => {
    const request = vi.fn(<T>(_name: string, fn: () => Promise<T>) => fn())
    vi.stubGlobal('navigator', { locks: { request } })
    const enqueue = createLockedQueue('dango:test')
    await expect(enqueue(() => Promise.resolve('ok'))).resolves.toBe('ok')
    expect(request).toHaveBeenCalledWith('dango:test', expect.any(Function))
  })
})
