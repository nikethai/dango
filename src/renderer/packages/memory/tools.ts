import { getModel } from '@shared/models'
import { createMessage, type SessionSettings, type Settings } from '@shared/types'
import type { MemoryBank, MemorySettings } from '@shared/types/memory'
import { emptyMemoryBank } from '@shared/types/memory'
import { tool } from 'ai'
import { z } from 'zod'
import { createModelDependencies } from '@/adapters'
import { generateText } from '@/packages/model-calls'
import platform from '@/platform'
import { settingsStore } from '@/stores/settingsStore'
import { createEntry, forgetEntry, listEntries, retainEntry, updateEntry } from './bank-ops'
import { rebuildProfileLocal } from './extract'
import { buildReflectSystemPrompt } from './prompts/extract'
import { touchAccessedEntries } from './recall'
import { getMemoryRepository } from './repository'

export interface MemoryToolContext {
  settings: MemorySettings
  getGlobalBank: () => MemoryBank
  setGlobalBank: (bank: MemoryBank) => void | Promise<void>
  getAgentBank: () => MemoryBank | null
  setAgentBank: (bank: MemoryBank) => void | Promise<void>
  agentId?: string
  agentName?: string
  sessionId?: string
  scheduleConsolidate?: (scope: 'global' | 'agent') => void
  /**
   * When false, omit memory_retain (session auto-save off).
   * Default true when omitted.
   */
  allowRetain?: boolean
  /**
   * The chat holds email or tasks kept on this device (or this turn may read them): omit memory_retain, memory_update
   * and memory_reflect, so nothing a model read from local-only text is saved or sent on (ADR 0003, B3).
   */
  localOnlyChat?: boolean
  /** The chat's model settings; memory_reflect calls that model, not the default one. */
  sessionSettings?: SessionSettings
}

/** Told to the model (not shown to the user): why a local-only chat has no saving or reflecting. */
export const MEMORY_LOCAL_ONLY_NOTE =
  'Saving and reflecting are off in this chat because it holds email or tasks kept on this device.'

export const MEMORY_TOOL_NAMES = [
  'memory_retain',
  'memory_recall',
  'memory_list',
  'memory_forget',
  'memory_update',
  'memory_reflect',
] as const

