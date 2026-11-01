import { settings as getDefaultSettings } from '@shared/defaults'
import type { Session } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory storage: the raw chat list and one key per chat.
const disk = vi.hoisted(() => new Map<string, unknown>())
const state = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  lastUsed: {} as { chat?: { provider: string; modelId: string }; picture?: { provider: string; modelId: string } },
}))
vi.mock('@/storage', () => {
  const storage = {
    getItem: vi.fn((key: string, fallback: unknown) =>
      Promise.resolve(disk.has(key) ? structuredClone(disk.get(key)) : fallback)
    ),
    setItemNow: vi.fn(async (key: string, value: unknown) => {
      disk.set(key, structuredClone(value))
    }),
    removeItem: vi.fn(async (key: string) => {
      disk.delete(key)
    }),
  }
  return { default: storage, StorageKey: { ChatSessionsList: 'chat-sessions-list' } }
})
vi.mock('@/storage/StoreStorage', () => ({ StorageKeyGenerator: { session: (id: string) => `session:${id}` } }))
vi.mock('@/components/chat/MessageList', () => ({ clearScrollPositionCache: vi.fn() }))
vi.mock('./atoms/throttleWriteSessionAtom', () => ({ cleanupSessionAtomCache: vi.fn() }))
vi.mock('./sessionHelpers', () => ({
  getSessionMeta: (s: Session) => ({ id: s.id, name: s.name, type: s.type }),
}))
vi.mock('./settingsStore', () => ({
  settingsStore: { getState: () => ({ getSettings: () => state.settings }) },
  useSettingsStore: vi.fn(),
}))
vi.mock('./lastUsedModelStore', () => ({ lastUsedModelStore: { getState: () => state.lastUsed } }))
vi.mock('./uiStore', () => ({ uiStore: { getState: () => ({}) } }))
vi.mock('../utils/session-utils', () => ({
  migrateSession: (s: Session) => s,
  sortSessions: (list: unknown[]) => list,
}))

import { createSession, getSessionSettings } from './chatStore'

// A custom provider is set up once it lists models; OpenAI once it has a key.
const settingsWith = (opts: { custom?: string[]; openaiKey?: boolean }) => ({
  ...getDefaultSettings(),
  customProviders: (opts.custom ?? []).map((id) => ({ id, name: id, type: 'openai', isCustom: true })),
  providers: {
    ...Object.fromEntries((opts.custom ?? []).map((id) => [id, { models: [{ modelId: 'm1' }] }])),
    ...(opts.openaiKey ? { openai: { apiKey: 'test-key', models: [{ modelId: 'gpt-4o' }] } } : {}),
  },
})

const stored = (id: string, settings: Session['settings'], type: Session['type'] = 'chat') => {
  disk.set(`session:${id}`, { id, name: id, type, messages: [], settings })
  return id
}

beforeEach(() => {
  disk.clear()
  disk.set('chat-sessions-list', [])
  state.lastUsed = {}
  state.settings = settingsWith({ custom: ['custom-provider-a'] })
})

describe('a chat saved without a model', () => {
  it('gets no model filled in, so it never sends to OpenAI', async () => {
    const settings = await getSessionSettings(stored('s1', {}))
    expect(settings.provider).toBeUndefined()
    expect(settings.modelId).toBeUndefined()
  })

  it('keeps the model saved with it', async () => {
    const settings = await getSessionSettings(stored('s2', { provider: 'custom-provider-a', modelId: 'm1' }))
    expect(settings).toMatchObject({ provider: 'custom-provider-a', modelId: 'm1' })
  })
})

describe('legacy ChatboxAI chats', () => {
  it('are left without a model when OpenAI is not set up', async () => {
    const settings = await getSessionSettings(stored('s3', { provider: 'chatbox-ai', modelId: 'chatboxai-3.5' }))
    expect(settings.provider).toBeUndefined()
    expect(settings.modelId).toBeUndefined()
  })

  it('move to OpenAI when OpenAI is set up', async () => {
    state.settings = settingsWith({ openaiKey: true })
    const settings = await getSessionSettings(stored('s4', { provider: 'chatbox-ai', modelId: 'chatboxai-3.5' }))
    expect(settings).toMatchObject({ provider: 'openai', modelId: 'gpt-4o' })
  })
})

describe('createSession', () => {
  it('does not copy a last-used model whose provider was removed', async () => {
    state.lastUsed = { chat: { provider: 'custom-provider-gone', modelId: 'm1' } }
    const session = await createSession({ name: 'New', type: 'chat', messages: [] })
    expect(session.settings?.provider).toBeUndefined()
  })

  it('gives a chat created without a model the usable last-used one', async () => {
    state.lastUsed = { chat: { provider: 'custom-provider-a', modelId: 'm1' } }
    const session = await createSession({ name: 'New', type: 'chat', messages: [] })
    expect(session.settings).toMatchObject({ provider: 'custom-provider-a', modelId: 'm1' })
  })

  it('keeps a model the caller chose', async () => {
    state.lastUsed = { chat: { provider: 'custom-provider-a', modelId: 'm1' } }
    const session = await createSession({
      name: 'New',
      type: 'chat',
      messages: [],
      settings: { provider: 'custom-provider-b', modelId: 'x' },
    })
    expect(session.settings).toMatchObject({ provider: 'custom-provider-b', modelId: 'x' })
  })
})
