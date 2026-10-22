import type { SessionSettings } from '@shared/types'
import type { MemoryBank, MemoryEntry, MemorySettings, MemorySource } from '@shared/types/memory'
import { defaultMemorySettings, emptyMemoryBank } from '@shared/types/memory'
import { createStore, useStore } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { getLogger } from '@/lib/utils'
import { clearBank, createEntry, markEntryDeleted, retainEntry, updateEntry } from '@/packages/memory/bank-ops'
import { plainClone } from '@/packages/memory/clone'
import { consolidateBank } from '@/packages/memory/consolidate'
import { rebuildProfileLocal } from '@/packages/memory/extract'
import { formatMemoryMetrics, getMemoryMetrics, recordBankStats, recordConsolidateLlm } from '@/packages/memory/metrics'
import { getMemoryRepository } from '@/packages/memory/repository'

const log = getLogger('memory-store')

type MemoryState = {
  ready: boolean
  settings: MemorySettings
  globalBank: MemoryBank
  /** Currently loaded agent bank (lazy) */
  agentBanks: Record<string, MemoryBank>
  /** User turns since last auto extract per session */
  sessionTurnCounters: Record<string, number>
  /** Successful retains since last LLM consolidate */
  retainsSinceConsolidate: number
  lastError?: string
}

type MemoryActions = {
  init: () => Promise<void>
  setSettings: (patch: Partial<MemorySettings>) => Promise<void>
  ensureAgentBank: (agentId: string) => Promise<MemoryBank>
  retain: (input: {
    content: string
    scope: 'global' | 'agent'
    agentId?: string
    tags?: string[]
    source: MemorySource
    sourceSessionId?: string
    sourceMessageId?: string
    pinned?: boolean
    consolidate?: boolean
  }) => Promise<MemoryEntry | null>
  update: (
    scope: 'global' | 'agent',
    id: string,
    patch: Partial<Pick<MemoryEntry, 'content' | 'tags' | 'enabled' | 'pinned' | 'archived'>>,
    agentId?: string
  ) => Promise<void>
  remove: (scope: 'global' | 'agent', id: string, agentId?: string) => Promise<void>
  clear: (scope: 'global' | 'agent', agentId?: string) => Promise<void>
  /** `opts.sessionSettings`: the chat whose model consolidates (the default model when omitted). */
  rebuildProfile: (
    scope: 'global' | 'agent',
    agentId?: string,
    useLlm?: boolean,
    opts?: { sessionSettings?: SessionSettings }
  ) => Promise<void>
  importBank: (scope: 'global' | 'agent', bank: MemoryBank, agentId?: string) => Promise<void>
  exportBank: (scope: 'global' | 'agent', agentId?: string) => MemoryBank
  bumpSessionTurn: (sessionId: string) => number
  resetSessionTurn: (sessionId: string) => void
  replaceGlobalBank: (bank: MemoryBank) => Promise<void>
  replaceAgentBank: (agentId: string, bank: MemoryBank) => Promise<void>
  /** After auto-save retains: local profile already applied; maybe schedule LLM consolidate */
  noteRetainsAndMaybeConsolidate: (
    addedCount: number,
    options?: { agentId?: string; sessionSettings?: SessionSettings }
  ) => void
  flushPersistence: () => Promise<void>
}

export type MemoryStore = MemoryState & MemoryActions

function safeSettings(s: MemorySettings | undefined): MemorySettings {
  return { ...defaultMemorySettings(), ...(s ?? {}) }
}

function publishBankMetrics(globalBank: MemoryBank, agentBanks: Record<string, MemoryBank>) {
  let agentTotal = 0
  for (const b of Object.values(agentBanks)) {
    agentTotal += b.entries?.length ?? 0
  }
  let bankBytes = 0
  try {
    bankBytes = JSON.stringify(globalBank).length
  } catch {
    bankBytes = 0
  }
  recordBankStats({
    entriesGlobal: globalBank.entries?.length ?? 0,
    entriesAgentTotal: agentTotal,
    bankBytesGlobal: bankBytes,
  })
}

