import type { KnowledgeState } from '@shared/types/knowledge'
import type { MemoryBank, MemoryEntry } from '@shared/types/memory'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isLegacyMemoryActive } from './for-turn'
import { applyMemoryMigration, loadMigrationRows, loadMigrationState, planMemoryMigration } from './migration'
import { _resetKnowledgeForTests, commitKnowledge, knowledgeStore } from './store'
import { getRaw, putRaw, resetTestStorage, testStorage } from './test-storage'
import { contentHash } from './text'

vi.mock('@/storage', async () => (await import('./test-storage')).default)

const banks = vi.hoisted(() => ({
  global: null as MemoryBank | null,
  agents: [] as Array<{ agentId: string; bank: MemoryBank }>,
}))

const legacy = vi.hoisted(() => ({ enabled: true }))
vi.mock('@/stores/memoryStore', () => ({
  memoryStore: { getState: () => ({ settings: { enabled: legacy.enabled } }) },
}))
vi.mock('@/packages/review', () => ({ addReviewEntry: vi.fn() }))
vi.mock('i18next', () => ({ t: (key: string) => key }))

vi.mock('@/hooks/useCopilots', async () => {
  const { atom } = await import('jotai')
  const builtIns: Record<string, { id: string; name: string; prompt: string; builtIn: true; usedCount: number }> = {
    'builtin:task-planner': {
      id: 'builtin:task-planner',
      name: 'Task Planner',
      prompt: 'Plan.',
      builtIn: true,
      usedCount: 0,
    },
  }
  return {
    myCopilotsAtom: atom<unknown[]>([]),
    getBuiltInCopilotById: (id: string) => builtIns[id],
  }
})

vi.mock('@/stores/queryClient', () => ({
  default: {
    getQueriesData: () => [[['remote-copilots', 'en'], [{ id: 'remote-1', name: 'Remote Helper', prompt: 'Hi.' }]]],
  },
}))

const MEMORY_GLOBAL = 'memory-bank-global'

/** Writes the fixture banks as raw storage values, as the old memory store keeps them. */
function saveBanks() {
  if (banks.global) putRaw(MEMORY_GLOBAL, banks.global)
  for (const { agentId, bank } of banks.agents) putRaw(`memory:agent:${agentId}`, bank)
}

