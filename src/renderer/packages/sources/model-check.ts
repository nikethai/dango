import { getSystemProviders } from '@shared/providers'
import { isProviderListedInSettings } from '@shared/providers/provider-credentials'
import type { Settings } from '@shared/types'
import { ModelProviderEnum } from '@shared/types/provider'
import { normalizeOpenAIApiHostAndPath } from '@shared/utils/llm_utils'

type ChatModel = { provider: string; modelId: string }

/** The providers whose models can run on this device (ADR 0003). Only one part of `isLocalModel`. */
export const LOCAL_PROVIDERS: ReadonlySet<string> = new Set<string>([
  ModelProviderEnum.Ollama,
  ModelProviderEnum.LMStudio,
])

/** Loopback names only: a LAN address (10.x, 192.168.x) or another machine is not this device. */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** Ollama's cloud models (`gpt-oss:120b-cloud`, `deepseek:cloud`) run on ollama.com, not here. */
const CLOUD_MODEL_ID = /(?:^|[-:])cloud$/i

export type ModelRef = { provider?: string | null; modelId?: string | null }
export type ProviderHostSettings = Pick<Settings, 'providers' | 'customProviders'>

/**
 * The hostname the Ollama and LM Studio models send to: the host as `normalizeOpenAIApiHostAndPath` rewrites it (it
 * adds `https://` unless the host starts with exactly `http://` or `https://`, so `HTTP://127.0.0.1` goes to host
 * `http`).
 */
function hostnameOf(host: string): string | null {
  if (!host.trim()) return null
  try {
    return new URL(normalizeOpenAIApiHostAndPath({ apiHost: host }).apiHost).hostname
  } catch {
    return null
  }
}

/**
 * Local means all three: the provider is Ollama or LM Studio, the host the request goes to is loopback, and the model
 * is not one of Ollama's cloud models. Anything else (including an OpenAI-compatible provider on localhost) is cloud:
 * the only models a local-only source's text may reach (ADR 0003).
 */
export function isLocalModel(input: {
  providerId?: string | null
  host?: string | null
  modelId?: string | null
}): boolean {
  if (!input.providerId || !LOCAL_PROVIDERS.has(input.providerId)) return false
  const modelId = input.modelId?.trim()
  if (!modelId || CLOUD_MODEL_ID.test(modelId)) return false
  const hostname = input.host ? hostnameOf(input.host) : null
  return !!hostname && LOOPBACK_HOSTNAMES.has(hostname)
}

/**
 * The host a provider's requests go to, as `getProviderSettings` resolves it (an emptied host field means the
 * provider's default), without throwing: `''` when the provider is unknown.
 */
export function providerHost(settings: ProviderHostSettings | undefined, providerId: string): string {
  const saved = settings?.providers?.[providerId]?.apiHost
  const base = [...getSystemProviders(), ...(settings?.customProviders ?? [])].find((p) => p.id === providerId)
  return (saved || base?.defaultSettings?.apiHost || '').trim()
}

/** `isLocalModel` for the model a call actually uses, with the host from `settings` (global settings). */
export function isLocalModelIn(
  settings: ProviderHostSettings | undefined,
  model: ModelRef | null | undefined
): boolean {
  if (!model?.provider) return false
  return isLocalModel({
    providerId: model.provider,
    host: providerHost(settings, model.provider),
    modelId: model.modelId,
  })
}

/** The model background work uses: the default chat model, else the last model used in chat. */
export function backgroundModelChoice(settings: Settings, lastUsedChat?: ChatModel): ChatModel | null {
  const chosen = settings.defaultChatModel
    ? { provider: settings.defaultChatModel.provider, modelId: settings.defaultChatModel.model }
    : lastUsedChat
  return chosen?.provider && chosen.modelId ? chosen : null
}

/** True when that model's provider is set up (credentials, or a local or custom provider with models). */
export function hasUsableModel(settings: Settings, lastUsedChat?: ChatModel): boolean {
  const chosen = backgroundModelChoice(settings, lastUsedChat)
  if (!chosen) return false
  const base = [...getSystemProviders(), ...(settings.customProviders ?? [])].find((p) => p.id === chosen.provider)
  return !!base && isProviderListedInSettings(base, settings.providers?.[chosen.provider])
}
