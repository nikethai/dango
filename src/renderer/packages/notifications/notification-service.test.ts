import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { NotificationService, routeNotificationClick } from './notification-service'
import { createSeenEntriesLedger } from './seen-entries'
import { LONG_RUN_MS, NOTIFY_MIN_GAP_MS, type NotificationServiceDeps, type NotifyEvent } from './types'

const MIN = 60_000

type Shared = { lastShownAt: number | null }

function createService(overrides: Partial<NotificationServiceDeps> = {}, shared: Shared = { lastShownAt: null }) {
  const show = vi.fn<NotificationServiceDeps['show']>(async () => {})
  const deps: NotificationServiceDeps = {
    getConfig: () => ({
      enabled: true,
      notifyOnNeedsYou: true,
      notifyOnGenerationComplete: true,
      notifyOnRoomComplete: true,
      notifyOnUpdateAvailable: true,
    }),
    isAppActive: () => false,
    getPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    show,
    now: () => Date.now(),
    setTimer: (fn, ms) => {
      const id = setTimeout(fn, ms)
      return () => clearTimeout(id)
    },
    getLastShownAt: () => shared.lastShownAt,
    setLastShownAt: (t) => {
      shared.lastShownAt = t
    },
    ...overrides,
  }
  return { service: new NotificationService(deps), show, deps, shared }
}

