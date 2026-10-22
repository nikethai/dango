import { describe, expect, it, vi } from 'vitest'

// StoreStorage reaches the platform when it loads; only its key names are used here.
vi.mock('@/platform', () => ({ default: {} }))

import {
  isDeviceOnlyKey,
  omitDeviceOnlyKeys,
  sessionHoldsDeviceOnly,
  settingsExportData,
  settingsImportEntries,
  settingsImportMerge,
} from './exportFilter'
import { StorageKey, StorageKeyGenerator } from './StoreStorage'

const PM_KEYS = [
  StorageKey.PmCursors,
  StorageKey.PmDrafts,
  StorageKey.PmQuestions,
  StorageKey.PmProcessed,
  StorageKey.PmDraftCount,
  StorageKeyGenerator.pmRecords('acme'),
]

describe('settings export filter', () => {
  it('marks every PM pilot key as device-only', () => {
    for (const key of PM_KEYS) expect(isDeviceOnlyKey(key)).toBe(true)
    // Any later pm-* key is covered too.
    for (const key of Object.values(StorageKey).filter((k) => k.startsWith('pm-'))) {
      expect(isDeviceOnlyKey(key)).toBe(true)
    }
  })

  it('keeps ordinary keys', () => {
    for (const key of [StorageKey.Settings, StorageKey.ChatSessionsList, StorageKey.MyProjects, 'session:abc']) {
      expect(isDeviceOnlyKey(key)).toBe(false)
    }
  })

  it('leaves client mail and pilot state out of an export or an import', () => {
    const data: Record<string, unknown> = { [StorageKey.Settings]: { a: 1 }, 'session:s1': { id: 's1' } }
    for (const key of PM_KEYS) data[key] = [{ text: 'client mail' }]
    const result = omitDeviceOnlyKeys(data)
    expect(Object.keys(result).sort()).toEqual(['session:s1', StorageKey.Settings].sort())
    expect(JSON.stringify(result)).not.toContain('client mail')
  })

  it.each(['knowledge', 'knowledge-migration', 'sources', 'pm-records'])('%s never leaves or enters', (key) => {
    expect(isDeviceOnlyKey(key)).toBe(true)
  })

  it('settings and look-alike keys still travel', () => {
    expect(isDeviceOnlyKey('settings')).toBe(false)
    for (const key of ['knowledge-base', 'sources-list', 'knowledges']) expect(isDeviceOnlyKey(key)).toBe(false)
  })
})

