import { describe, expect, it } from 'vitest'
import { runScopeMigration, SCOPE_MIGRATION_EVERYWHERE_ID_KEY } from './scope-migration'

function memoryStore(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = structuredClone(initial)
  return {
    data,
    getData: async <T>(key: string, defaultValue: T) => (key in data ? (data[key] as T) : defaultValue),
    setData: async <T>(key: string, value: T) => {
      data[key] = structuredClone(value)
    },
  }
}

describe('runScopeMigration', () => {
  it('writes kind on every stored project', async () => {
    const store = memoryStore({ myProjects: [{ id: 'a', name: 'A', order: 0 }] })
    const res = await runScopeMigration(store)
    expect(res).toEqual({ renamedEverywhere: false })
    expect(store.data.myProjects).toEqual([{ id: 'a', name: 'A', order: 0, kind: 'project' }])
    const folders = store.data.myFolders as Array<Record<string, unknown>>
    expect(folders.map((f) => f.id)).toEqual(['a'])
    expect(folders.every((f) => !('kind' in f))).toBe(true)
  })

  it('builds scopes from folders when myProjects is empty', async () => {
    const store = memoryStore({ myProjects: [], myFolders: [{ id: 'f1', name: 'F', order: 0 }] })
    await runScopeMigration(store)
    expect(store.data.myProjects).toMatchObject([{ id: 'f1', name: 'F', kind: 'project' }])
  })

  it('re-ids a project called everywhere and moves its chats', async () => {
    const store = memoryStore({
      myProjects: [{ id: 'everywhere', name: 'Everywhere', order: 0 }],
      'chat-sessions-list': [
        { id: 's1', projectId: 'everywhere', folderId: 'everywhere' },
        { id: 's2', projectId: 'other' },
      ],
      'session:s1': { id: 's1', projectId: 'everywhere', folderId: 'everywhere', messages: [] },
    })
    const res = await runScopeMigration(store)
    expect(res).toEqual({ renamedEverywhere: true })
    const projects = store.data.myProjects as Array<{ id: string }>
    expect(projects).toHaveLength(1)
    const newId = projects[0].id
    expect(newId).not.toBe('everywhere')
    const list = store.data['chat-sessions-list'] as Array<Record<string, string>>
    expect(list[0]).toMatchObject({ projectId: newId, folderId: newId })
    expect(list[1]).toEqual({ id: 's2', projectId: 'other' })
    expect(store.data['session:s1']).toMatchObject({ projectId: newId, folderId: newId })
    expect((store.data.myFolders as Array<{ id: string }>)[0].id).toBe(newId)
    expect(JSON.stringify(store.data)).not.toContain('"everywhere"')
  })

  it('keeps client kind and readsEverywhere', async () => {
    const readsEverywhere = { facts: false, documents: true }
    const store = memoryStore({ myProjects: [{ id: 'c', name: 'C', order: 0, kind: 'client', readsEverywhere }] })
    await runScopeMigration(store)
    expect(store.data.myProjects).toMatchObject([{ id: 'c', kind: 'client', readsEverywhere }])
  })

  it('running twice changes nothing', async () => {
    const store = memoryStore({
      myProjects: [
        { id: 'everywhere', name: 'E', order: 1 },
        { id: 'b', name: 'B', order: 0, kind: 'client' },
      ],
      'chat-sessions-list': [{ id: 's1', projectId: 'everywhere' }],
      'session:s1': { id: 's1', projectId: 'everywhere' },
    })
    await runScopeMigration(store)
    const first = structuredClone(store.data)
    const res = await runScopeMigration(store)
    expect(res).toEqual({ renamedEverywhere: false })
    expect(store.data).toEqual(first)
  })

  it('reuses the replacement id after an interrupted run', async () => {
    const store = memoryStore({
      myProjects: [{ id: 'everywhere', name: 'E', order: 0 }],
      'chat-sessions-list': [{ id: 's1', projectId: 'everywhere' }],
      'session:s1': { id: 's1', projectId: 'new-id' },
      scopeMigrationEverywhereId: 'new-id',
    })
    await runScopeMigration(store)
    expect((store.data.myProjects as Array<{ id: string }>)[0].id).toBe('new-id')
    expect((store.data['chat-sessions-list'] as Array<{ projectId: string }>)[0].projectId).toBe('new-id')
  })

  it('clears the replacement id after a successful run, and a rerun is still a no-op', async () => {
    const store = memoryStore({
      myProjects: [{ id: 'everywhere', name: 'E', order: 0 }],
      'chat-sessions-list': [{ id: 's1', projectId: 'everywhere' }],
      'session:s1': { id: 's1', projectId: 'everywhere' },
    })
    await runScopeMigration(store)
    expect(store.data[SCOPE_MIGRATION_EVERYWHERE_ID_KEY] ?? '').toBe('')
    const first = structuredClone(store.data)
    const res = await runScopeMigration(store)
    expect(res).toEqual({ renamedEverywhere: false })
    expect(store.data).toEqual(first)
  })

  it('uses removeData to clear the replacement id when the store has it', async () => {
    const base = memoryStore({ myProjects: [{ id: 'everywhere', name: 'E', order: 0 }] })
    const store = {
      ...base,
      removeData: (key: string) => {
        delete base.data[key]
        return Promise.resolve()
      },
    }
    await runScopeMigration(store)
    expect(SCOPE_MIGRATION_EVERYWHERE_ID_KEY in base.data).toBe(false)
  })

  it('clears a replacement id left behind by a run that crashed after writing scopes', async () => {
    const store = memoryStore({
      myProjects: [{ id: 'new-id', name: 'E', order: 0, kind: 'project' }],
      scopeMigrationEverywhereId: 'new-id',
    })
    await runScopeMigration(store)
    expect(store.data[SCOPE_MIGRATION_EVERYWHERE_ID_KEY]).toBe('')
    expect((store.data.myProjects as Array<{ id: string }>)[0].id).toBe('new-id')
  })
})
