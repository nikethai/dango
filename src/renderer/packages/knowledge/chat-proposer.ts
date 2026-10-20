import type { Message, SessionSettings } from '@shared/types'
import type { KnowledgeKind, KnowledgeProposal } from '@shared/types/knowledge'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { getLogger } from '@/lib/utils'
import { extractFactsFromTranscript, transcriptFromMessages } from '@/packages/memory/extract'
import { isSessionMemoryAutoSaveAllowed } from '@/packages/memory/session-policy'
import { cloudSafeMessages, holdsLocalOnlyRecall } from '@/packages/model-calls/toolsets/pm-pilot-history'
import { isLocalModelProvider } from '@/packages/sources/model-check'
import { ensureMemoryStoreInit, memoryStore } from '@/stores/memoryStore'
import { proposeKnowledge } from './proposals'

const log = getLogger('knowledge-chat-proposer')

/** Sessions with a run in flight: at most one per session at a time. */
const inFlight = new Set<string>()

/** `preference` wins over `decision` (the extract prompt can emit both); anything else is a fact. */
function kindOf(tags: string[]): KnowledgeKind {
  if (tags.includes('preference')) return 'preference'
  if (tags.includes('decision')) return 'decision'
  return 'fact'
}

/**
 * After an answer: every `retainEveryNTurns` turns (when the chat allows auto-save) the session's model
 * picks durable facts from the recent transcript, and each becomes a proposal from chat. Nothing is
 * approved here (ADR 0001), and the old memory banks are neither read nor written. The turn counter is the
 * memory store's (preflight C19). Errors are logged, never toasted.
 */
export async function proposeFromChatTurn(o: {
  sessionId: string
  sessionName: string
  messageId: string
  scopeId: string | null
  messages: Message[]
  sessionSettings?: SessionSettings
}): Promise<KnowledgeProposal[]> {
  await ensureMemoryStoreInit()
  const store = memoryStore.getState()
  const settings = store.settings
  // Policy before the bump, so turning auto-save back on does not skip a cadence tick.
  if (!isSessionMemoryAutoSaveAllowed(settings, o.sessionSettings)) return []
  // A Needs you chat (slice 10, CH6) opens with client mail: its facts reach knowledge only through client_answer.
  if (o.messages.some((m) => m.pmQuestionId)) return []
  // A local model would read a local-only recall (and the answers after it) in full, and its proposals would carry no
  // source id, so once approved they could reach a cloud model (ADR 0003): such chats propose nothing on a local model.
  if (isLocalModelProvider(o.sessionSettings?.provider) && o.messages.some(holdsLocalOnlyRecall)) return []
  if (inFlight.has(o.sessionId)) return []
  const every = Math.max(1, settings.retainEveryNTurns || 3)
  if (store.bumpSessionTurn(o.sessionId) % every !== 0) return []

  inFlight.add(o.sessionId)
  try {
    // ADR 0003: a cloud model (the session's; none set counts as cloud) never gets local-only mail or tasks.
    const transcript = transcriptFromMessages(await cloudSafeMessages(o.messages, o.sessionSettings?.provider))
    if (!transcript.trim()) return []
    const extracted = await extractFactsFromTranscript({
      transcript,
      hasAgent: false,
      ...(o.sessionSettings !== undefined ? { sessionSettings: o.sessionSettings } : {}),
    })
    if (extracted.error) log.error('Knowledge extraction failed:', extracted.error)

    const scopeId = o.scopeId ?? EVERYWHERE_SCOPE_ID
    const proposals: KnowledgeProposal[] = []
    for (const fact of extracted.facts ?? []) {
      const kind = kindOf(fact.tags)
      try {
        const proposal = await proposeKnowledge({
          // ADR 0013: preferences live in Everywhere.
          scopeId: kind === 'preference' ? EVERYWHERE_SCOPE_ID : scopeId,
          kind,
          text: fact.content,
          sources: [{ kind: 'chat', label: o.sessionName, ref: o.sessionId }],
          origin: 'chat',
          sessionId: o.sessionId,
          messageId: o.messageId,
        })
        if (proposal) proposals.push(proposal)
      } catch (error) {
        log.error('Proposing knowledge from chat failed:', error)
      }
    }
    return proposals
  } catch (error) {
    log.error('Knowledge extraction failed:', error)
    return []
  } finally {
    memoryStore.getState().resetSessionTurn(o.sessionId)
    inFlight.delete(o.sessionId)
  }
}

export function _resetChatProposerForTests(): void {
  inFlight.clear()
}