describe('importing an old export', () => {
  // The shape an older build wrote: everything `storage.getAll()` returned, including a knowledge document that
  // did not parse (IndexedDB reads it as `null`), the migration record and the connected sources.
  const oldExport = (): Record<string, unknown> => ({
    [StorageKey.Settings]: { language: 'en', providers: {} },
    [StorageKey.ConfigVersion]: 18,
    [StorageKey.ChatSessionsList]: [{ id: 's-old', name: 'Old chat' }],
    'session:s-old': { id: 's-old', name: 'Old chat', messages: [] },
    [StorageKey.Knowledge]: null,
    [StorageKey.KnowledgeMigration]: { state: 'done', at: 1, counts: { everywhere: 9, prompts: 0, leftOut: 0 } },
    [StorageKey.Sources]: { version: 1, sources: [{ id: 'other-device-gmail', kind: 'gmail' }] },
    [StorageKey.PmDrafts]: [{ text: 'client mail' }],
    __exported_items: ['setting', 'conversation'],
    __exported_at: '2026-01-01T00:00:00.000Z',
  })
  const thisDevice = () => ({
    [StorageKey.Knowledge]: { version: 1, items: [{ id: 'mine' }] },
    [StorageKey.KnowledgeMigration]: { state: 'done', at: 5 },
    [StorageKey.Sources]: { version: 1, sources: [{ id: 'my-gmail', kind: 'gmail' }] },
    [StorageKey.ChatSessionsList]: [{ id: 's-mine', name: 'Mine' }],
  })
  const DEVICE_KEYS = [StorageKey.Knowledge, StorageKey.KnowledgeMigration, StorageKey.Sources]

  it('Settings > General writes nothing to knowledge, its migration record or sources', () => {
    const device: Record<string, unknown> = thisDevice()
    // general.tsx writes each entry with setItemNow.
    for (const [key, value] of settingsImportEntries(oldExport())) device[key] = value
    expect(device[StorageKey.Knowledge]).toEqual(thisDevice()[StorageKey.Knowledge])
    expect(device[StorageKey.KnowledgeMigration]).toEqual(thisDevice()[StorageKey.KnowledgeMigration])
    expect(device[StorageKey.Sources]).toEqual(thisDevice()[StorageKey.Sources])
    const written = settingsImportEntries(oldExport()).map(([key]) => key)
    for (const key of DEVICE_KEYS) expect(written).not.toContain(key)
    expect(written.sort()).toEqual(['session:s-old', StorageKey.Settings].sort())
  })

  it('the legacy dialog writes nothing to knowledge, its migration record or sources, not even back', () => {
    // AdvancedSettingTab.tsx passes the merge to setAll, which writes key by key; a key it leaves out is untouched.
    const merged = settingsImportMerge(thisDevice(), oldExport())
    for (const key of DEVICE_KEYS) expect(Object.keys(merged)).not.toContain(key)
    expect(JSON.stringify(merged)).not.toContain('client mail')
    expect(merged[StorageKey.Settings]).toEqual(oldExport()[StorageKey.Settings])
    expect((merged[StorageKey.ChatSessionsList] as { id: string }[]).map((s) => s.id)).toEqual(['s-mine', 's-old'])
  })

  it('an export leaves them out', () => {
    const exported = omitDeviceOnlyKeys({ ...thisDevice(), [StorageKey.Settings]: { language: 'en' } })
    expect(Object.keys(exported).sort()).toEqual([StorageKey.ChatSessionsList, StorageKey.Settings].sort())
  })
})

describe('accounts, Review, jobs and cursors stay on the device (Decision 5)', () => {
  const DEVICE_KEYS = [
    StorageKey.Integrations,
    StorageKey.ReviewEntries,
    StorageKey.BackgroundJobs,
    StorageKeyGenerator.sourceCursor('gmail-1'),
    'source-cursor:folder-2',
  ]

  it.each(DEVICE_KEYS)('%s is device-only', (key) => {
    expect(isDeviceOnlyKey(key)).toBe(true)
  })

  it('imported history and look-alikes still travel', () => {
    for (const key of [StorageKey.ImportedHistory, 'integrations-list', 'review-entries-old', 'source-cursors']) {
      expect(isDeviceOnlyKey(key)).toBe(false)
    }
  })

  const withDeviceKeys = (): Record<string, unknown> => ({
    [StorageKey.Settings]: { language: 'en' },
    [StorageKey.ImportedHistory]: { archives: [{ id: 'a1' }] },
    [StorageKey.Integrations]: [{ id: 'gmail', account: 'me@example.com' }],
    [StorageKey.ReviewEntries]: [{ id: 'r1', text: 'client mail' }],
    [StorageKey.BackgroundJobs]: [{ id: 'j1' }],
    'source-cursor:gmail-1': { historyId: '42' },
  })

  it('an export leaves them out and keeps imported history', () => {
    const exported = omitDeviceOnlyKeys(withDeviceKeys())
    expect(Object.keys(exported).sort()).toEqual([StorageKey.ImportedHistory, StorageKey.Settings].sort())
  })

  it('neither import writes them', () => {
    const written = settingsImportEntries(withDeviceKeys()).map(([key]) => key)
    expect(written.sort()).toEqual([StorageKey.ImportedHistory, StorageKey.Settings].sort())
    const device = { [StorageKey.ReviewEntries]: [{ id: 'mine' }], 'source-cursor:gmail-1': { historyId: '99' } }
    const merged = settingsImportMerge(device, withDeviceKeys())
    for (const key of DEVICE_KEYS) expect(Object.keys(merged)).not.toContain(key)
    expect(merged[StorageKey.ImportedHistory]).toEqual(withDeviceKeys()[StorageKey.ImportedHistory])
  })
})