const needsYou = (id: string, text = `Entry ${id}`): NotifyEvent => ({ kind: 'needs_you', entryId: id, text })
const longRun = (sessionId: string, startedAt: number, sessionName?: string): NotifyEvent => ({
  kind: 'long_run_done',
  sessionId,
  sessionName,
  startedAt,
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-18T09:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('NotificationService', () => {
  test('short runs never notify', async () => {
    const { service, show } = createService()
    const now = Date.now()
    expect(await service.notify(longRun('s1', now - 59_000))).toBe('skipped')
    expect(show).not.toHaveBeenCalled()
    expect(await service.notify(longRun('s1', now - 61_000))).toBe('shown')
    expect(show).toHaveBeenCalledTimes(1)
    expect(LONG_RUN_MS).toBe(60_000)
  })

  test('one every ten minutes, grouped', async () => {
    const { service, show } = createService()
    expect(await service.notify(needsYou('a'))).toBe('shown')
    await vi.advanceTimersByTimeAsync(MIN)
    expect(await service.notify(needsYou('b'))).toBe('queued')
    await vi.advanceTimersByTimeAsync(MIN)
    expect(await service.notify(needsYou('c'))).toBe('queued')
    expect(show).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10 * MIN - 2 * MIN)
    expect(show).toHaveBeenCalledTimes(2)
    expect(show).toHaveBeenLastCalledWith({ title: 'Dango', body: '2 things need you', data: { kind: 'needs_you' } })
    expect(NOTIFY_MIN_GAP_MS).toBe(600_000)
  })

  test('mixed group', async () => {
    const { service, show } = createService({}, { lastShownAt: Date.now() })
    const started = Date.now() - 2 * MIN
    expect(await service.notify(needsYou('a'))).toBe('queued')
    expect(await service.notify(longRun('s1', started))).toBe('queued')
    expect(await service.notify(longRun('s2', started))).toBe('queued')
    await vi.advanceTimersByTimeAsync(NOTIFY_MIN_GAP_MS)
    expect(show).toHaveBeenCalledTimes(1)
    expect(show.mock.calls[0][0].body).toBe('1 thing needs you · 2 runs finished')
    expect(show.mock.calls[0][0].title).toBe('Dango')
  })

  test('grouped long runs only', async () => {
    const { service, show } = createService({}, { lastShownAt: Date.now() })
    const started = Date.now() - 2 * MIN
    await service.notify(longRun('s1', started))
    await service.notify(longRun('s2', started))
    await vi.advanceTimersByTimeAsync(NOTIFY_MIN_GAP_MS)
    expect(show.mock.calls[0][0].body).toBe('2 runs finished')
  })

  test('shared gap', async () => {
    const shared: Shared = { lastShownAt: null }
    const first = createService({}, shared)
    const second = createService({}, shared)
    expect(await first.service.notify(needsYou('a'))).toBe('shown')
    expect(await second.service.notify(needsYou('b'))).toBe('queued')
    expect(second.show).not.toHaveBeenCalled()
  })

  test('flush re-reads the shared gap: two windows, one notification', async () => {
    const shared: Shared = { lastShownAt: Date.now() }
    const first = createService({}, shared)
    const second = createService({}, shared)
    expect(await first.service.notify(needsYou('a'))).toBe('queued')
    expect(await second.service.notify(needsYou('b'))).toBe('queued')
    await vi.advanceTimersByTimeAsync(NOTIFY_MIN_GAP_MS)
    // Both timers fired at the same moment; only the first flush shows, the second reschedules.
    expect(first.show.mock.calls.length + second.show.mock.calls.length).toBe(1)
    await vi.advanceTimersByTimeAsync(NOTIFY_MIN_GAP_MS)
    expect(first.show.mock.calls.length + second.show.mock.calls.length).toBe(2)
  })

  test('active app drops the queue', async () => {
    let active = false
    const { service, show } = createService({ isAppActive: () => active })
    expect(await service.notify(needsYou('a'))).toBe('shown')
    expect(await service.notify(needsYou('b'))).toBe('queued')
    active = true
    await vi.advanceTimersByTimeAsync(NOTIFY_MIN_GAP_MS)
    active = false
    await vi.advanceTimersByTimeAsync(NOTIFY_MIN_GAP_MS)
    expect(show).toHaveBeenCalledTimes(1)
  })

  test('permission not granted drops the queue', async () => {
    const { service, show } = createService({ getPermission: async () => 'default' })
    expect(await service.notify(needsYou('a'))).toBe('skipped')
    expect(show).not.toHaveBeenCalled()
  })

  test('payload has no extra fields', async () => {
    const { service, show } = createService()
    await service.notify(longRun('s1', Date.now() - 2 * MIN, 'Trip plan'))
    const payload = show.mock.calls[0][0]
    expect(Object.keys(payload).sort()).toEqual(['body', 'data', 'title'])
    expect(payload).toEqual({
      title: 'Finished in the background',
      body: 'Trip plan is ready.',
      data: { sessionId: 's1', kind: 'long_run_done' },
    })
  })

  test('long run without a name', async () => {
    const { service, show } = createService()
    await service.notify(longRun('s1', Date.now() - 2 * MIN))
    expect(show.mock.calls[0][0].body).toBe('Your chat is ready.')
  })

  test('needs you copy cuts the entry text to 100 code points without lone surrogates', async () => {
    const { service, show } = createService()
    const text = `${'a'.repeat(99)}😀😀 tail`
    await service.notify(needsYou('a', text))
    const payload = show.mock.calls[0][0]
    expect(payload.title).toBe('Needs you')
    expect(payload.data).toEqual({ kind: 'needs_you' })
    expect(Array.from(payload.body)).toHaveLength(100)
    expect(payload.body.endsWith('😀')).toBe(true)
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(payload.body)).toBe(false)
  })

  test('kind toggles and the master switch', async () => {
    const off = createService({
      getConfig: () => ({
        enabled: true,
        notifyOnNeedsYou: false,
        notifyOnGenerationComplete: true,
        notifyOnRoomComplete: true,
        notifyOnUpdateAvailable: true,
      }),
    })
    expect(await off.service.notify(needsYou('a'))).toBe('skipped')
    expect(await off.service.notify(longRun('s1', Date.now() - 2 * MIN))).toBe('shown')
    const master = createService({
      getConfig: () => ({
        enabled: false,
        notifyOnNeedsYou: true,
        notifyOnGenerationComplete: true,
        notifyOnRoomComplete: true,
        notifyOnUpdateAvailable: true,
      }),
    })
    expect(await master.service.notify(needsYou('a'))).toBe('skipped')
  })

  test('skips while the app is active', async () => {
    const { service, show } = createService({ isAppActive: () => true })
    expect(await service.notify(needsYou('a'))).toBe('skipped')
    expect(show).not.toHaveBeenCalled()
  })

  test('dedupes the same entry or run within 30 s', async () => {
    const { service } = createService({}, { lastShownAt: Date.now() })
    const started = Date.now() - 2 * MIN
    expect(await service.notify(needsYou('a'))).toBe('queued')
    expect(await service.notify(needsYou('a'))).toBe('skipped')
    expect(await service.notify(longRun('s1', started))).toBe('queued')
    expect(await service.notify(longRun('s1', started))).toBe('skipped')
    await vi.advanceTimersByTimeAsync(31_000)
    expect(await service.notify(needsYou('a'))).toBe('queued')
  })
})

