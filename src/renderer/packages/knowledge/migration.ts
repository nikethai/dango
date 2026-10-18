import type { CopilotDetail } from '@shared/types'
import type { KnowledgeItem, KnowledgeKind, KnowledgeSourceInput } from '@shared/types/knowledge'
import type { MemoryBank, MemoryEntry } from '@shared/types/memory'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { t } from 'i18next'
import { v4 as uuidv4 } from 'uuid'
import { getLogger } from '@/lib/utils'
import {
  commitKnowledge,
  markKnowledgeMigrationPending,
  readKnowledgeMigration,
  writeKnowledgeMigrationDone,
} from './store'
import { assignSourceIds, knowledgeTextKey, newRevision } from './text'

// The one-time move of old memory banks into Everywhere and agent prompts (ADR 0014: the user's Move in the
// migration sheet approves what it writes). The memory keys are only ever read here, never written or deleted.

const log = getLogger('knowledge')

export type MigrationChoice = 'everywhere' | 'agent-prompt' | 'leave-out'
export type MigrationRow = {
  entryId: string
  group: { scope: 'global' } | { scope: 'agent'; agentId: string; agentName: string; promptEditable: boolean }
  text: string
  kind: KnowledgeKind
  choice: MigrationChoice
  sourceSessionId?: string
}
export type MigrationCounts = { everywhere: number; prompts: number; leftOut: number }

const STANDING_NOTES = 'Standing notes:'

function kindFromTags(tags: string[]): KnowledgeKind {
  const lower = tags.map((tag) => tag.trim().toLowerCase())
  if (lower.includes('preference') || lower.includes('pref')) return 'preference'
  if (lower.includes('decision')) return 'decision'
  return 'fact'
}

function rowsOf(bank: MemoryBank, group: MigrationRow['group']): MigrationRow[] {
  const editable = group.scope === 'agent' && group.promptEditable
  return bank.entries.flatMap((e: MemoryEntry) => {
    const text = e.content.trim()
    if (e.deleted || !text) return []
    const off = e.enabled === false || e.archived === true
    const choice: MigrationChoice = off ? 'leave-out' : editable ? 'agent-prompt' : 'everywhere'
    return [
      {
        entryId: e.id,
        group,
        text,
        kind: kindFromTags(e.tags ?? []),
        choice,
        ...(e.sourceSessionId ? { sourceSessionId: e.sourceSessionId } : {}),
      },
    ]
  })
}

/** One row per live note: global notes default to Everywhere, an editable agent's notes to its prompt. */
export function planMemoryMigration(input: {
  global: MemoryBank
  agents: { agentId: string; bank: MemoryBank }[]
  describeAgent: (id: string) => { name: string; editable: boolean }
}): MigrationRow[] {
  const rows = rowsOf(input.global, { scope: 'global' })
  for (const { agentId, bank } of input.agents) {
    const agent = input.describeAgent(agentId)
    rows.push(...rowsOf(bank, { scope: 'agent', agentId, agentName: agent.name, promptEditable: agent.editable }))
  }
  return rows
}

// ---- Agents (preflight C3: read storage directly, never the atom; built-ins from getBuiltInCopilotById) ----

type Storage = {
  getItem<T>(key: string, fallback: T): Promise<T>
  setItemNow(key: string, value: unknown): Promise<void>
}

async function getStorage(): Promise<{ storage: Storage; myCopilotsKey: string }> {
  const mod = await import('@/storage')
  return { storage: mod.default as Storage, myCopilotsKey: mod.StorageKey.MyCopilots }
}

async function readLocalAgents(): Promise<CopilotDetail[]> {
  const { storage, myCopilotsKey } = await getStorage()
  const list = await storage.getItem<CopilotDetail[]>(myCopilotsKey, [])
  return Array.isArray(list) ? list : []
}

