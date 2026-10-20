// @vitest-environment jsdom
import { ToolRiskTier } from '@shared/types/mcp'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getToolRiskTier } from '../tools/risk-engine'
import {
  getPermissionHead,
  type PermissionRequest,
  requestToolPermission,
  resolvePermission,
  usePermissionHead,
} from './queue'

function req(over: Partial<Omit<PermissionRequest, 'id'>> = {}): Omit<PermissionRequest, 'id'> {
  return {
    sessionId: 'session-1',
    scopeId: 's1',
    toolName: 'browser_click',
    riskTier: ToolRiskTier.HIGH,
    summary: { what: 'Use the browser', touches: [] },
    allowAlways: true,
    ...over,
  }
}

function headId(): string {
  const head = getPermissionHead()
  if (!head) throw new Error('no permission request is open')
  return head.id
}

function drain() {
  for (let head = getPermissionHead(); head; head = getPermissionHead()) {
    resolvePermission(head.id, 'deny')
  }
}

describe('permission queue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    drain()
    vi.useRealTimers()
  })

  it('shows one request at a time, in order', async () => {
    const first = requestToolPermission(req({ toolName: 'browser_click' }))
    const second = requestToolPermission(req({ toolName: 'browser_type' }))
    expect(getPermissionHead()?.toolName).toBe('browser_click')
    resolvePermission(headId(), 'once')
    await expect(first).resolves.toBe('once')
    expect(getPermissionHead()?.toolName).toBe('browser_type')
    resolvePermission(headId(), 'deny')
    await expect(second).resolves.toBe('deny')
    expect(getPermissionHead()).toBeNull()
  })

  it('once queued pair resolves on always', async () => {
    const first = requestToolPermission(req())
    const second = requestToolPermission(req())
    resolvePermission(headId(), 'always')
    await expect(first).resolves.toBe('always')
    await expect(second).resolves.toBe('always')
    expect(getPermissionHead()).toBeNull()
  })

  it('always leaves calls in another scope queued', async () => {
    const first = requestToolPermission(req())
    const second = requestToolPermission(req())
    const third = requestToolPermission(req({ scopeId: 's2' }))
    resolvePermission(headId(), 'always')
    await expect(first).resolves.toBe('always')
    await expect(second).resolves.toBe('always')
    expect(getPermissionHead()?.scopeId).toBe('s2')
    resolvePermission(headId(), 'once')
    await expect(third).resolves.toBe('once')
  })

  it('always in an unscoped chat matches the same session only', async () => {
    const first = requestToolPermission(req({ scopeId: undefined }))
    const sameChat = requestToolPermission(req({ scopeId: undefined }))
    void requestToolPermission(req({ scopeId: undefined, sessionId: 'session-2' }))
    void requestToolPermission(req({ scopeId: undefined, toolName: 'browser_type' }))
    resolvePermission(headId(), 'always')
    await expect(first).resolves.toBe('always')
    await expect(sameChat).resolves.toBe('always')
    expect(getPermissionHead()?.sessionId).toBe('session-2')
  })

  it('always never sweeps requests that do not allow it', async () => {
    const first = requestToolPermission(req({ toolName: 'delete_file', allowAlways: false }))
    void requestToolPermission(req({ toolName: 'delete_file', allowAlways: false }))
    resolvePermission(headId(), 'always')
    await expect(first).resolves.toBe('once')
    expect(getPermissionHead()?.toolName).toBe('delete_file')
  })

  it('always on a HIGH call leaves a CRITICAL call to the same tool queued (real risk engine)', async () => {
    const shell = (command: string) =>
      req({
        toolName: 'run_command',
        riskTier: getToolRiskTier('run_command', 'Run a shell command', { command }),
        summary: { what: 'Run a command', touches: [command] },
        allowAlways: true,
      })
    const benign = requestToolPermission(shell('ls'))
    const destructive = requestToolPermission(shell('rm -r ~/'))
    expect(getPermissionHead()?.riskTier).toBe(ToolRiskTier.HIGH)
    resolvePermission(headId(), 'always')
    await expect(benign).resolves.toBe('always')
    const head = getPermissionHead()
    expect(head?.riskTier).toBe(ToolRiskTier.CRITICAL)
    expect(head?.allowAlways).toBe(false)
    resolvePermission(headId(), 'deny')
    await expect(destructive).resolves.toBe('deny')
  })

  it('timeout denies', async () => {
    const pending = requestToolPermission(req())
    vi.advanceTimersByTime(119_999)
    expect(getPermissionHead()).not.toBeNull()
    vi.advanceTimersByTime(1)
    await expect(pending).resolves.toBe('deny')
    expect(getPermissionHead()).toBeNull()
  })

  it('the timeout runs from when a request shows, not from queueing', async () => {
    const first = requestToolPermission(req())
    const second = requestToolPermission(req({ toolName: 'browser_type' }))
    let secondChoice: string | undefined
    void second.then((choice) => {
      secondChoice = choice
    })
    vi.advanceTimersByTime(100_000)
    resolvePermission(headId(), 'once')
    await expect(first).resolves.toBe('once')
    vi.advanceTimersByTime(100_000)
    await Promise.resolve()
    expect(secondChoice).toBeUndefined()
    expect(getPermissionHead()?.toolName).toBe('browser_type')
    vi.advanceTimersByTime(20_000)
    await expect(second).resolves.toBe('deny')
    expect(getPermissionHead()).toBeNull()
  })

  it('abort of a queued request removes it before it shows', async () => {
    const controller = new AbortController()
    void requestToolPermission(req())
    const queued = requestToolPermission(req({ toolName: 'browser_type' }), { signal: controller.signal })
    controller.abort()
    await expect(queued).resolves.toBe('deny')
    expect(getPermissionHead()?.toolName).toBe('browser_click')
  })

  it('does not trust allowAlways for a tool that always asks', async () => {
    const first = requestToolPermission(req({ toolName: 'delete_file', allowAlways: true }))
    void requestToolPermission(req({ toolName: 'delete_file', allowAlways: true }))
    expect(getPermissionHead()?.allowAlways).toBe(false)
    resolvePermission(headId(), 'always')
    await expect(first).resolves.toBe('once')
    expect(getPermissionHead()?.toolName).toBe('delete_file')
  })

  it('abort denies', async () => {
    const controller = new AbortController()
    const first = requestToolPermission(req(), { signal: controller.signal })
    void requestToolPermission(req({ toolName: 'browser_type' }))
    controller.abort()
    await expect(first).resolves.toBe('deny')
    expect(getPermissionHead()?.toolName).toBe('browser_type')
  })

  it('an already aborted signal denies without queuing', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(requestToolPermission(req(), { signal: controller.signal })).resolves.toBe('deny')
    expect(getPermissionHead()).toBeNull()
  })

  it('resolving an unknown or settled id does nothing', async () => {
    const pending = requestToolPermission(req())
    const id = headId()
    resolvePermission(id, 'once')
    resolvePermission(id, 'deny')
    resolvePermission('nope', 'deny')
    await expect(pending).resolves.toBe('once')
  })

  it('usePermissionHead follows the queue', () => {
    const { result } = renderHook(() => usePermissionHead())
    expect(result.current).toBeNull()
    act(() => {
      void requestToolPermission(req())
    })
    expect(result.current?.toolName).toBe('browser_click')
    act(() => {
      resolvePermission(headId(), 'once')
    })
    expect(result.current).toBeNull()
  })
})