describe('chats that quote device-only mail', () => {
  const recallPart = {
    type: 'tool-call',
    state: 'result',
    toolCallId: 'c1',
    toolName: 'client_recall',
    args: {},
    result: { localOnly: true, records: [{ text: 'client mail' }] },
  }
  const msg = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    role: 'assistant',
    contentParts: [{ type: 'text', text: id }],
    ...extra,
  })
  const storageDump = (): Record<string, unknown> => ({
    [StorageKey.Settings]: { language: 'en' },
    [StorageKey.ImportedHistory]: { archives: [{ id: 'a1' }] },
    [StorageKey.ChatSessionsList]: [
      { id: 'plain', name: 'Plain' },
      { id: 'recall', name: 'Recall' },
      { id: 'needs-you', name: 'Needs you' },
      { id: 'thread', name: 'Thread' },
      { id: 'fork', name: 'Fork' },
      { id: 'summary', name: 'Summary' },
    ],
    'session:plain': { id: 'plain', name: 'Plain', messages: [msg('hello')] },
    'session:plain:tasks': [{ id: 't1' }],
    'session:recall': { id: 'recall', name: 'Recall', messages: [msg('a', { contentParts: [recallPart] })] },
    'session:recall:tasks': [{ id: 't2' }],
    'session:needs-you': { id: 'needs-you', name: 'Needs you', messages: [msg('q', { pmQuestionId: 'q1' })] },
    'session:thread': {
      id: 'thread',
      name: 'Thread',
      messages: [msg('now')],
      threads: [{ id: 'th1', name: 'Old', createdAt: 1, messages: [msg('old', { contentParts: [recallPart] })] }],
    },
    'session:fork': {
      id: 'fork',
      name: 'Fork',
      messages: [msg('now')],
      messageForksHash: {
        m1: {
          position: 0,
          createdAt: 1,
          lists: [{ id: 'l1', messages: [msg('alt', { contentParts: [recallPart] })] }],
        },
      },
    },
    'session:summary': { id: 'summary', name: 'Summary', messages: [msg('s', { pmLocalOnly: true })] },
  })
  const HOLDING = ['recall', 'needs-you', 'thread', 'fork', 'summary']

  it('are left out by default, with their list entries and task lists', () => {
    const exported = settingsExportData(storageDump(), { includeDeviceOnlyChats: false })
    expect(Object.keys(exported).sort()).toEqual(
      [
        StorageKey.Settings,
        StorageKey.ImportedHistory,
        StorageKey.ChatSessionsList,
        'session:plain',
        'session:plain:tasks',
      ].sort()
    )
    expect((exported[StorageKey.ChatSessionsList] as { id: string }[]).map((s) => s.id)).toEqual(['plain'])
    expect(JSON.stringify(exported)).not.toContain('client mail')
    // Every list entry has its session and every session its list entry.
    const listed = (exported[StorageKey.ChatSessionsList] as { id: string }[]).map((s) => `session:${s.id}`)
    const stored = Object.keys(exported).filter((k) => /^session:[^:]+$/.test(k))
    expect(listed.sort()).toEqual(stored.sort())
  })

  it('are included when the user asks', () => {
    const exported = settingsExportData(storageDump(), { includeDeviceOnlyChats: true })
    for (const id of HOLDING) expect(Object.keys(exported)).toContain(`session:${id}`)
    expect((exported[StorageKey.ChatSessionsList] as unknown[]).length).toBe(6)
    expect(exported['session:recall:tasks']).toEqual([{ id: 't2' }])
    expect(exported[StorageKey.ImportedHistory]).toEqual(storageDump()[StorageKey.ImportedHistory])
  })

  it('device-only keys stay out either way', () => {
    const dump = { ...storageDump(), [StorageKey.ReviewEntries]: [{ text: 'review' }], 'source-cursor:x': {} }
    for (const includeDeviceOnlyChats of [false, true]) {
      const exported = settingsExportData(dump, { includeDeviceOnlyChats })
      expect(Object.keys(exported)).not.toContain(StorageKey.ReviewEntries)
      expect(Object.keys(exported)).not.toContain('source-cursor:x')
    }
  })

  it('the legacy chat-sessions array drops them too', () => {
    const dump: Record<string, unknown> = {
      [StorageKey.ChatSessions]: [
        { id: 'plain', name: 'Plain', messages: [msg('hello')] },
        { id: 'recall', name: 'Recall', messages: [msg('a', { contentParts: [recallPart] })] },
      ],
    }
    const exported = settingsExportData(dump, { includeDeviceOnlyChats: false })
    expect((exported[StorageKey.ChatSessions] as { id: string }[]).map((s) => s.id)).toEqual(['plain'])
  })

  it('sessionHoldsDeviceOnly reads messages, threads and forks', () => {
    const dump = storageDump()
    expect(sessionHoldsDeviceOnly(dump['session:plain'])).toBe(false)
    for (const id of HOLDING) expect(sessionHoldsDeviceOnly(dump[`session:${id}`])).toBe(true)
    expect(sessionHoldsDeviceOnly(null)).toBe(false)
    expect(sessionHoldsDeviceOnly('not a session')).toBe(false)
  })
})

