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
    getModel: vi.fn((..._args: unknown[]): unknown => ({ isSupportToolUse: () => true })),
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
  getModel: h.getModel,
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
vi.mock('@/packages/model-setting-utils', () => ({ getModelDisplayName: async () => 'Fake model' }))

import { submitNewUserMessage } from './messages'
import { clearSessionGenerationLive, isSessionGenerationLive } from './session-live-generation'

const userMessage = (text: string): Message => ({
  id: `u-${text}`,
  role: 'user',
  contentParts: [{ type: 'text', text }],
})

beforeEach(() => {
  h.sessions.clear()
  h.generate.mockClear()
  h.getModel.mockReset()
  clearSessionGenerationLive('s1')
  h.sessions.set('s1', {
    id: 's1',
    name: 'Chat',
    type: 'chat',
    settings: { provider: 'fake', modelId: 'fake-model' },
    messages: [],
  })
})

describe('a send that fails before the model starts (finding 4)', () => {
  test('drops the live mark, so Stop does not stay next to the error', async () => {
    h.getModel.mockImplementation(() => {
      throw new Error('No model is set up for this.')
    })
    await submitNewUserMessage('s1', { newUserMsg: userMessage('hello'), needGenerating: true })

    expect(h.generate).not.toHaveBeenCalled()
    expect(isSessionGenerationLive('s1')).toBe(false)
    const answer = h.sessions.get('s1')?.messages.at(-1)
    expect(answer?.role).toBe('assistant')
    expect(answer?.generating).toBe(false)
    expect(answer?.error).toContain('No model is set up')
  })

  test('a send that reaches the model keeps the turn live for generate()', async () => {
    h.getModel.mockImplementation(() => ({ isSupportToolUse: () => true }))
    await submitNewUserMessage('s1', { newUserMsg: userMessage('hello'), needGenerating: true })

    expect(h.generate).toHaveBeenCalledTimes(1)
    expect(isSessionGenerationLive('s1')).toBe(true)
  })
})
