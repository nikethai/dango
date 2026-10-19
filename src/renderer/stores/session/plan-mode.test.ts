import type { Message, Session } from '@shared/types'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => {
  const storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
  }
  ;(globalThis as unknown as { window: Record<string, unknown> }).window = {
    desktopAPI: undefined,
    localStorage: storage,
  }
  ;(globalThis as unknown as { localStorage: typeof storage }).localStorage = storage
  return {
    sessions: new Map<string, Session>(),
    generate: vi.fn(async (..._args: unknown[]) => {}),
  }
})

type Patch = Partial<Session> | ((s: Session | null | undefined) => Session)
const applyPatch = (id: string, patch: Patch) => {
  const prev = h.sessions.get(id)
  if (!prev) throw new Error(`Session ${id} not found`)
  const next = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }
  h.sessions.set(id, next)
  return structuredClone(next)
}

const withMessages = (id: string, change: (list: Message[]) => Message[]) =>
  applyPatch(id, (s) => ({ ...(s as Session), messages: change((s as Session).messages) }))

vi.mock('../chatStore', () => ({
  getSession: async (id: string) => (h.sessions.has(id) ? structuredClone(h.sessions.get(id)) : null),
  getSessionSettings: async (id: string) => ({ ...h.sessions.get(id)?.settings }),
  updateSession: async (id: string, patch: Patch) => applyPatch(id, patch),
  updateSessionWithMessages: async (id: string, patch: Patch) => applyPatch(id, patch),
  insertMessage: async (id: string, msg: Message) => withMessages(id, (list) => [...list, msg]),
  insertMessages: async (id: string, msgs: Message[]) => withMessages(id, (list) => [...list, ...msgs]),
  updateMessage: async (id: string, msgId: string, msg: Message) =>
    withMessages(id, (list) => list.map((m) => (m.id === msgId ? { ...m, ...msg } : m))),
  updateMessageCache: async () => {},
  removeMessage: async (id: string, msgId: string) => withMessages(id, (list) => list.filter((m) => m.id !== msgId)),
}))
vi.mock('../sessionActions', () => ({ generate: h.generate }))
vi.mock('../scrollActions', () => ({ scrollToBottom: () => {} }))
vi.mock('@shared/models', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/models')>()),
  getModel: () => ({ isSupportToolUse: () => true }),
}))
vi.mock('@/adapters', () => ({ createModelDependencies: async () => ({}) }))
vi.mock('@/platform', () => ({ default: { type: 'desktop' }, platformCapabilities: {} }))
vi.mock('@/stores/settingsStore', () => ({ settingsStore: { getState: () => ({ getSettings: () => ({}) }) } }))
vi.mock('../settingsStore', () => ({ settingsStore: { getState: () => ({ getSettings: () => ({}) }) } }))
vi.mock('./session-web-browsing', () => ({ getSessionWebBrowsing: () => false }))
vi.mock('./multi-agent-room', () => ({
  applyRoomMembership: async () => [],
  runAgentRoomDiscussion: vi.fn(),
  shouldRunMultiAgentRoom: () => false,
}))
vi.mock('./team-room-state', () => ({ clearTeamRoomState: () => {} }))
vi.mock('@/hooks/useCopilots', () => ({ getBuiltInCopilotById: () => undefined }))
vi.mock('@/packages/context-management', () => ({ checkSessionOverflowFast: () => ({ isOverflow: false }) }))
vi.mock('@/packages/token', () => ({ estimateTokensFromMessages: () => 0 }))

import { isPlanModeOn } from '@/packages/plan/planSteps'
import { submitNewUserMessage } from './messages'
import { setChatPlanMode } from './plan-mode'

const userMessage = (text: string): Message => ({
  id: `u-${text}`,
  role: 'user',
  contentParts: [{ type: 'text', text }],
})

beforeEach(() => {
  h.sessions.clear()
  h.generate.mockClear()
})

describe('plan mode setting', () => {
  test('setChatPlanMode writes session.settings.planMode and keeps the other settings', async () => {
    h.sessions.set('s1', {
      id: 's1',
      name: 'Docs',
      agentMode: true,
      settings: { provider: 'openai', modelId: 'gpt', temperature: 0.3 },
      messages: [],
    })
    await setChatPlanMode('s1', true)
    expect(h.sessions.get('s1')?.settings).toEqual({
      provider: 'openai',
      modelId: 'gpt',
      temperature: 0.3,
      planMode: true,
    })
    // The legacy top-level field is never written.
    expect(h.sessions.get('s1')?.planMode).toBeUndefined()
    await setChatPlanMode('s1', false)
    expect(h.sessions.get('s1')?.settings).toEqual({
      provider: 'openai',
      modelId: 'gpt',
      temperature: 0.3,
      planMode: false,
    })
  })

  test('isPlanModeOn needs agent mode', () => {
    expect(isPlanModeOn({ agentMode: true, settings: { planMode: true } })).toBe(true)
    expect(isPlanModeOn({ agentMode: false, settings: { planMode: true } })).toBe(false)
    expect(isPlanModeOn({ agentMode: undefined, settings: { planMode: true } })).toBe(false)
    expect(isPlanModeOn({ agentMode: true, settings: { planMode: false } })).toBe(false)
    expect(isPlanModeOn({ agentMode: true, settings: undefined })).toBe(false)
  })

  test('a send in plan mode sets planPhase planning from session settings', async () => {
    h.sessions.set('s1', {
      id: 's1',
      name: 'Docs',
      type: 'chat',
      agentMode: true,
      settings: { provider: 'openai', modelId: 'gpt', planMode: true },
      messages: [],
    })
    await submitNewUserMessage('s1', { newUserMsg: userMessage('Tidy the docs'), needGenerating: true })
    expect(h.sessions.get('s1')?.planPhase).toBe('planning')
    expect(h.generate).toHaveBeenCalledTimes(1)
    const opts = h.generate.mock.calls[0][2] as { prefetchedSession?: Session }
    expect(opts.prefetchedSession?.planPhase).toBe('planning')
  })
})
