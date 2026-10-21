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

/**
 * Whether the model answers without internet (a host on this device or the LAN). Not a privacy check: a LAN host is
 * another machine; local-only text goes through `isLocalModelIn` (`packages/sources/model-check`).
 */
export function reachableOffline(model: SelectedModel | undefined, providers: ProviderInfo[]): boolean {
  if (!model) return false
  const provider = providers.find((candidate) => candidate.id === model.provider)
  // An emptied host field means the default host, as when the provider sends.
  const host = provider?.apiHost || provider?.defaultSettings?.apiHost
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

/** One short sentence (an en translation key) for a raw provider error; the details stay in the chat. */
export function quickErrorSummary(error: string, errorCode?: number): string {
  const busy = 'The model is busy or out of quota. Try again in a moment.'
  const signIn = "The model didn't accept its sign-in. Check it in Settings."
  // Status codes first: a body's wording (a 401 that mentions quota, a 429 that mentions the key) can mislead.
  if (errorCode === 429) return busy
  if (errorCode === 401 || errorCode === 403) return signIn
  const text = error.toLowerCase()
  if (/\b429\b/.test(text)) return busy
  if (/\b40[13]\b/.test(text)) return signIn
  if (/rate[ _-]?limit|quota|too many requests|overloaded|insufficient/.test(text)) return busy
  if (/unauthori[sz]ed|forbidden|api[ _-]?key|invalid[ _-]?key|authentication/.test(text)) return signIn
  if (
    /context[ _-]length|maximum context|prompt is too long|input token limit/.test(text) ||
    (text.includes('token') && text.includes('exceed'))
  ) {
    return 'This chat is too long for the model.'
  }
  if (/failed to fetch|network|econn|enotfound|etimedout|timed? ?out|offline|socket/.test(text)) {
    return "Couldn't reach the model. Check your connection."
  }
  return "The model couldn't answer. Try again."
}