describe('fix round 1', () => {
  test('a last-shown time in the future counts as now', async () => {
    const { service, show } = createService({}, { lastShownAt: Date.now() + 24 * 60 * MIN })
    expect(await service.notify(needsYou('a'))).toBe('queued')
    await vi.advanceTimersByTimeAsync(NOTIFY_MIN_GAP_MS)
    expect(show).toHaveBeenCalledTimes(1)
  })

  test('two tabs sharing the seen-entries ledger notify a Needs you entry once', async () => {
    const map = new Map<string, string>()
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    }
    const ledger = createSeenEntriesLedger({ storage: () => storage, now: () => Date.now() })
    const claimNeedsYou = (id: string) => ledger.claim(id)
    const tabA = createService({ claimNeedsYou })
    const tabB = createService({ claimNeedsYou })
    expect(await tabA.service.notify(needsYou('a'))).toBe('shown')
    expect(await tabB.service.notify(needsYou('a'))).toBe('skipped')
    expect(tabB.show).not.toHaveBeenCalled()
    expect(await tabB.service.notify(needsYou('b'))).toBe('shown')
  })
})

describe('createSeenEntriesLedger', () => {
  test('caps the list and forgets old ids', () => {
    const map = new Map<string, string>()
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    }
    let now = 1_000_000
    const ledger = createSeenEntriesLedger({ storage: () => storage, now: () => now, max: 3, ttlMs: 1_000 })
    expect(ledger.claim('a')).toBe(true)
    expect(ledger.claim('a')).toBe(false)
    ledger.claim('b')
    ledger.claim('c')
    ledger.claim('d')
    // 'a' was dropped by the cap
    expect(ledger.claim('a')).toBe(true)
    now += 1_001
    expect(ledger.claim('d')).toBe(true)
  })

  test('blocked or garbage storage still lets the entry through', () => {
    const throwing = createSeenEntriesLedger({
      storage: () => {
        throw new Error('blocked')
      },
      now: () => 1,
    })
    expect(throwing.claim('a')).toBe(true)
    const garbage = createSeenEntriesLedger({
      storage: () => ({ getItem: () => '{oops', setItem: () => undefined }),
      now: () => 1,
    })
    expect(garbage.claim('a')).toBe(true)
  })
})

describe('routeNotificationClick', () => {
  test('a long run opens its chat after showing the main window', async () => {
    const order: string[] = []
    await routeNotificationClick(
      { sessionId: 's1', kind: 'long_run_done' },
      {
        showMainWindow: async () => void order.push('show'),
        navigate: (to) => void order.push(to),
      }
    )
    expect(order).toEqual(['show', '/session/s1'])
  })

  test('kind-only clicks route to Review after showing the main window', async () => {
    const order: string[] = []
    await routeNotificationClick(
      { kind: 'needs_you' },
      {
        showMainWindow: async () => void order.push('show'),
        navigate: (to) => void order.push(to),
      }
    )
    expect(order).toEqual(['show', '/'])
  })

  test('a failing showMainWindow still navigates; empty payloads do nothing', async () => {
    const navigate = vi.fn()
    await routeNotificationClick(
      { kind: 'needs_you' },
      { showMainWindow: async () => Promise.reject(new Error('x')), navigate }
    )
    expect(navigate).toHaveBeenCalledWith('/')
    navigate.mockClear()
    await routeNotificationClick({}, { navigate })
    expect(navigate).not.toHaveBeenCalled()
  })
})
