import { SessionMetaSchema, SessionSchema, type Session, type SessionMeta } from '@shared/types'
import dayjs from 'dayjs'
import uniqBy from 'lodash/uniqBy'
import storage, { StorageKey } from '@/storage'
import { sessionHoldsDeviceOnly } from '@/storage/exportFilter'
import { migrateSession } from '@/utils/session-utils'

export const HISTORY_TRANSFER_MAGIC = 'chatbox-history-transfer'
export const HISTORY_TRANSFER_VERSION = 1

type HistoryTransferPayload = {
  __type: typeof HISTORY_TRANSFER_MAGIC
  __version: typeof HISTORY_TRANSFER_VERSION
  __exported_at: string
  __storage_type?: string
  sessionMetaList: SessionMeta[]
  sessions: Session[]
}

type HistoryTransferImportResult = {
  totalIncoming: number
  imported: number
  updated: number
  skipped: number
}

type HistoryTransferStorage = Pick<typeof storage, 'getAllKeys' | 'getItem' | 'setItemNow' | 'getStorageType'>

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSessionStorageKey(key: string) {
  return key.startsWith('session:')
}

function getSessionStorageKey(sessionId: string) {
  return `session:${sessionId}`
}

function parseJsonStringMaybe(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function parseSession(value: unknown): Session | null {
  const parsed = SessionSchema.safeParse(value)
  if (!parsed.success) {
    return null
  }
  return migrateSession(parsed.data)
}

function parseSessionMetaList(value: unknown): SessionMeta[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((meta) => SessionMetaSchema.safeParse(meta))
    .filter((result) => result.success)
    .map((result) => result.data)
}

function stripPrivilegedWorkspace(session: Session): Session {
  const { workspaceRoot: _workspaceRoot, ...rest } = session
  return rest
}

function getSessionMeta(session: Session): SessionMeta {
  return SessionMetaSchema.parse({
    id: session.id,
    name: session.name,
    starred: session.starred,
    hidden: session.hidden,
    folderId: session.folderId,
    projectId: session.projectId || session.folderId,
    tags: session.tags,
    archived: session.archived,
    assistantAvatarKey: session.assistantAvatarKey,
    picUrl: session.picUrl,
    type: session.type,
  })
}

function getMessageCount(session: Session): number {
  return session.messages.length + (session.threads?.reduce((sum, thread) => sum + thread.messages.length, 0) || 0)
}

function getLatestActivityTimestamp(session: Session): number {
  let latest = 0
  const checkTimestamp = (value?: number) => {
    if (typeof value === 'number' && value > latest) {
      latest = value
    }
  }

  for (const message of session.messages) {
    checkTimestamp(message.timestamp)
    checkTimestamp(message.updatedAt)
  }
  for (const thread of session.threads || []) {
    checkTimestamp(thread.createdAt)
    for (const message of thread.messages) {
      checkTimestamp(message.timestamp)
      checkTimestamp(message.updatedAt)
    }
  }
  return latest
}

function shouldReplaceExistingSession(existing: Session, incoming: Session): boolean {
  const existingLatest = getLatestActivityTimestamp(existing)
  const incomingLatest = getLatestActivityTimestamp(incoming)
  if (incomingLatest !== existingLatest) {
    return incomingLatest > existingLatest
  }

  const existingMessageCount = getMessageCount(existing)
  const incomingMessageCount = getMessageCount(incoming)
  if (incomingMessageCount !== existingMessageCount) {
    return incomingMessageCount > existingMessageCount
  }

  const existingSize = JSON.stringify(existing).length
  const incomingSize = JSON.stringify(incoming).length
  return incomingSize > existingSize
}

async function collectSessionsFromStorage(store: HistoryTransferStorage): Promise<Session[]> {
  const allKeys = await store.getAllKeys()
  const keySet = new Set(allKeys.filter(isSessionStorageKey))

  const sessionMetaList = await store.getItem<SessionMeta[]>(StorageKey.ChatSessionsList, [])
  for (const meta of parseSessionMetaList(sessionMetaList)) {
    keySet.add(getSessionStorageKey(meta.id))
  }

  const sessions: Session[] = []
  for (const key of keySet) {
    const raw = await store.getItem<unknown | null>(key, null)
    if (!raw) {
      continue
    }
    const parsedSession = parseSession(raw)
    if (parsedSession) {
      sessions.push(parsedSession)
    }
  }

  return uniqBy(sessions, (session) => session.id)
}

function buildPayload(sessions: Session[], store: HistoryTransferStorage): HistoryTransferPayload {
  const sortedSessions = [...sessions].sort((a, b) => getLatestActivityTimestamp(a) - getLatestActivityTimestamp(b))
  const sessionMetaList = sortedSessions.map(getSessionMeta)
  return {
    __type: HISTORY_TRANSFER_MAGIC,
    __version: HISTORY_TRANSFER_VERSION,
    __exported_at: new Date().toISOString(),
    __storage_type: store.getStorageType(),
    sessionMetaList,
    sessions: sortedSessions.map(stripPrivilegedWorkspace),
  }
}

function parsePayload(input: unknown): { sessions: Session[]; sessionMetaList: SessionMeta[] } {
  if (!isObject(input)) {
    throw new Error('Invalid history file: root must be an object')
  }

  const parsedInput = parseJsonStringMaybe(input)
  if (!isObject(parsedInput)) {
    throw new Error('Invalid history file: unsupported data format')
  }

  // Dedicated history transfer format
  if (parsedInput.__type === HISTORY_TRANSFER_MAGIC && Array.isArray(parsedInput.sessions)) {
    const sessions = uniqBy(
      parsedInput.sessions
        .map((session) => parseSession(parseJsonStringMaybe(session)))
        .filter((session): session is Session => !!session),
      (session) => session.id
    )
    const sessionMetaList = parseSessionMetaList(parsedInput.sessionMetaList)
    return { sessions, sessionMetaList }
  }

  // Backward-compatible fallback: parse full data-backup exports that contain session:* keys.
  const sessionValuesFromKeys = Object.entries(parsedInput)
    .filter(([key]) => isSessionStorageKey(key))
    .map(([, value]) => parseJsonStringMaybe(value))
  const explicitSessions = Array.isArray(parsedInput.sessions)
    ? parsedInput.sessions.map((session) => parseJsonStringMaybe(session))
    : []

  const sessions = uniqBy(
    [...sessionValuesFromKeys, ...explicitSessions]
      .map((session) => parseSession(session))
      .filter((session): session is Session => !!session),
    (session) => session.id
  )

  const sessionMetaList = parseSessionMetaList(
    Array.isArray(parsedInput.sessionMetaList) ? parsedInput.sessionMetaList : parsedInput[StorageKey.ChatSessionsList]
  )

  if (sessions.length === 0) {
    throw new Error('No valid chat history found in the selected file')
  }

  return { sessions, sessionMetaList }
}

function mergeSessionMetaList(options: {
  existingMetaList: SessionMeta[]
  importedSessions: Session[]
  updatedSessions: Session[]
  fallbackMetaList: SessionMeta[]
}): SessionMeta[] {
  const dedupedExisting = uniqBy(options.existingMetaList, 'id')
  const existingIds = new Set(dedupedExisting.map((meta) => meta.id))
  const importedMetaById = new Map<string, SessionMeta>()

  for (const session of [...options.importedSessions, ...options.updatedSessions]) {
    importedMetaById.set(session.id, getSessionMeta(session))
  }
  for (const meta of options.fallbackMetaList) {
    if (!importedMetaById.has(meta.id)) {
      importedMetaById.set(meta.id, meta)
    }
  }

  // Only use imported metadata for sessions that were actually imported or updated.
  // Skipped (duplicate) sessions keep their local metadata to avoid clobbering
  // folder, archive, tags, and other organization fields.
  const updatedIds = new Set([...options.importedSessions, ...options.updatedSessions].map((s) => s.id))
  const merged = dedupedExisting.map((meta) =>
    updatedIds.has(meta.id) ? importedMetaById.get(meta.id) || meta : meta
  )

  const newSessions = [...options.importedSessions, ...options.updatedSessions]
    .filter((session) => !existingIds.has(session.id))
    .sort((a, b) => getLatestActivityTimestamp(a) - getLatestActivityTimestamp(b))

  for (const session of newSessions) {
    merged.push(getSessionMeta(session))
    existingIds.add(session.id)
  }

  return uniqBy(merged, 'id')
}

/**
 * Builds the transfer file. History sync passes no options and uploads every chat; the file export leaves out chats that quote
 * device-only mail unless `includeDeviceOnlyChats` (ADR 0003).
 */
export async function exportHistoryTransferFile(
  store: HistoryTransferStorage = storage,
  opts: { includeDeviceOnlyChats?: boolean } = {}
): Promise<{
  fileName: string
  content: string
  sessionCount: number
}> {
  const all = await collectSessionsFromStorage(store)
  const sessions = opts.includeDeviceOnlyChats === false ? all.filter((s) => !sessionHoldsDeviceOnly(s)) : all
  const payload = buildPayload(sessions, store)
  const dateStr = dayjs().format('YYYY-M-D')
  return {
    fileName: `chatbox-history-transfer-${dateStr}.json`,
    content: JSON.stringify(payload),
    sessionCount: sessions.length,
  }
}

export async function importHistoryTransferFile(
  content: string,
  store: HistoryTransferStorage = storage
): Promise<HistoryTransferImportResult> {
  const parsedJson = JSON.parse(content)
  const { sessions: incomingSessions, sessionMetaList: incomingMetaList } = parsePayload(parsedJson)

  const existingSessions = await collectSessionsFromStorage(store)
  const existingSessionMap = new Map(existingSessions.map((session) => [session.id, session]))

  const importedSessions: Session[] = []
  const updatedSessions: Session[] = []
  let skipped = 0

  for (const incomingSession of incomingSessions) {
    const existingSession = existingSessionMap.get(incomingSession.id)
    if (!existingSession) {
      importedSessions.push(incomingSession)
      existingSessionMap.set(incomingSession.id, incomingSession)
      continue
    }

    if (shouldReplaceExistingSession(existingSession, incomingSession)) {
      updatedSessions.push(incomingSession)
      existingSessionMap.set(incomingSession.id, incomingSession)
    } else {
      skipped++
    }
  }

  for (const session of [...importedSessions, ...updatedSessions]) {
    await store.setItemNow(getSessionStorageKey(session.id), session)
  }

  const existingMetaList = parseSessionMetaList(await store.getItem<SessionMeta[]>(StorageKey.ChatSessionsList, []))
  const mergedMetaList = mergeSessionMetaList({
    existingMetaList,
    importedSessions,
    updatedSessions,
    fallbackMetaList: incomingMetaList,
  })
  await store.setItemNow(StorageKey.ChatSessionsList, mergedMetaList)

  return {
    totalIncoming: incomingSessions.length,
    imported: importedSessions.length,
    updated: updatedSessions.length,
    skipped,
  }
}
