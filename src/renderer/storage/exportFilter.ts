import uniqBy from 'lodash/uniqBy'
import { chatHoldsLocalOnly } from '@/packages/pm-pilot/local-only-chat'
import { StorageKey } from './StoreStorage'

/*
 * Keys that stay on this device. A settings export leaves them out, and an import never writes them, so an old
 * export that still holds them (even as `null`) leaves this device's copy untouched:
 * - the PM pilot's client mail, Asana records, drafts, questions and cursors (`pm-*`, `pm:records:*`; maintainer
 *   ruling, slice 10);
 * - approved knowledge, its migration record and connected sources (`knowledge`, `knowledge-migration`,
 *   `sources`). OKF import (ADR 0014) is how knowledge comes in, as proposals;
 * - connected accounts, Review entries, background jobs and source sync cursors (`integrations`, `review-entries`,
 *   `background-jobs`, `source-cursor:*`; Decision 5, ADR 0016). Imported history still travels;
 * - connected-account tokens where no keychain holds them (`integration-secret:*`, `packages/integrations/
 *   secret-store.ts`; web, mobile and the desktop fallback), whatever the API Keys box says;
 * - this device's history sync state (`history-sync-state`, `stores/historySync.ts`).
 * Chats that quote device-only mail are a separate, opt-in choice: see `settingsExportData`.
 */

const DEVICE_ONLY_KEYS: ReadonlySet<string> = new Set([
  StorageKey.Knowledge,
  StorageKey.KnowledgeMigration,
  StorageKey.Sources,
  StorageKey.Integrations,
  StorageKey.ReviewEntries,
  StorageKey.BackgroundJobs,
  'history-sync-state',
])

const DEVICE_ONLY_PREFIXES = ['pm-', 'pm:', 'source-cursor:', 'integration-secret:'] as const

export function isDeviceOnlyKey(key: string): boolean {
  return DEVICE_ONLY_PREFIXES.some((prefix) => key.startsWith(prefix)) || DEVICE_ONLY_KEYS.has(key)
}

/** A copy of `data` without the device-only keys. */
export function omitDeviceOnlyKeys<T>(data: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(data).filter(([key]) => !isDeviceOnlyKey(key)))
}

type MessagesLike = Parameters<typeof chatHoldsLocalOnly>[0]

function messagesOf(value: unknown): MessagesLike {
  return Array.isArray(value) ? (value.filter((m) => typeof m === 'object' && m !== null) as MessagesLike) : []
}

/**
 * True when a stored session holds text a local model read from device-only mail or tasks (`chatHoldsLocalOnly`)
 * in its messages, any thread or any fork. Anything that is not a session object reads as false.
 */
export function sessionHoldsDeviceOnly(session: unknown): boolean {
  if (typeof session !== 'object' || session === null) return false
  const s = session as { messages?: unknown; threads?: unknown; messageForksHash?: unknown }
  if (chatHoldsLocalOnly(messagesOf(s.messages))) return true
  if (Array.isArray(s.threads)) {
    for (const thread of s.threads) {
      if (chatHoldsLocalOnly(messagesOf((thread as { messages?: unknown } | null)?.messages))) return true
    }
  }
  if (typeof s.messageForksHash === 'object' && s.messageForksHash !== null) {
    for (const fork of Object.values(s.messageForksHash)) {
      const lists = (fork as { lists?: unknown } | null)?.lists
      if (!Array.isArray(lists)) continue
      for (const list of lists) {
        if (chatHoldsLocalOnly(messagesOf((list as { messages?: unknown } | null)?.messages))) return true
      }
    }
  }
  return false
}

const SESSION_KEY = /^session:([^:]+)$/

/**
 * What a settings export starts from (both export screens): every stored entry except the device-only keys and,
 * unless `includeDeviceOnlyChats`, the chats that quote device-only mail. An omitted chat goes with its task list
 * and its entry in the chat list (and the legacy `chat-sessions` array), so the file has no dangling entries.
 */
export function settingsExportData<T>(
  all: Record<string, T>,
  opts: { includeDeviceOnlyChats: boolean }
): Record<string, T> {
  const data = omitDeviceOnlyKeys(all)
  if (opts.includeDeviceOnlyChats) return data
  const omitted = new Set<string>()
  for (const [key, value] of Object.entries(data)) {
    const id = SESSION_KEY.exec(key)?.[1]
    if (id !== undefined && sessionHoldsDeviceOnly(value)) omitted.add(id)
  }
  const legacy = data[StorageKey.ChatSessions] as unknown
  if (Array.isArray(legacy)) {
    for (const session of legacy) {
      const id = (session as { id?: unknown } | null)?.id
      if (typeof id === 'string' && sessionHoldsDeviceOnly(session)) omitted.add(id)
    }
  }
  if (omitted.size === 0) return data
  const isOmitted = (entry: unknown) => {
    const id = (entry as { id?: unknown } | null)?.id
    return typeof id === 'string' && omitted.has(id)
  }
  const result: Record<string, T> = {}
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('session:') && omitted.has(key.slice('session:'.length).split(':')[0])) continue
    if ((key === StorageKey.ChatSessionsList || key === StorageKey.ChatSessions) && Array.isArray(value)) {
      result[key] = value.filter((entry) => !isOmitted(entry)) as T
      continue
    }
    result[key] = value
  }
  return result
}

/**
 * What Settings > General's import writes, key by key: every entry except the chat list (merged separately),
 * the config version, `__` export metadata and the device-only keys.
 */
export function settingsImportEntries(importData: Record<string, unknown>): [string, unknown][] {
  return Object.entries(importData).filter(
    ([key]) =>
      key !== StorageKey.ChatSessionsList &&
      key !== StorageKey.ConfigVersion &&
      !key.startsWith('__') &&
      !isDeviceOnlyKey(key)
  )
}

/**
 * What the legacy import dialog hands to `setAll` (which writes key by key): this device's values overlaid with
 * the import, chat lists merged. Device-only keys are left out of both sides, so `setAll` never touches them, not
 * even to write this device's own value back (a corrupt document would come back as `null`).
 */
export function settingsImportMerge(
  previousData: Record<string, unknown>,
  importData: Record<string, unknown>
): Record<string, unknown> {
  const list = (data: Record<string, unknown>) => {
    const value = data[StorageKey.ChatSessionsList]
    return Array.isArray(value) ? value : []
  }
  return {
    ...omitDeviceOnlyKeys(previousData),
    ...omitDeviceOnlyKeys(importData),
    [StorageKey.ChatSessionsList]: uniqBy([...list(previousData), ...list(importData)], 'id'),
  }
}