/** Only a local agent the user made can take prompt text: never a built-in (even a stored override) or a remote one. */
function isEditable(
  id: string,
  local: CopilotDetail[],
  getBuiltIn: (id: string) => CopilotDetail | undefined
): CopilotDetail | undefined {
  if (getBuiltIn(id)) return undefined
  const found = local.find((c) => c.id === id)
  return found && !found.builtIn ? found : undefined
}

async function remoteAgentName(id: string): Promise<string | undefined> {
  try {
    const queryClient = (await import('@/stores/queryClient')).default
    for (const [, data] of queryClient.getQueriesData<CopilotDetail[]>({ queryKey: ['remote-copilots'] })) {
      const found = Array.isArray(data) ? data.find((c) => c.id === id) : undefined
      if (found?.name) return found.name
    }
  } catch {
    // No query client (early boot): fall back to the id.
  }
  return undefined
}

/** Reads both banks and the agents, and plans the rows the sheet shows. */
export async function loadMigrationRows(): Promise<MigrationRow[]> {
  const { getMemoryRepository } = await import('@/packages/memory/repository')
  const { getBuiltInCopilotById } = await import('@/hooks/useCopilots')
  const repo = getMemoryRepository()
  const [global, agents, local] = await Promise.all([repo.loadGlobal(), repo.loadAllAgentBanks(), readLocalAgents()])
  const names = new Map<string, string>()
  for (const { agentId } of agents) {
    const builtIn = getBuiltInCopilotById(agentId)
    const name = builtIn
      ? t(builtIn.name) || builtIn.name
      : (local.find((c) => c.id === agentId)?.name ?? (await remoteAgentName(agentId)) ?? agentId)
    names.set(agentId, name)
  }
  return planMemoryMigration({
    global,
    agents,
    describeAgent: (id) => ({
      name: names.get(id) ?? id,
      editable: Boolean(isEditable(id, local, getBuiltInCopilotById)),
    }),
  })
}

/**
 * `'done'` when the move is stored as done, or when no live notes exist (then stored as done, so the sheet
 * never opens); otherwise `'pending'`.
 */
export async function loadMigrationState(): Promise<'pending' | 'done'> {
  if ((await readKnowledgeMigration()) === 'done') return 'done'
  const rows = await loadMigrationRows()
  if (rows.length === 0) {
    await writeKnowledgeMigrationDone({
      state: 'done',
      at: Date.now(),
      counts: { everywhere: 0, prompts: 0, leftOut: 0 },
    })
    return 'done'
  }
  markKnowledgeMigrationPending()
  return 'pending'
}

// ---- Apply ----

function sourceFor(row: MigrationRow): KnowledgeSourceInput {
  return row.sourceSessionId
    ? { kind: 'chat', label: 'Earlier chat', ref: row.sourceSessionId }
    : { kind: 'user', label: 'Saved earlier' }
}

async function migratedItem(row: MigrationRow, now: number): Promise<KnowledgeItem> {
  const revision = await newRevision(
    { kind: row.kind, revisions: [], approvedRevisionId: '' },
    { text: row.text, by: 'migration' },
    'user'
  )
  return {
    id: uuidv4(),
    scopeId: EVERYWHERE_SCOPE_ID,
    kind: row.kind,
    text: row.text,
    sources: assignSourceIds([], [sourceFor(row)]),
    status: 'approved',
    history: [{ at: now, by: 'migration', action: 'approved', note: 'From saved notes' }],
    revisions: [revision],
    approvedRevisionId: revision.id,
    createdAt: now,
    updatedAt: now,
  }
}

const promptLine = (text: string) => `- ${text.replace(/\s+/g, ' ').trim()}`

/** The keys of the `- ` lines already in the prompt, so a second run adds nothing. */
function existingLineKeys(prompt: string): Set<string> {
  const keys = new Set<string>()
  for (const line of prompt.split('\n')) {
    const m = /^\s*-\s+(.*)$/.exec(line)
    if (m) keys.add(knowledgeTextKey(m[1]))
  }
  return keys
}