export const memoryStore = createStore<MemoryStore>()(
  subscribeWithSelector((set, get) => ({
    ready: false,
    settings: defaultMemorySettings(),
    globalBank: emptyMemoryBank('global'),
    agentBanks: {},
    sessionTurnCounters: {},
    retainsSinceConsolidate: 0,

    init: async () => {
      const repo = getMemoryRepository()
      try {
        const [settings, globalBank] = await Promise.all([repo.loadSettings(), repo.loadGlobal()])
        set((s) => {
          const keepLocal =
            s.globalBank.entries.length > 0 &&
            globalBank.entries.length === 0 &&
            s.globalBank.entries.some((e) => e.source === 'user' || e.source === 'auto' || e.source === 'tool')

          const nextGlobal = keepLocal ? s.globalBank : globalBank
          repo.rebuildIndexes('global', nextGlobal)
          return {
            ...s,
            settings: safeSettings(settings),
            globalBank: nextGlobal,
            ready: true,
            lastError: undefined,
          }
        })

        const state = get()
        publishBankMetrics(state.globalBank, state.agentBanks)
        if (state.globalBank.entries.length > 0) {
          const stored = await repo.loadGlobal()
          if (stored.entries.length === 0 && state.globalBank.entries.length > 0) {
            await repo.saveGlobal(state.globalBank, { immediate: true })
          }
        }
        try {
          log.info(formatMemoryMetrics())
        } catch {
          // ignore
        }
      } catch (e) {
        try {
          log.error('memory init failed', e)
        } catch {
          console.error('memory init failed', e)
        }
        set((s) => ({
          ...s,
          ready: true,
          settings: defaultMemorySettings(),
          globalBank: s.globalBank.entries.length ? s.globalBank : emptyMemoryBank('global'),
          lastError: e instanceof Error ? e.message : String(e),
        }))
      }
    },

    setSettings: async (patch) => {
      const repo = getMemoryRepository()
      const next = safeSettings({ ...get().settings, ...patch })
      set({ settings: next })
      await repo.saveSettings(next)
    },

    ensureAgentBank: async (agentId) => {
      const cached = get().agentBanks[agentId]
      if (cached) return cached
      const repo = getMemoryRepository()
      const bank = await repo.loadAgent(agentId)
      set((s) => ({
        agentBanks: { ...s.agentBanks, [agentId]: bank },
      }))
      publishBankMetrics(get().globalBank, get().agentBanks)
      return bank
    },

    retain: async (input) => {
      await ensureMemoryStoreInit()
      const repo = getMemoryRepository()
      const settings = safeSettings(get().settings)
      if (!settings.enabled && input.source !== 'user') return null

      const entry = createEntry({
        content: input.content,
        tags: input.tags,
        scope: input.scope,
        agentId: input.agentId,
        source: input.source,
        sourceSessionId: input.sourceSessionId,
        sourceMessageId: input.sourceMessageId,
        pinned: input.pinned,
        maxEntryChars: settings.maxEntryChars ?? 500,
      })
      if (!entry) return null

      if (input.scope === 'agent') {
        if (!input.agentId) throw new Error('agentId required')
        let bank = get().agentBanks[input.agentId]
        if (!bank) {
          bank = await get().ensureAgentBank(input.agentId)
        }
        bank = retainEntry(plainClone(bank), entry, settings)
        if (input.consolidate !== false) {
          bank = rebuildProfileLocal(bank)
        }
        bank = plainClone(bank)
        set((s) => ({
          agentBanks: { ...s.agentBanks, [input.agentId!]: bank },
        }))
        await repo.saveAgent(input.agentId, bank)
      } else {
        let bank = retainEntry(plainClone(get().globalBank), entry, settings)
        if (input.consolidate !== false) {
          bank = rebuildProfileLocal(bank)
        }
        bank = plainClone(bank)
        set({ globalBank: bank })
        await repo.saveGlobal(bank)
      }
      publishBankMetrics(get().globalBank, get().agentBanks)
      if (settings.autoConsolidate && input.consolidate !== false) {
        get().noteRetainsAndMaybeConsolidate(1, { agentId: input.agentId })
      }
      return entry
    },

    update: async (scope, id, patch, agentId) => {
      await ensureMemoryStoreInit()
      const repo = getMemoryRepository()
      if (scope === 'agent') {
        if (!agentId) throw new Error('agentId required')
        let bank = get().agentBanks[agentId] ?? (await get().ensureAgentBank(agentId))
        bank = plainClone(rebuildProfileLocal(updateEntry(plainClone(bank), id, patch)))
        set((s) => ({
          agentBanks: { ...s.agentBanks, [agentId]: bank },
        }))
        await repo.saveAgent(agentId, bank)
      } else {
        const bank = plainClone(rebuildProfileLocal(updateEntry(plainClone(get().globalBank), id, patch)))
        set({ globalBank: bank })
        await repo.saveGlobal(bank)
      }
      publishBankMetrics(get().globalBank, get().agentBanks)
    },

    remove: async (scope, id, agentId) => {
      await ensureMemoryStoreInit()
      const repo = getMemoryRepository()
      if (scope === 'agent') {
        if (!agentId) throw new Error('agentId required')
        let bank = get().agentBanks[agentId] ?? (await get().ensureAgentBank(agentId))
        bank = plainClone(rebuildProfileLocal(markEntryDeleted(plainClone(bank), id)))
        set((s) => ({
          agentBanks: { ...s.agentBanks, [agentId]: bank },
        }))
        await repo.saveAgent(agentId, bank)
      } else {
        const bank = plainClone(rebuildProfileLocal(markEntryDeleted(plainClone(get().globalBank), id)))
        set({ globalBank: bank })
        await repo.saveGlobal(bank)
      }
      publishBankMetrics(get().globalBank, get().agentBanks)
    },

    clear: async (scope, agentId) => {
      await ensureMemoryStoreInit()
      const repo = getMemoryRepository()
      if (scope === 'agent') {
        if (!agentId) throw new Error('agentId required')
        const bank = clearBank('agent', agentId)
        set((s) => ({
          agentBanks: { ...s.agentBanks, [agentId]: bank },
        }))
        await repo.saveAgent(agentId, bank, { immediate: true })
      } else {
        const bank = clearBank('global')
        set({ globalBank: bank })
        await repo.saveGlobal(bank, { immediate: true })
      }
      publishBankMetrics(get().globalBank, get().agentBanks)
    },

    rebuildProfile: async (scope, agentId, useLlm = true, opts) => {
      await ensureMemoryStoreInit()
      const repo = getMemoryRepository()
      if (scope === 'agent') {
        if (!agentId) throw new Error('agentId required')
        let bank = get().agentBanks[agentId] ?? (await get().ensureAgentBank(agentId))
        bank = useLlm
          ? await consolidateBank(plainClone(bank), { sessionSettings: opts?.sessionSettings })
          : rebuildProfileLocal(plainClone(bank))
        if (useLlm) recordConsolidateLlm()
        bank = plainClone(bank)
        set((s) => ({
          agentBanks: { ...s.agentBanks, [agentId]: bank },
          retainsSinceConsolidate: 0,
        }))
        await repo.saveAgent(agentId, bank, { immediate: true })
      } else {
        let bank = plainClone(get().globalBank)
        bank = useLlm
          ? await consolidateBank(bank, { sessionSettings: opts?.sessionSettings })
          : rebuildProfileLocal(bank)
        if (useLlm) recordConsolidateLlm()
        bank = plainClone(bank)
        set({ globalBank: bank, retainsSinceConsolidate: 0 })
        await repo.saveGlobal(bank, { immediate: true })
      }
    },

    importBank: async (scope, bank, agentId) => {
      await ensureMemoryStoreInit()
      const repo = getMemoryRepository()
      if (scope === 'agent') {
        if (!agentId) throw new Error('agentId required')
        const next = plainClone({ ...bank, scope: 'agent' as const, agentId })
        set((s) => ({
          agentBanks: { ...s.agentBanks, [agentId]: next },
        }))
        await repo.saveAgent(agentId, next, { immediate: true })
      } else {
        const next = plainClone({ ...bank, scope: 'global' as const, agentId: undefined })
        set({ globalBank: next })
        await repo.saveGlobal(next, { immediate: true })
      }
      publishBankMetrics(get().globalBank, get().agentBanks)
    },

    exportBank: (scope, agentId) => {
      if (scope === 'agent') {
        if (!agentId) throw new Error('agentId required')
        return plainClone(get().agentBanks[agentId] ?? emptyMemoryBank('agent', agentId))
      }
      return plainClone(get().globalBank)
    },

    bumpSessionTurn: (sessionId) => {
      const next = (get().sessionTurnCounters[sessionId] ?? 0) + 1
      set((s) => ({
        sessionTurnCounters: { ...s.sessionTurnCounters, [sessionId]: next },
      }))
      return next
    },

    resetSessionTurn: (sessionId) => {
      set((s) => ({
        sessionTurnCounters: { ...s.sessionTurnCounters, [sessionId]: 0 },
      }))
    },

    replaceGlobalBank: async (bank) => {
      const repo = getMemoryRepository()
      const next = plainClone(bank)
      set({ globalBank: next })
      await repo.saveGlobal(next)
      publishBankMetrics(next, get().agentBanks)
    },

    replaceAgentBank: async (agentId, bank) => {
      const repo = getMemoryRepository()
      const next = plainClone(bank)
      set((s) => ({
        agentBanks: { ...s.agentBanks, [agentId]: next },
      }))
      await repo.saveAgent(agentId, next)
      publishBankMetrics(get().globalBank, get().agentBanks)
    },

    noteRetainsAndMaybeConsolidate: (addedCount, options) => {
      if (addedCount <= 0) return
      const settings = safeSettings(get().settings)
      if (!settings.autoConsolidate) return
      const every = Math.max(1, settings.consolidateEveryNRetains || 5)
      const next = get().retainsSinceConsolidate + addedCount
      set({ retainsSinceConsolidate: next })
      if (next < every) return

      set({ retainsSinceConsolidate: 0 })
      void get()
        .rebuildProfile('global', undefined, true, { sessionSettings: options?.sessionSettings })
        .catch((e) => log.error('lazy consolidate global failed', e))
      if (options?.agentId) {
        void get()
          .rebuildProfile('agent', options.agentId, true, { sessionSettings: options.sessionSettings })
          .catch((e) => log.error('lazy consolidate agent failed', e))
      }
    },

    flushPersistence: async () => {
      await getMemoryRepository().flush()
    },
  }))
)

export function useMemoryStore<T>(selector: (s: MemoryStore) => T): T {
  return useStore(memoryStore, selector)
}

/** Fire-and-forget init; safe to call multiple times. */
let initPromise: Promise<void> | null = null
export function ensureMemoryStoreInit(): Promise<void> {
  if (memoryStore.getState().ready) return Promise.resolve()
  if (!initPromise) {
    initPromise = memoryStore
      .getState()
      .init()
      .catch((e) => {
        console.error('ensureMemoryStoreInit failed', e)
      })
  }
  return initPromise
}

// Expose metrics for dev console debugging
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  ;(window as unknown as { __memoryMetrics?: () => unknown }).__memoryMetrics = () => ({
    ...getMemoryMetrics(),
    line: formatMemoryMetrics(),
  })
}
