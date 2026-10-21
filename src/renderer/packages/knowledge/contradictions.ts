import type { Settings } from '@shared/types'
import type { KnowledgeItem, KnowledgeSourceInput } from '@shared/types/knowledge'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { getLogger } from '@/lib/utils'
import { tokenizeForIndex } from '@/packages/memory/query-index'
import { getScopeReads } from './scopes'
import { ensureKnowledgeLoaded, knowledgeStore } from './store'

const log = getLogger('knowledge')

/**
 * `sessionId`: the chat the statement came from; its model answers. Without one, the default chat model.
 * `settings`: the settings `checkAgainstLayers` already resolved (and decided cloud or local on); the checker
 * must then use exactly these, so the model it asks is the one the local-only filter was applied for.
 */
export type ContradictionChecker = (input: {
  text: string
  candidates: KnowledgeItem[]
  sessionId?: string
  settings?: Settings
}) => Promise<string[]>

/** A checker call that takes longer than this fails (no conflict, `ok: false`). */
export const CHECK_TIMEOUT_MS = 15_000

const DEFAULT_LIMIT = 8

// A letter `tokenizeForIndex` drops: anything outside a–z and Latin-1 Supplement to Latin Extended-B.
// Vietnamese, Thai, Chinese and the like share no tokens with anything, so ranking would find nothing.
const DROPPED_LETTER = /(?![a-zÀ-ɏ])\p{L}/u

const newestFirst = (a: KnowledgeItem, b: KnowledgeItem) => b.updatedAt - a.updatedAt

/**
 * Items worth comparing with `text`: ranked by shared tokens, dropping items that share none. When the
 * text has fewer than 2 tokens, or it or any item has letters the tokenizer can't see (preflight C5), the
 * `limit` most recently updated items instead.
 */
export function selectCandidates(text: string, items: KnowledgeItem[], limit = DEFAULT_LIMIT): KnowledgeItem[] {
  const tokens = tokenizeForIndex(text)
  const unseen = (s: string) => DROPPED_LETTER.test(s.toLowerCase())
  if (tokens.length < 2 || unseen(text) || items.some((i) => unseen(i.text))) {
    return [...items].sort(newestFirst).slice(0, limit)
  }
  const wanted = new Set(tokens)
  return items
    .map((item) => ({ item, shared: tokenizeForIndex(item.text).filter((t) => wanted.has(t)).length }))
    .filter((r) => r.shared > 0)
    .sort((a, b) => b.shared - a.shared || newestFirst(a.item, b.item))
    .slice(0, limit)
    .map((r) => r.item)
}

const SYSTEM_PROMPT =
  'You compare a new statement with saved statements. Return only JSON {"contradicts": [ids]} listing the saved statements that cannot be true at the same time as the new one. A statement that adds detail or is about something else does not contradict.'

function parseContradicts(raw: string): string[] {
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/```(?:json)?/gi, '')
    .trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('Contradiction check: no JSON in the reply')
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { contradicts?: unknown }
  if (!Array.isArray(parsed.contradicts)) throw new Error('Contradiction check: no "contradicts" list')
  return parsed.contradicts.filter((id): id is string => typeof id === 'string')
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Contradiction check timed out after ${ms} ms`)), ms)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Asks a model, resolved like `extractFactsFromTranscript`: the global settings overlaid with the
 * session's settings when there is a session, otherwise with the default chat model (the one a new chat
 * gets). Ids that are not among the candidates are dropped. Throws when there is no model, the call
 * fails or it takes longer than `CHECK_TIMEOUT_MS`.
 */
export const defaultContradictionChecker: ContradictionChecker = ({ text, candidates, sessionId, settings }) =>
  withTimeout(askModel(text, candidates, sessionId, settings), CHECK_TIMEOUT_MS)

/** The checker's settings: the global ones overlaid with the session's, or with the default chat model. */
async function resolveCheckerSettings(sessionId?: string): Promise<{ settings: Settings; global: Settings }> {
  const { settingsStore } = await import('@/stores/settingsStore')
  const global = settingsStore.getState().getSettings()
  const session = sessionId ? await (await import('@/stores/chatStore')).getSession(sessionId) : null
  const settings = session
    ? ({ ...global, ...session.settings } as Settings)
    : {
        ...global,
        ...(global.defaultChatModel
          ? { provider: global.defaultChatModel.provider, modelId: global.defaultChatModel.model }
          : {}),
      }
  return { settings, global }
}

async function askModel(
  text: string,
  candidates: KnowledgeItem[],
  sessionId?: string,
  resolved?: Settings
): Promise<string[]> {
  // Lazy: the model stack is heavy and reaches the platform.
  const [{ getModel }, { createMessage }, { createModelDependencies }, { generateText }, platform, { settingsStore }] =
    await Promise.all([
      import('@shared/models'),
      import('@shared/types'),
      import('@/adapters'),
      import('@/packages/model-calls'),
      import('@/platform').then((m) => m.default),
      import('@/stores/settingsStore'),
    ])
  const { settings, global } = resolved
    ? { settings: resolved, global: settingsStore.getState().getSettings() }
    : await resolveCheckerSettings(sessionId)
  const dependencies = await createModelDependencies()
  const configs = await platform.getConfig()
  const model = getModel(settings, global, configs, dependencies)

  const saved = candidates.map((c) => ({ id: c.id, text: c.text }))
  const user = `Saved statements:\n${JSON.stringify(saved)}\n\nNew statement:\n${JSON.stringify(text)}`
  const result = await generateText(model, [createMessage('system', SYSTEM_PROMPT), createMessage('user', user)])
  const raw = (result.contentParts ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => (c as { text: string }).text)
    .join('')
  const known = new Set(candidates.map((c) => c.id))
  return [...new Set(parseContradicts(raw))].filter((id) => known.has(id))
}