/** Appends lines under a `Standing notes:` block at the end, reusing one that already ends the prompt. */
export function appendStandingNotes(prompt: string, texts: string[]): string {
  const seen = existingLineKeys(prompt)
  const lines: string[] = []
  for (const text of texts) {
    const line = promptLine(text)
    const key = knowledgeTextKey(line.slice(2))
    if (!key || seen.has(key)) continue
    seen.add(key)
    lines.push(line)
  }
  if (!lines.length) return prompt
  const body = prompt.replace(/\s+$/, '')
  const all = body.split('\n')
  const header = all.lastIndexOf(STANDING_NOTES)
  const endsWithBlock = header >= 0 && all.slice(header + 1).every((l) => l.trim() === '' || /^\s*-\s/.test(l))
  if (endsWithBlock) return `${body}\n${lines.join('\n')}`
  return `${body ? `${body}\n\n` : ''}${STANDING_NOTES}\n${lines.join('\n')}`
}

/**
 * Writes the move in a crash-safe order: Everywhere items, then agent prompts, then the `done` state. Each step
 * skips what is already there, so a second run (after a crash, or Later then Move) adds nothing. A row for an
 * agent that cannot take prompt text goes to Everywhere. Pushes no undo: the old banks stay as they were.
 */
export async function applyMemoryMigration(rows: MigrationRow[]): Promise<MigrationCounts> {
  const { getBuiltInCopilotById, myCopilotsAtom } = await import('@/hooks/useCopilots')
  const { storage, myCopilotsKey } = await getStorage()
  const local = await readLocalAgents()

  const everywhere: MigrationRow[] = []
  const prompts = new Map<string, string[]>()
  let leftOut = 0
  for (const row of rows) {
    if (row.choice === 'leave-out') {
      leftOut += 1
      continue
    }
    const agent =
      row.choice === 'agent-prompt' && row.group.scope === 'agent'
        ? isEditable(row.group.agentId, local, getBuiltInCopilotById)
        : undefined
    if (agent) prompts.set(agent.id, [...(prompts.get(agent.id) ?? []), row.text])
    else everywhere.push(row)
  }
  const promptCount = [...prompts.values()].reduce((n, texts) => n + texts.length, 0)

  // 1. Everywhere items (one commit), skipping text that Everywhere already has.
  const now = Date.now()
  const candidates = await Promise.all(everywhere.map((row) => migratedItem(row, now)))
  if (candidates.length) {
    await commitKnowledge((d) => {
      const present = new Set(
        d.items
          .filter((i) => i.scopeId === EVERYWHERE_SCOPE_ID && i.status === 'approved')
          .map((i) => knowledgeTextKey(i.text))
      )
      for (const item of candidates) {
        const key = knowledgeTextKey(item.text)
        if (present.has(key)) continue
        present.add(key)
        d.items.push(item)
      }
    })
  }

  // 2. Agent prompts (one immediate write), re-read so a concurrent edit to another agent survives.
  if (prompts.size) {
    const fresh = await readLocalAgents()
    let changed = false
    const next = fresh.map((c) => {
      const texts = prompts.get(c.id)
      if (!texts || !isEditable(c.id, fresh, getBuiltInCopilotById)) return c
      const prompt = appendStandingNotes(c.prompt ?? '', texts)
      if (prompt === c.prompt) return c
      changed = true
      return { ...c, prompt }
    })
    if (changed) {
      await storage.setItemNow(myCopilotsKey, next)
      try {
        const { getDefaultStore } = await import('jotai')
        getDefaultStore().set(myCopilotsAtom, next)
      } catch (error) {
        log.error('Could not refresh agents after the memory move:', error)
      }
    }
  }

  // 3. Done, last: a crash before this reopens the sheet, and the steps above skip what they already wrote.
  const counts = { everywhere: everywhere.length, prompts: promptCount, leftOut }
  await writeKnowledgeMigrationDone({ state: 'done', at: Date.now(), counts })
  return counts
}