function entry(id: string, content: string, over: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id,
    content,
    tags: [],
    scope: 'global',
    source: 'user',
    enabled: true,
    pinned: false,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

function bank(entries: MemoryEntry[], agentId?: string): MemoryBank {
  return {
    scope: agentId ? 'agent' : 'global',
    ...(agentId ? { agentId } : {}),
    entries: entries.map((e) => (agentId ? { ...e, scope: 'agent' as const, agentId } : e)),
    profileSummary: '',
    version: 1,
  }
}

const PLANNER = { id: 'planner', name: 'Planner', prompt: 'You plan trips.', usedCount: 0 }

function knowledge(): KnowledgeState {
  return getRaw<KnowledgeState>('knowledge') ?? ({ items: [] } as unknown as KnowledgeState)
}
function copilots() {
  return getRaw<Array<{ id: string; prompt: string }>>('myCopilots') ?? []
}

beforeEach(async () => {
  const { getDefaultStore } = await import('jotai')
  const { myCopilotsAtom } = await import('@/hooks/useCopilots')
  getDefaultStore().set(myCopilotsAtom as never, [] as never)
  resetTestStorage()
  _resetKnowledgeForTests()
  banks.global = null
  banks.agents = []
  legacy.enabled = true
  putRaw('myCopilots', [PLANNER, { id: 'builtin:task-planner', name: 'Task Planner', prompt: 'Override.' }])
})

const describeAgent = (id: string) =>
  id === 'planner' ? { name: 'Planner', editable: true } : { name: 'Task Planner', editable: false }

describe('planMemoryMigration', () => {
  it('defaults per group and kind from tags', () => {
    const rows = planMemoryMigration({
      global: bank([
        entry('g1', 'Prefers metric units', { tags: ['Preference'] }),
        entry('g2', 'Short answers', { tags: ['pref'] }),
        entry('g3', 'We chose Postgres', { tags: ['decision'] }),
        entry('g4', 'Lives in Hanoi', { tags: ['place'] }),
      ]),
      agents: [{ agentId: 'planner', bank: bank([entry('a1', 'Window seats', { sourceSessionId: 's9' })], 'planner') }],
      describeAgent,
    })
    expect(rows.map((r) => [r.entryId, r.kind, r.choice])).toEqual([
      ['g1', 'preference', 'everywhere'],
      ['g2', 'preference', 'everywhere'],
      ['g3', 'decision', 'everywhere'],
      ['g4', 'fact', 'everywhere'],
      ['a1', 'fact', 'agent-prompt'],
    ])
    expect(rows[4].group).toEqual({ scope: 'agent', agentId: 'planner', agentName: 'Planner', promptEditable: true })
    expect(rows[4].sourceSessionId).toBe('s9')
  })

  it('deleted entries are skipped, disabled ones default to leave out', () => {
    const rows = planMemoryMigration({
      global: bank([
        entry('g1', 'Gone', { deleted: true }),
        entry('g2', 'Off', { enabled: false }),
        entry('g3', 'Archived', { archived: true }),
        entry('g4', '   '),
        entry('g5', 'Live'),
      ]),
      agents: [],
      describeAgent,
    })
    expect(rows.map((r) => [r.entryId, r.choice])).toEqual([
      ['g2', 'leave-out'],
      ['g3', 'leave-out'],
      ['g5', 'everywhere'],
    ])
  })

  it('built-in agent falls back to Everywhere', async () => {
    banks.agents = [
      { agentId: 'builtin:task-planner', bank: bank([entry('b1', 'Use checklists')], 'builtin:task-planner') },
      { agentId: 'remote-1', bank: bank([entry('r1', 'Be brief')], 'remote-1') },
      { agentId: 'planner', bank: bank([entry('p1', 'Window seats')], 'planner') },
    ]
    saveBanks()
    const rows = await loadMigrationRows()
    const byId = Object.fromEntries(rows.map((r) => [r.entryId, r]))
    expect(byId.b1.choice).toBe('everywhere')
    expect(byId.b1.group).toMatchObject({ agentName: 'Task Planner', promptEditable: false })
    expect(byId.r1.choice).toBe('everywhere')
    expect(byId.r1.group).toMatchObject({ agentName: 'Remote Helper', promptEditable: false })
    expect(byId.p1.choice).toBe('agent-prompt')

    // Even when a row asks for the prompt, a built-in or remote agent never gets prompt text.
    const forced = rows.map((r) => ({ ...r, choice: 'agent-prompt' as const }))
    const counts = await applyMemoryMigration(forced)
    expect(counts).toEqual({ everywhere: 2, prompts: 1, leftOut: 0 })
    const stored = copilots()
    expect(stored.find((c) => c.id === 'builtin:task-planner')?.prompt).toBe('Override.')
    expect(stored.find((c) => c.id === 'remote-1')).toBeUndefined()
    expect(stored.find((c) => c.id === 'planner')?.prompt).toBe('You plan trips.\n\nStanding notes:\n- Window seats')
    expect(
      knowledge()
        .items.map((i) => i.text)
        .sort()
    ).toEqual(['Be brief', 'Use checklists'])
  })
})

describe('applyMemoryMigration', () => {
  function sampleRows() {
    banks.global = bank([
      entry('g1', 'Prefers metric units', { tags: ['preference'], sourceSessionId: 's1' }),
      entry('g2', 'Lives in Hanoi'),
      entry('g3', 'Old note', { enabled: false }),
    ])
    banks.agents = [
      { agentId: 'planner', bank: bank([entry('a1', 'Window seats'), entry('a2', 'No red-eyes')], 'planner') },
    ]
    saveBanks()
    return loadMigrationRows()
  }

  it('applying twice adds nothing the second time', async () => {
    const rows = await sampleRows()
    expect(await applyMemoryMigration(rows)).toEqual({ everywhere: 2, prompts: 2, leftOut: 1 })
    const items = knowledge().items
    const prompts = copilots()
    expect(items).toHaveLength(2)
    expect(prompts.find((c) => c.id === 'planner')?.prompt).toBe(
      'You plan trips.\n\nStanding notes:\n- Window seats\n- No red-eyes'
    )

    expect(await applyMemoryMigration(rows)).toEqual({ everywhere: 0, prompts: 0, leftOut: 1 })
    expect(knowledge().items).toEqual(items)
    expect(copilots()).toEqual(prompts)
  })

  it("another window's agent edit made during the move survives", async () => {
    const rows = await sampleRows()
    const write = testStorage.setItemNow.getMockImplementation()
    testStorage.setItemNow.mockImplementation(async (key: string, value: unknown) => {
      await write?.(key, value)
      // Another window saves an edit to Planner while the items are being written.
      if (key === 'knowledge') putRaw('myCopilots', [{ ...PLANNER, prompt: 'You plan trips. Edited.' }])
    })
    try {
      await applyMemoryMigration(rows)
    } finally {
      testStorage.setItemNow.mockImplementation(write as never)
    }
    const expected = 'You plan trips. Edited.\n\nStanding notes:\n- Window seats\n- No red-eyes'
    expect(copilots().find((c) => c.id === 'planner')?.prompt).toBe(expected)
  })

  it('a note added while the sheet was open is moved too, and choices are kept', async () => {
    const rows = await sampleRows()
    const chosen = rows.map((r) => (r.entryId === 'g2' ? { ...r, choice: 'leave-out' as const } : r))
    banks.global?.entries.push(entry('g9', 'Drinks tea'))
    saveBanks()
    expect(await applyMemoryMigration(chosen)).toEqual({ everywhere: 2, prompts: 2, leftOut: 2 })
    expect(
      knowledge()
        .items.map((i) => i.text)
        .sort()
    ).toEqual(['Drinks tea', 'Prefers metric units'])
  })

  it('a crash after the items, then Move again, adds no duplicates', async () => {
    const rows = await sampleRows()
    await applyMemoryMigration(rows)
    const items = knowledge().items
    const prompts = copilots()
    // Simulate the crash: the state write never happened.
    await testStorage.removeItem('knowledge-migration')
    testStorage.setItemNow.mockClear()
    _resetKnowledgeForTests()
    expect(await loadMigrationState()).toBe('pending')
    await applyMemoryMigration(await loadMigrationRows())
    expect(knowledge().items).toEqual(items)
    expect(copilots()).toEqual(prompts)
  })

  it('state is written after the items', async () => {
    const rows = await sampleRows()
    testStorage.setItemNow.mockClear()
    await applyMemoryMigration(rows)
    expect(testStorage.setItemNow.mock.calls.map((c) => c[0])).toEqual([
      'knowledge',
      'myCopilots',
      'knowledge-migration',
    ])
    expect(getRaw('knowledge-migration')).toMatchObject({
      state: 'done',
      counts: { everywhere: 2, prompts: 2, leftOut: 1 },
    })
    expect(knowledgeStore.getState().migration).toBe('done')
  })

  it('each moved note has one approved revision by migration whose hash verifies', async () => {
    await applyMemoryMigration(await sampleRows())
    const items = knowledge().items
    for (const item of items) {
      expect(item.scopeId).toBe(EVERYWHERE_SCOPE_ID)
      expect(item.status).toBe('approved')
      expect(item.revisions).toHaveLength(1)
      const [r] = item.revisions
      expect(r).toMatchObject({ id: 'r1', by: 'migration', text: item.text, approval: { by: 'user' } })
      expect(item.approvedRevisionId).toBe('r1')
      expect(r.approval?.contentHash).toBe(await contentHash(item.kind, item.text, item.condition))
      expect(item.history).toEqual([
        expect.objectContaining({ by: 'migration', action: 'approved', note: 'From saved notes' }),
      ])
    }
    const pref = items.find((i) => i.text === 'Prefers metric units')
    expect(pref?.kind).toBe('preference')
    expect(pref?.sources).toEqual([{ id: 's1', kind: 'chat', label: 'Earlier chat', ref: 's1' }])
    expect(items.find((i) => i.text === 'Lives in Hanoi')?.sources).toEqual([
      { id: 's1', kind: 'user', label: 'Saved earlier' },
    ])
  })

  it('text already in Everywhere is skipped', async () => {
    const rows = await sampleRows()
    await commitKnowledge((d) => {
      d.items.push({
        id: 'k0',
        scopeId: EVERYWHERE_SCOPE_ID,
        kind: 'fact',
        text: 'lives in hanoi.',
        sources: [],
        status: 'approved',
        history: [],
        revisions: [{ id: 'r1', text: 'lives in hanoi.', by: 'user', createdAt: 1 }],
        approvedRevisionId: 'r1',
        createdAt: 1,
        updatedAt: 1,
      })
    })
    await applyMemoryMigration(rows)
    expect(knowledge().items.map((i) => i.text)).toEqual(['lives in hanoi.', 'Prefers metric units'])
  })

  it('apply writes only knowledge, agents and the state, and never writes or removes a memory key', async () => {
    await applyMemoryMigration(await sampleRows())
    const keys = [...testStorage.setItemNow.mock.calls, ...testStorage.setItem.mock.calls].map((c) => c[0])
    expect(keys.filter((k) => k === MEMORY_GLOBAL || k.startsWith('memory'))).toEqual([])
    expect(testStorage.removeItem).not.toHaveBeenCalled()
  })
})

describe('loadMigrationState', () => {
  it('banks that read fine with no live notes are stored as done, and old memory turns off', async () => {
    banks.global = bank([entry('g1', 'Gone', { deleted: true })])
    banks.agents = [{ agentId: 'planner', bank: bank([], 'planner') }]
    saveBanks()
    expect(isLegacyMemoryActive()).toBe(true)
    expect(await loadMigrationState()).toBe('done')
    expect(getRaw('knowledge-migration')).toMatchObject({ state: 'done' })
    expect(knowledgeStore.getState().migration).toBe('done')
    expect(isLegacyMemoryActive()).toBe(false)
  })

  it('no memory keys at all are stored as done, and no memory key is written', async () => {
    expect(await loadMigrationState()).toBe('done')
    expect(getRaw('knowledge-migration')).toMatchObject({ state: 'done' })
    expect(isLegacyMemoryActive()).toBe(false)
    expect(testStorage.setItemNow.mock.calls.map((c) => c[0])).toEqual(['knowledge-migration'])
  })

  it('a read that throws stores nothing and leaves old memory on', async () => {
    saveBanks()
    putRaw('memory:agent:planner', bank([entry('a1', 'Window seats')], 'planner'))
    const read = testStorage.getItem.getMockImplementation()
    testStorage.getItem.mockImplementation(((key: string, fallback: unknown) =>
      key === 'memory:agent:planner' ? Promise.reject(new Error('disk')) : read?.(key, fallback)) as never)
    try {
      expect(await loadMigrationState()).toBe('pending')
      await expect(loadMigrationRows()).rejects.toThrow()
    } finally {
      testStorage.getItem.mockImplementation(read as never)
    }
    expect(getRaw('knowledge-migration')).toBeUndefined()
    expect(knowledgeStore.getState().migration).not.toBe('done')
    expect(isLegacyMemoryActive()).toBe(true)
  })

  it('a bank that does not parse is a failed read, not an empty one', async () => {
    putRaw(MEMORY_GLOBAL, { scope: 'global', entries: [{ id: 'g1', content: 42 }] })
    expect(await loadMigrationState()).toBe('pending')
    expect(getRaw('knowledge-migration')).toBeUndefined()
    expect(isLegacyMemoryActive()).toBe(true)
  })

  it('live entries mean pending, and a stored done wins', async () => {
    banks.global = bank([entry('g1', 'Lives in Hanoi')])
    saveBanks()
    expect(await loadMigrationState()).toBe('pending')
    expect(getRaw('knowledge-migration')).toBeUndefined()
    expect(knowledgeStore.getState().migration).toBe('pending')
    expect(isLegacyMemoryActive()).toBe(true)

    putRaw('knowledge-migration', { state: 'done', at: 1, counts: { everywhere: 0, prompts: 0, leftOut: 0 } })
    expect(await loadMigrationState()).toBe('done')
    expect(knowledgeStore.getState().migration).toBe('done')
    expect(isLegacyMemoryActive()).toBe(false)
  })
})
