/**
 * The before-send gate: cost (CS1) and abilities (ER4), checked before a turn starts and never during one.
 * The composer and the message actions (Redo, Redo ▾, Reply Again Below, edit-and-resend) all ask here, and one
 * `BeforeSendHost` per route shows the cost sheet. Generation and model calls never import this.
 */

import type { Message, Session } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import { t } from 'i18next'
import { createStore } from 'zustand/vanilla'
import { chatProvidersFromSettings } from '@/hooks/useProviders'
import { getCostWarningUsd } from '@/packages/chat-settings'
import {
  type CostEstimateInput,
  DEFAULT_OUTPUT_TOKENS,
  estimateTurnCostUsd,
  formatUsdEstimate,
  isLocalModelProvider,
  shouldShowCostSheet,
} from '@/packages/cost-tracking/headsUp'
import type { PricingOverrides } from '@/packages/cost-tracking/types'
import { estimateTokensFromMessages } from '@/packages/token'
import { getSession, peekSession } from '@/stores/chatStore'
import { turnAbilityNeeds } from '@/stores/session/redo-needs'
import { settingsStore } from '@/stores/settingsStore'
import * as toastActions from '@/stores/toastActions'
import { getModelDisplayName } from '@/utils/modelDisplayName'
import { getModelReadiness, isOcrModelSet, type SelectedModel } from '@/utils/modelReadiness'

export type CostHeadsUpInput = CostEstimateInput & {
  /** Shown in the sheet; falls back to the model id. */
  modelName?: string
}

/** The open cost question: what the sheet shows, and how to answer it. */
export type CostAsk = {
  cost: string
  limit: string
  model: string
  tokens: string
  /** Whoever asked; lets a composer that goes away cancel only its own question. */
  owner?: object
  resolve(run: boolean): void
}

type GateState = { ask: CostAsk | null; hosts: number }

export const beforeSendStore = createStore<GateState>(() => ({ ask: null, hosts: 0 }))

/** Answers the open question (Run or Cancel) and closes the sheet. */
export function settleCostHeadsUp(run: boolean): void {
  const ask = beforeSendStore.getState().ask
  beforeSendStore.setState({ ask: null })
  ask?.resolve(run)
}

/** Cancels the open question when `owner` asked it (a composer that unmounts). */
export function cancelCostHeadsUpFrom(owner: object): void {
  if (beforeSendStore.getState().ask?.owner === owner) settleCostHeadsUp(false)
}

/** A host shows the sheet. The last host to go away answers Cancel, so no send waits forever. */
export function registerBeforeSendHost(): () => void {
  beforeSendStore.setState((s) => ({ hosts: s.hosts + 1 }))
  return () => {
    beforeSendStore.setState((s) => ({ hosts: Math.max(0, s.hosts - 1) }))
    if (beforeSendStore.getState().hosts === 0) settleCostHeadsUp(false)
  }
}

/**
 * CS1: before a send that may cost more than the user's limit, ask once. Resolves true to send; Cancel or Esc
 * resolves false. Under the limit, for local or unpriced models, or with the limit off it resolves true at once.
 */
export function askCostHeadsUp(input: CostHeadsUpInput, owner?: object): Promise<boolean> {
  const settings = settingsStore.getState()
  const limitUsd = getCostWarningUsd(settings)
  const overrides = (settings as { usagePricingOverrides?: PricingOverrides }).usagePricingOverrides
  const estimateUsd = estimateTurnCostUsd(input, overrides)
  const local = isLocalModelProvider(input.providerId, input.apiHost)
  if (!shouldShowCostSheet({ estimateUsd, limitUsd, local })) return Promise.resolve(true)
  if (beforeSendStore.getState().hosts === 0) {
    // Nowhere to ask (a surface without a host, such as Quick Chat): never block a send on a sheet no one sees.
    console.warn('Cost heads-up skipped: no before-send host is mounted')
    return Promise.resolve(true)
  }
  // A second ask replaces the first; the first one is a Cancel.
  settleCostHeadsUp(false)
  const runs = Math.max(1, input.runs)
  const tokens = (Math.max(0, input.inputTokens) + (input.maxOutputTokens ?? DEFAULT_OUTPUT_TOKENS)) * runs
  return new Promise<boolean>((resolve) => {
    beforeSendStore.setState({
      ask: {
        cost: formatUsdEstimate(estimateUsd ?? 0),
        limit: formatUsdEstimate(limitUsd),
        model: input.modelName || input.modelId,
        tokens: tokens.toLocaleString(),
        owner,
        resolve,
      },
    })
  })
}

