import type { ProviderInfo } from '@shared/types'
import { isEverywhere } from '@shared/types/scope'
import { isLocalHost } from '@shared/utils/network_utils'
import type { ModelReadiness, SelectedModel } from '@/utils/modelReadiness'

const NAME_MAX_CODE_POINTS = 60

/** Last-used scope if it still exists. Everywhere (and anything unknown) means no specific scope. */
export function resolveQuickScope(lastScopeId: string | null, scopes: { id: string }[]): string | null {
  if (!lastScopeId || isEverywhere(lastScopeId)) return null
  return scopes.some((scope) => scope.id === lastScopeId) ? lastScopeId : null
}

export function quickChatName(question: string): string {
  const line = question
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0)
  if (!line) return ''
  const points = Array.from(line)
  if (points.length <= NAME_MAX_CODE_POINTS) return line
  return `${points.slice(0, NAME_MAX_CODE_POINTS).join('').trimEnd()}…`
}

export function isLocalModel(model: SelectedModel | undefined, providers: ProviderInfo[]): boolean {
  if (!model) return false
  const provider = providers.find((candidate) => candidate.id === model.provider)
  const host = provider?.apiHost ?? provider?.defaultSettings?.apiHost
  return host ? isLocalHost(host) : false
}

export type QuickView = 'no-model' | 'offline' | 'empty' | 'answered' | 'rewrite'

export function resolveQuickView(input: {
  readiness: ModelReadiness
  online: boolean
  local: boolean
  hasExchange: boolean
  rewriting: boolean
}): QuickView {
  const { status } = input.readiness
  if (status === 'setup-required' || status === 'provider-unavailable' || status === 'model-unavailable') {
    return 'no-model'
  }
  if (input.rewriting) return 'rewrite'
  if (!input.online && !input.local) return 'offline'
  return input.hasExchange ? 'answered' : 'empty'
}