export function getMemoryToolSet(ctx: MemoryToolContext) {
  const localOnlyChat = ctx.localOnlyChat === true
  const allowRetain = ctx.allowRetain !== false && !localOnlyChat
  const allowWrite = !localOnlyChat
  const mode = ctx.settings.retrievalMode ?? 'hybrid'
  const retrievalHint =
    mode === 'always'
      ? 'Some memories may already appear in the system prompt. Still use memory_recall for older or missing facts before web search.'
      : mode === 'hybrid'
        ? "A host Memory lookup already ran for this user message (see system Memory section). Only profile + pinned facts are always injected. If lookup has no match but the question may involve the user's projects/stack/prefs, call memory_recall ONCE with keywords from the user message BEFORE any web search."
        : 'A host Memory lookup already ran for this user message. Full memory is not injected. Call memory_recall ONCE before web search when personal/project context may matter.'

  const retainBullet = allowRetain ? '- memory_retain — store a short durable fact\n' : ''
  const description = `
# Long-term memory (priority over web search for personal/project context)

Tools for durable user memory shared across models (global) and optional agent-scoped memory.

${retrievalHint}

Tool order for research questions that might involve the user's work:
1. Read the host Memory lookup section in the system prompt
2. memory_recall if you need more from the bank
3. Then web search for external public docs (SDKs, APIs, blogs)

${retainBullet}- memory_recall — keyword search (prefer before web search when personal/project context is possible)
- memory_list — recent/pinned entries
- memory_forget — disable or hard-delete by id
${allowWrite ? '- memory_update — edit by id\n- memory_reflect — answer a question from memories only\n' : ''}${localOnlyChat ? `\n${MEMORY_LOCAL_ONLY_NOTE}\n` : allowRetain ? '' : '\nMemory retain is disabled for this chat; do not invent a store tool.\n'}
Do not store secrets, passwords, API keys, or ephemeral task noise.
`

  const memoryRetainTool = tool({
    description: 'Store a durable fact in long-term memory. Returns memory id.',
    inputSchema: z.object({
      content: z.string().describe('Short durable fact'),
      scope: z.enum(['global', 'agent']).optional(),
      tags: z.array(z.string()).optional(),
    }),
    execute: async (input: { content: string; scope?: 'global' | 'agent'; tags?: string[] }) => {
      if (!allowRetain) {
        return { ok: false, error: 'Memory auto-save is off for this chat' }
      }

      const scope =
        input.scope === 'agent' && ctx.agentId
          ? 'agent'
          : input.scope === 'global'
            ? 'global'
            : ctx.agentId
              ? 'agent'
              : 'global'

      if (scope === 'agent' && !ctx.agentId) {
        return { ok: false, error: 'No agent active for agent-scoped memory' }
      }

      const entry = createEntry({
        content: input.content,
        tags: input.tags,
        scope,
        agentId: scope === 'agent' ? ctx.agentId : undefined,
        source: 'tool',
        sourceSessionId: ctx.sessionId,
        maxEntryChars: ctx.settings.maxEntryChars,
      })
      if (!entry) return { ok: false, error: 'Content empty or fully redacted' }

      if (scope === 'agent' && ctx.agentId) {
        const bank = ctx.getAgentBank() ?? emptyMemoryBank('agent', ctx.agentId)
        const next = retainEntry(bank, entry, ctx.settings)
        await ctx.setAgentBank(next)
        ctx.scheduleConsolidate?.('agent')
      } else {
        const next = retainEntry(ctx.getGlobalBank(), entry, ctx.settings)
        await ctx.setGlobalBank(next)
        ctx.scheduleConsolidate?.('global')
      }

      return { ok: true, id: entry.id, scope, content: entry.content }
    },
  } as any)

  const memoryUpdateTool = tool({
    description: 'Update content or tags of a memory by id.',
    inputSchema: z.object({
      id: z.string(),
      content: z.string().optional(),
      tags: z.array(z.string()).optional(),
      enabled: z.boolean().optional(),
      pinned: z.boolean().optional(),
    }),
    execute: async (input: { id: string; content?: string; tags?: string[]; enabled?: boolean; pinned?: boolean }) => {
      const patch = {
        content: input.content,
        tags: input.tags,
        enabled: input.enabled,
        pinned: input.pinned,
      }
      const g = ctx.getGlobalBank()
      if (g.entries.some((e) => e.id === input.id)) {
        await ctx.setGlobalBank(rebuildProfileLocal(updateEntry(g, input.id, patch)))
        return { ok: true, scope: 'global' }
      }
      const a = ctx.getAgentBank()
      if (a?.entries.some((e) => e.id === input.id)) {
        await ctx.setAgentBank(rebuildProfileLocal(updateEntry(a, input.id, patch)))
        return { ok: true, scope: 'agent' }
      }
      return { ok: false, error: 'Memory id not found' }
    },
  } as any)

  const memoryReflectTool = tool({
    description: 'Synthesize an answer from long-term memories for a question.',
    inputSchema: z.object({
      question: z.string(),
      scope: z.enum(['global', 'agent', 'all']).optional().default('all'),
    }),
    execute: async (input: { question: string; scope?: 'global' | 'agent' | 'all' }) => {
      const chunks: string[] = []
      if (input.scope !== 'agent') {
        const g = ctx.getGlobalBank()
        if (g.profileSummary) chunks.push(`Global profile:\n${g.profileSummary}`)
        for (const e of listEntries(g, { limit: 30, enabledOnly: true })) {
          chunks.push(`- [${e.id}] ${e.content}`)
        }
      }
      if (input.scope !== 'global' && ctx.getAgentBank()) {
        const a = ctx.getAgentBank()!
        if (a.profileSummary) chunks.push(`Agent profile:\n${a.profileSummary}`)
        for (const e of listEntries(a, { limit: 30, enabledOnly: true })) {
          chunks.push(`- [${e.id}] ${e.content}`)
        }
      }
      if (chunks.length === 0) {
        return { answer: 'No memories available.' }
      }

      try {
        const globalSettings = settingsStore.getState().getSettings()
        const settings = { ...globalSettings, ...ctx.sessionSettings } as Settings
        const dependencies = await createModelDependencies()
        const configs = await platform.getConfig()
        const model = getModel(settings, globalSettings, configs, dependencies)
        const messages = [
          createMessage('system', buildReflectSystemPrompt()),
          createMessage('user', `Memories:\n${chunks.join('\n').slice(0, 8000)}\n\nQuestion: ${input.question}`),
        ]
        const result = await generateText(model, messages)
        const answer =
          result.contentParts
            ?.filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('')
            ?.trim() ?? ''
        return { answer: answer || 'No answer generated.' }
      } catch (e) {
        return { answer: '', error: e instanceof Error ? e.message : String(e) }
      }
    },
  } as any)

  const tools = {
    ...(allowRetain ? { memory_retain: memoryRetainTool } : {}),

    memory_recall: tool({
      description:
        'Search durable user/agent memory by keywords drawn from the user message. Use before answering preference, identity, project, or past-fact questions. Returns ids and content previews.',
      inputSchema: z.object({
        query: z.string().describe('Keywords or short phrase from the user message'),
        scope: z.enum(['global', 'agent', 'all']).optional().default('all'),
        limit: z.number().optional().default(8),
      }),
      execute: async (input: { query: string; scope?: 'global' | 'agent' | 'all'; limit?: number }) => {
        const limit = input.limit ?? 8
        const repo = getMemoryRepository()
        const globalBank = input.scope === 'agent' ? null : ctx.getGlobalBank()
        const agentBank = input.scope === 'global' ? null : ctx.getAgentBank()
        const hits = repo.recall({
          query: input.query,
          globalBank,
          agentBank,
          agentId: ctx.agentId,
          limit,
          settings: ctx.settings,
        })

        // Touch access timestamps (best-effort persist)
        const globalIds = hits.filter((h) => h.scope === 'global').map((h) => h.id)
        const agentIds = hits.filter((h) => h.scope === 'agent').map((h) => h.id)
        if (globalIds.length) {
          const next = touchAccessedEntries(ctx.getGlobalBank(), globalIds)
          if (next !== ctx.getGlobalBank()) await ctx.setGlobalBank(next)
        }
        if (agentIds.length && ctx.getAgentBank()) {
          const next = touchAccessedEntries(ctx.getAgentBank()!, agentIds)
          if (next !== ctx.getAgentBank()) await ctx.setAgentBank(next)
        }

        return {
          results: hits.map((h) => ({
            id: h.id,
            scope: h.scope,
            content: h.content,
            tags: h.tags,
            score: h.score,
          })),
        }
      },
    } as any),

    memory_list: tool({
      description: 'List recent/pinned memories for active scopes.',
      inputSchema: z.object({
        scope: z.enum(['global', 'agent', 'all']).optional().default('all'),
        limit: z.number().optional().default(15),
        pinnedOnly: z.boolean().optional().default(false),
      }),
      execute: async (input: { scope?: 'global' | 'agent' | 'all'; limit?: number; pinnedOnly?: boolean }) => {
        const limit = input.limit ?? 15
        const results: { id: string; scope: string; content: string; pinned: boolean; tags: string[] }[] = []
        if (input.scope !== 'agent') {
          for (const e of listEntries(ctx.getGlobalBank(), {
            limit,
            enabledOnly: true,
            pinnedOnly: input.pinnedOnly,
          })) {
            results.push({ id: e.id, scope: 'global', content: e.content, pinned: e.pinned, tags: e.tags })
          }
        }
        if (input.scope !== 'global' && ctx.getAgentBank()) {
          for (const e of listEntries(ctx.getAgentBank()!, {
            limit,
            enabledOnly: true,
            pinnedOnly: input.pinnedOnly,
          })) {
            results.push({ id: e.id, scope: 'agent', content: e.content, pinned: e.pinned, tags: e.tags })
          }
        }
        return { results: results.slice(0, limit) }
      },
    } as any),

    memory_forget: tool({
      description: 'Disable or hard-delete a memory by id.',
      inputSchema: z.object({
        id: z.string(),
        hard: z.boolean().optional().default(false),
      }),
      execute: async (input: { id: string; hard?: boolean }) => {
        const g = ctx.getGlobalBank()
        if (g.entries.some((e) => e.id === input.id)) {
          await ctx.setGlobalBank(rebuildProfileLocal(forgetEntry(g, input.id, input.hard)))
          return { ok: true, scope: 'global' }
        }
        const a = ctx.getAgentBank()
        if (a?.entries.some((e) => e.id === input.id)) {
          await ctx.setAgentBank(rebuildProfileLocal(forgetEntry(a, input.id, input.hard)))
          return { ok: true, scope: 'agent' }
        }
        return { ok: false, error: 'Memory id not found' }
      },
    } as any),

    // memory_update can write the same text memory_retain would; memory_reflect sends memories on to a model.
    ...(allowWrite ? { memory_update: memoryUpdateTool, memory_reflect: memoryReflectTool } : {}),
  }

  return { description, tools }
}
