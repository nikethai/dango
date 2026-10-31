import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openChatHit } from './chats'

const m = vi.hoisted(() => ({
  currentSessionId: 'c1' as string | null,
  switchCurrentSession: vi.fn(),
  scrollToMessage: vi.fn(async () => true),
}))

vi.mock('jotai', () => ({ getDefaultStore: () => ({ get: () => m.currentSessionId }) }))
vi.mock('@/stores/atoms', () => ({ currentSessionIdAtom: {} }))
vi.mock('@/stores/sessionActions', () => ({ switchCurrentSession: m.switchCurrentSession }))
vi.mock('@/stores/scrollActions', () => ({ scrollToMessage: m.scrollToMessage }))

beforeEach(() => {
  vi.clearAllMocks()
  m.currentSessionId = 'c1'
})

describe('openChatHit', () => {
  it('opens the last-open chat from another page, such as Review', async () => {
    openChatHit('c1')
    await vi.waitFor(() => expect(m.switchCurrentSession).toHaveBeenCalledWith('c1'))
  })

  it('opens a different chat', async () => {
    openChatHit('c2')
    await vi.waitFor(() => expect(m.switchCurrentSession).toHaveBeenCalledWith('c2'))
  })

  it('scrolls to the matching message after opening', async () => {
    openChatHit('c1', 'msg-1')
    await vi.waitFor(() => expect(m.scrollToMessage).toHaveBeenCalledWith('c1', 'msg-1'))
    expect(m.switchCurrentSession).toHaveBeenCalledWith('c1')
  })
})
