import type { Session, SessionMeta } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import { StorageKey } from '@/storage'
import { exportHistoryTransferFile, importHistoryTransferFile } from './historyTransfer'

vi.mock('@/storage', () => ({
  default: {
    getStorageType: () => 'MOCK',
    getAllKeys: async () => [],
    getItem: async (_key: string, initialValue: unknown) => initialValue,
    setItemNow: async () => undefined,
  },
  StorageKey: {
    ChatSessionsList: 'chat-sessions-list',
    Settings: 'settings',
  },
}))

class MemoryStore {
  private values = new Map<string, unknown>()

  constructor(seed: Record<string, unknown> = {}) {
    for (const [key, value] of Object.entries(seed)) {
      this.values.set(key, value)
    }
  }

  getStorageType() {
    return 'TEST'
  }

  async getAllKeys(): Promise<string[]> {
    return [...this.values.keys()]
  }

  async getItem<T>(key: string, initialValue: T): Promise<T> {
    if (!this.values.has(key)) {
      return initialValue
    }
    return this.values.get(key) as T
  }

  async setItemNow<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value)
  }

  getValue<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined
  }
}

function getSessionStorageKey(sessionId: string) {
  return `session:${sessionId}`
}

function createSession(id: string, name: string, timestamps: number[]): Session {
  return {
    id,
    name,
    type: 'chat',
    messages: timestamps.map((timestamp, index) => ({
      id: `${id}-m-${index}`,
      role: 'user',
      contentParts: [{ type: 'text', text: `${name}-${index}` }],
      timestamp,
    })),
  }
}

function createMeta(session: Session): SessionMeta {
  return {
    id: session.id,
    name: session.name,
    type: session.type,
  }
}

describe('historyTransfer', () => {
  it('exports all sessions from session keys and metadata', async () => {
    const sessionA = createSession('session-a', 'Session A', [100])
    const sessionB = createSession('session-b', 'Session B', [200])

    const store = new MemoryStore({
      [StorageKey.ChatSessionsList]: [createMeta(sessionA)],
      [getSessionStorageKey(sessionA.id)]: sessionA,
      [getSessionStorageKey(sessionB.id)]: sessionB,
    })

    const result = await exportHistoryTransferFile(store as never)
    const payload = JSON.parse(result.content) as { sessions: Session[]; sessionMetaList: SessionMeta[] }

    expect(result.sessionCount).toBe(2)
    expect(payload.sessions.map((session) => session.id)).toEqual(['session-a', 'session-b'])
    expect(payload.sessionMetaList.map((session) => session.id)).toEqual(['session-a', 'session-b'])
  })

  it('leaves out chats that quote device-only mail unless asked to include them', async () => {
    const plain = createSession('plain', 'Plain', [100])
    const mail = createSession('mail', 'Mail', [200])
    mail.messages.push({ id: 'mail-a', role: 'assistant', contentParts: [], pmLocalOnly: true })
    const store = new MemoryStore({
      [StorageKey.ChatSessionsList]: [createMeta(plain), createMeta(mail)],
      [getSessionStorageKey(plain.id)]: plain,
      [getSessionStorageKey(mail.id)]: mail,
    })
    const ids = (content: string) => {
      const payload = JSON.parse(content) as { sessions: Session[]; sessionMetaList: SessionMeta[] }
      return [payload.sessions.map((s) => s.id), payload.sessionMetaList.map((s) => s.id)]
    }

    const without = await exportHistoryTransferFile(store as never, { includeDeviceOnlyChats: false })
    expect(without.sessionCount).toBe(1)
    expect(ids(without.content)).toEqual([['plain'], ['plain']])

    const withThem = await exportHistoryTransferFile(store as never, { includeDeviceOnlyChats: true })
    expect(ids(withThem.content)).toEqual([
      ['plain', 'mail'],
      ['plain', 'mail'],
    ])
  })

  it('imports from legacy backup format that contains session:* keys', async () => {
    const incoming = createSession('legacy-session', 'Legacy Session', [123])
    const fileText = JSON.stringify({
      [StorageKey.ChatSessionsList]: [createMeta(incoming)],
      [getSessionStorageKey(incoming.id)]: incoming,
      [StorageKey.Settings]: { language: 'en' },
    })

    const store = new MemoryStore()
    const result = await importHistoryTransferFile(fileText, store as never)

    expect(result).toEqual({
      totalIncoming: 1,
      imported: 1,
      updated: 0,
      skipped: 0,
    })
    expect(store.getValue<Session>(getSessionStorageKey(incoming.id))?.name).toBe('Legacy Session')
    expect(store.getValue<SessionMeta[]>(StorageKey.ChatSessionsList)?.map((session) => session.id)).toEqual([
      'legacy-session',
    ])
  })

  it('keeps newer local sessions and updates when incoming is newer', async () => {
    const localNewest = createSession('same-session', 'Local', [200])
    const incomingOlder = createSession('same-session', 'Incoming Older', [150])
    const incomingNewer = createSession('same-session', 'Incoming Newer', [300])
    const incomingNew = createSession('new-session', 'New Session', [250])

    const store = new MemoryStore({
      [StorageKey.ChatSessionsList]: [createMeta(localNewest)],
      [getSessionStorageKey(localNewest.id)]: localNewest,
    })

    const firstImport = await importHistoryTransferFile(
      JSON.stringify({
        __type: 'chatbox-history-transfer',
        __version: 1,
        sessions: [incomingOlder, incomingNew],
      }),
      store as never
    )

    expect(firstImport).toEqual({
      totalIncoming: 2,
      imported: 1,
      updated: 0,
      skipped: 1,
    })
    expect(store.getValue<Session>(getSessionStorageKey(localNewest.id))?.name).toBe('Local')

    const secondImport = await importHistoryTransferFile(
      JSON.stringify({
        __type: 'chatbox-history-transfer',
        __version: 1,
        sessions: [incomingNewer],
      }),
      store as never
    )

    expect(secondImport).toEqual({
      totalIncoming: 1,
      imported: 0,
      updated: 1,
      skipped: 0,
    })
    expect(store.getValue<Session>(getSessionStorageKey(localNewest.id))?.name).toBe('Incoming Newer')
  })

  it('export excludes API keys, passphrase, and knowledge-base data', async () => {
    const session = createSession('session-a', 'Session A', [100])
    const store = new MemoryStore({
      [StorageKey.ChatSessionsList]: [createMeta(session)],
      [getSessionStorageKey(session.id)]: session,
      [StorageKey.Settings]: {
        licenseKey: 'secret-license',
        providers: { openai: { apiKey: 'sk-secret-key' } },
        extension: {
          historySync: { passphrase: 'super-secret-passphrase' },
          knowledgeBase: { models: { embedding: { modelId: 'emb', providerId: 'p' } } },
        },
      },
      'kb:embeddings:foo': { vectors: [0.1, 0.2, 0.3] },
    })

    const result = await exportHistoryTransferFile(store as never)
    const payload = JSON.parse(result.content) as {
      __type: string
      sessions: Session[]
      sessionMetaList: SessionMeta[]
    }

    expect(payload.__type).toBe('chatbox-history-transfer')
    expect(payload.sessions.map((item) => item.id)).toEqual(['session-a'])
    expect(result.content).not.toContain('sk-secret-key')
    expect(result.content).not.toContain('super-secret-passphrase')
    expect(result.content).not.toContain('secret-license')
    expect(result.content).not.toContain('kb:embeddings')
    expect(result.content).not.toContain('knowledgeBase')
    expect(payload).not.toHaveProperty('settings')
    expect(payload).not.toHaveProperty('passphrase')
  })
})