describe('account tokens and sync state stay on the device', () => {
  const KEYS = ['integration-secret:gmail-1', 'integration-secret:asana-2', 'history-sync-state', 'memory-sync-state']
  const dump = (): Record<string, unknown> => ({
    [StorageKey.Settings]: { language: 'en' },
    'integration-secret:gmail-1': { accessToken: 'tok-gmail', refreshToken: 'ref-gmail' },
    'integration-secret:asana-2': { apiToken: 'tok-asana' },
    'history-sync-state': { lastSyncedAt: 5, deviceId: 'this-device' },
    'memory-sync-state': { revision: 3, deviceId: 'this-device' },
  })

  it.each(KEYS)('%s is device-only', (key) => {
    expect(isDeviceOnlyKey(key)).toBe(true)
  })

  it('look-alikes still travel', () => {
    for (const key of [
      'integration-secrets',
      'history-sync-state-old',
      'history-sync',
      'memory-sync-state-old',
      'memory-sync',
    ]) {
      expect(isDeviceOnlyKey(key)).toBe(false)
    }
  })

  it('an export leaves them out whether or not chats are included', () => {
    for (const includeDeviceOnlyChats of [false, true]) {
      const exported = settingsExportData(dump(), { includeDeviceOnlyChats })
      expect(Object.keys(exported)).toEqual([StorageKey.Settings])
      expect(JSON.stringify(exported)).not.toContain('tok-')
    }
  })

  it('neither import writes them', () => {
    expect(settingsImportEntries(dump()).map(([key]) => key)).toEqual([StorageKey.Settings])
    const device = {
      'integration-secret:gmail-1': { accessToken: 'mine' },
      'history-sync-state': { lastSyncedAt: 9 },
      'memory-sync-state': { revision: 7 },
    }
    const merged = settingsImportMerge(device, dump())
    for (const key of KEYS) expect(Object.keys(merged)).not.toContain(key)
  })
})

describe('settingsExportData', () => {
  it('leaves its input unchanged', () => {
    const recall = {
      id: 'a',
      role: 'assistant',
      contentParts: [
        { type: 'tool-call', toolCallId: 'c', toolName: 'client_recall', args: {}, result: { localOnly: true } },
      ],
    }
    const input: Record<string, unknown> = {
      [StorageKey.Settings]: { language: 'en' },
      [StorageKey.ReviewEntries]: [{ id: 'r1' }],
      'integration-secret:gmail-1': { accessToken: 't' },
      [StorageKey.ChatSessionsList]: [{ id: 'p' }, { id: 'r' }],
      [StorageKey.ChatSessions]: [{ id: 'r', messages: [recall] }],
      'session:p': { id: 'p', messages: [] },
      'session:r': { id: 'r', messages: [recall] },
      'session:r:tasks': [{ id: 't' }],
    }
    const before = JSON.stringify(input)
    for (const includeDeviceOnlyChats of [false, true]) settingsExportData(input, { includeDeviceOnlyChats })
    expect(JSON.stringify(input)).toBe(before)
  })
})