/** A rough input size (characters / 4) for when exact counts are not ready. */
export function estimateInputTokens(messages: Message[]): number {
  let chars = 0
  for (const message of messages) chars += getMessageText(message, false, false).length
  return Math.ceil(chars / 4)
}

/** The provider's API host, so a model on the user's own network is never priced. */
export function providerApiHost(providerId: string): string | undefined {
  const settings = settingsStore.getState()
  return (
    settings.providers?.[providerId]?.apiHost ||
    chatProvidersFromSettings(settings.providers, settings.customProviders).find((p) => p.id === providerId)
      ?.defaultSettings?.apiHost
  )
}

/** Model calls one send makes: a Swarm room runs each agent twice. */
export function runsForRoom(roomMode: string | undefined, roomSize: number): number {
  return roomMode === 'swarm' && roomSize > 1 ? roomSize * 2 : 1
}

export type MessageAction =
  /** Redo: the answer again with the chat's model. */
  | { kind: 'redo'; messageId: string }
  /** Redo ▾: the answer again with another model. Its list already offers only models that can take the turn. */
  | { kind: 'redo-with-model'; messageId: string; model: SelectedModel }
  /** Reply Again Below: another answer under a question. */
  | { kind: 'reply-below'; messageId: string }
  /** Edit a question and send it again. */
  | { kind: 'edit-resend'; messageId: string; text: string }

function messageListOf(session: Session, messageId: string): Message[] | null {
  if (session.messages.some((m) => m.id === messageId)) return session.messages
  return session.threads?.find((thread) => thread.messages.some((m) => m.id === messageId))?.messages ?? null
}

/** What the model reads for this action: the thread up to the message (an answer being redone is left out). */
function contextFor(list: Message[], action: MessageAction): Message[] {
  const index = list.findIndex((m) => m.id === action.messageId)
  if (index < 0) return list
  const target = list[index]
  if (target.role === 'assistant') return list.slice(0, index)
  if (action.kind === 'edit-resend') {
    return [...list.slice(0, index), { ...target, contentParts: [{ type: 'text', text: action.text }] }]
  }
  return list.slice(0, index + 1)
}

/**
 * Before a message action runs a turn: abilities (Redo, Reply Again Below, edit-and-resend: a model that lacks one
 * does not run, and a toast says why; the composer's notice offers the fix), then cost, priced at the model that will
 * answer (the picked one for Redo ▾). Resolves true to run.
 */
export async function requestBeforeSend(sessionId: string, action: MessageAction): Promise<boolean> {
  const session = peekSession(sessionId) ?? (await getSession(sessionId))
  if (!session || session.type === 'picture') return true
  const list = messageListOf(session, action.messageId)
  if (!list) return true

  const settings = settingsStore.getState()
  const providers = chatProvidersFromSettings(settings.providers, settings.customProviders)
  const chatModel =
    session.settings?.provider && session.settings?.modelId
      ? { provider: session.settings.provider, modelId: session.settings.modelId }
      : undefined
  const model = action.kind === 'redo-with-model' ? action.model : chatModel
  if (!model) return true
  const modelName = getModelDisplayName(providers, model) || model.modelId

  if (action.kind !== 'redo-with-model') {
    const needs = turnAbilityNeeds(session, action.messageId, { ocrReady: isOcrModelSet(settings) })
    const readiness = getModelReadiness(model, providers, needs)
    if (readiness.status === 'capability-required') {
      toastActions.add(
        readiness.capability === 'tool_use'
          ? t("{{model}} can't use tools.", { model: modelName })
          : t('This model cannot analyze attachments. Choose a vision model.')
      )
      return false
    }
  }

  const roomSize = session.agentIds?.length ?? 0
  return askCostHeadsUp({
    providerId: model.provider,
    modelId: model.modelId,
    apiHost: providerApiHost(model.provider),
    // Tokenizer counts (CJK-accurate) including attached files and links, priced for the model that answers.
    inputTokens: estimateTokensFromMessages(contextFor(list, action), 'input', model),
    maxOutputTokens: session.settings?.maxTokens,
    runs: runsForRoom(roomSize > 1 ? session.roomMode : undefined, roomSize),
    modelName,
  })
}