let checkerOverride: ContradictionChecker | null = null

/** Tests: replace the default checker (null restores it). */
export function setContradictionCheckerForTests(fn: ContradictionChecker | null): void {
  checkerOverride = fn
}

const hasSourceId = (sources: readonly { sourceId?: string; removed?: boolean }[] | undefined) =>
  (sources ?? []).some((s) => !s.removed && !!s.sourceId)

/** The connected sources marked "Keep on this device only"; null when they cannot be read (fail closed). */
async function readLocalOnlySourceIds(): Promise<Set<string> | null> {
  try {
    const { loadLocalOnlySourceIds } = await import('@/packages/model-calls/toolsets/pm-pilot')
    return await loadLocalOnlySourceIds()
  } catch (error) {
    log.log('warn', 'Local-only sources could not be read; items with a source are held back:', errorName(error))
    return null
  }
}

const errorName = (error: unknown) => (error instanceof Error ? error.name : 'unknown')

/**
 * Compares `text` with the approved items of the target scope and, when the target is not Everywhere and
 * reads them (`getScopeReads(target).facts`), the approved Everywhere facts and decisions, in one checker call. Target-scope ids are conflicts;
 * Everywhere ids are overrides. A failed check (no model, provider offline, bad reply) finds nothing
 * and returns `ok: false`.
 *
 * Local-only (ADR 0003): when the text or a candidate carries a connected source id, the checker's model is resolved
 * once. On a cloud model, candidates from a local-only source (any source, when they cannot be read) are left out,
 * and text whose own `sources` are local-only is not checked at all (`ok: false`, no model call). The model is never
 * switched.
 */
export async function checkAgainstLayers(input: {
  text: string
  targetScopeId: string
  sessionId?: string
  /** Where the new text came from; a local-only source keeps it off a cloud checker. */
  sources?: KnowledgeSourceInput[]
}): Promise<{ conflictsWith: string[]; overrides: string[]; ok: boolean }> {
  await ensureKnowledgeLoaded()
  const { targetScopeId } = input
  // Everywhere facts go to the checker only when the scope reads them: a client scope that turned them off
  // never has them sent to its model.
  const readsEverywhereFacts = targetScopeId !== EVERYWHERE_SCOPE_ID && getScopeReads(targetScopeId).facts
  const layer = knowledgeStore
    .getState()
    .state.items.filter(
      (i) =>
        i.status === 'approved' &&
        (i.scopeId === targetScopeId ||
          (readsEverywhereFacts && i.scopeId === EVERYWHERE_SCOPE_ID && i.kind !== 'preference'))
    )
  let settings: Settings | undefined
  let reachable = layer
  if (hasSourceId(input.sources) || layer.some((i) => hasSourceId(i.sources))) {
    const [{ isLocalModelIn }, { knowledgeMayReachCloud }] = await Promise.all([
      import('@/packages/sources/model-check'),
      import('@/packages/model-calls/toolsets/pm-pilot-history'),
    ])
    let local = false
    try {
      const resolved = await resolveCheckerSettings(input.sessionId)
      settings = resolved.settings
      // The checker calls `settings`' provider and model, at the host the global settings give that provider.
      local = isLocalModelIn(resolved.global, settings as { provider?: string; modelId?: string })
    } catch (error) {
      log.log('warn', 'Knowledge contradiction check: no model settings:', errorName(error))
    }
    if (!local) {
      const localOnly = await readLocalOnlySourceIds()
      if (
        !knowledgeMayReachCloud({ id: 'new', sources: (input.sources ?? []) as KnowledgeItem['sources'] }, localOnly)
      ) {
        return { conflictsWith: [], overrides: [], ok: false }
      }
      reachable = layer.filter((i) => knowledgeMayReachCloud(i, localOnly))
    }
  }
  const candidates = selectCandidates(input.text, reachable)
  if (candidates.length === 0) return { conflictsWith: [], overrides: [], ok: true }

  let found: string[]
  try {
    found = await (checkerOverride ?? defaultContradictionChecker)({
      text: input.text,
      candidates,
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(settings ? { settings } : {}),
    })
  } catch (error) {
    log.log('warn', 'Knowledge contradiction check failed:', error instanceof Error ? error.message : String(error))
    return { conflictsWith: [], overrides: [], ok: false }
  }
  const byId = new Map(candidates.map((c) => [c.id, c]))
  const hits = [...new Set(found)].map((id) => byId.get(id)).filter((c) => c !== undefined)
  return {
    conflictsWith: hits.filter((c) => c.scopeId === targetScopeId).map((c) => c.id),
    overrides: hits.filter((c) => c.scopeId !== targetScopeId).map((c) => c.id),
    ok: true,
  }
}
