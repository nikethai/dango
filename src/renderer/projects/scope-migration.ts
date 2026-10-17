import type { Folder, Project } from '@shared/types'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { v4 as uuidv4 } from 'uuid'
import { folderToProject, type MigrateStore, projectToFolder } from './project-migration'
import { parseScopes } from './scope-store'

const MyFolders = 'myFolders'
const MyProjects = 'myProjects'
const ChatSessionsList = 'chat-sessions-list'

/** Remembers the replacement id so a crash mid-migration reuses it instead of orphaning moved chats. */
export const SCOPE_MIGRATION_EVERYWHERE_ID_KEY = 'scopeMigrationEverywhereId'

type SessionLike = { id?: string; projectId?: string; folderId?: string }

function retarget<T extends SessionLike>(item: T, newId: string): T {
  if (item.projectId !== EVERYWHERE_SCOPE_ID && item.folderId !== EVERYWHERE_SCOPE_ID) return item
  return {
    ...item,
    ...(item.projectId === EVERYWHERE_SCOPE_ID ? { projectId: newId } : {}),
    ...(item.folderId === EVERYWHERE_SCOPE_ID ? { folderId: newId } : {}),
  }
}

/**
 * Writes `kind` on every stored project and keeps `myFolders` mirrored. A project that happens to be
 * called `everywhere` collides with the reserved scope id, so it gets a new id and its chats follow.
 * Idempotent: a second run writes identical data.
 */
export async function runScopeMigration(store: MigrateStore): Promise<{ renamedEverywhere: boolean }> {
  let raw = (await store.getData<unknown[]>(MyProjects, [])) || []
  if (!Array.isArray(raw) || raw.length === 0) {
    const folders = (await store.getData<Folder[]>(MyFolders, [])) || []
    raw = folders.map(folderToProject)
  }

  let renamedEverywhere = false
  const collides = raw.some((p) => (p as { id?: unknown } | null)?.id === EVERYWHERE_SCOPE_ID)
  if (collides) {
    renamedEverywhere = true
    let newId = await store.getData<string>(SCOPE_MIGRATION_EVERYWHERE_ID_KEY, '')
    if (!newId) {
      newId = uuidv4()
      await store.setData(SCOPE_MIGRATION_EVERYWHERE_ID_KEY, newId)
    }

    const list = (await store.getData<SessionLike[]>(ChatSessionsList, [])) || []
    // Destination first: session documents, then the list that points at them.
    for (const meta of list) {
      if (!meta?.id) continue
      const key = `session:${meta.id}`
      const doc = await store.getData<SessionLike | null>(key, null)
      if (doc) {
        const next = retarget(doc, newId)
        if (next !== doc) await store.setData(key, next)
      }
    }
    await store.setData(
      ChatSessionsList,
      list.map((meta) => (meta ? retarget(meta, newId) : meta))
    )
    raw = raw.map((p) =>
      (p as { id?: unknown } | null)?.id === EVERYWHERE_SCOPE_ID ? { ...(p as object), id: newId } : p
    )
  }

  const scopes = parseScopes(raw).map((s) => ({ ...s, kind: s.kind ?? 'project' }))
  await store.setData(MyProjects, scopes)
  await store.setData(
    MyFolders,
    scopes.map((s) => projectToFolder(s as Project))
  )
  return { renamedEverywhere }
}
