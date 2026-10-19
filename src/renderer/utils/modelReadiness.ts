import type { ProviderInfo, ProviderModelInfo } from '@shared/types'

export type SelectedModel = { provider: string; modelId: string }

/** An ability a turn needs from its model. */
export type ModelAbility = 'vision' | 'tool_use'

/** What a turn needs from its model, checked before sending. */
export type ModelNeeds = { requiresVision?: boolean; requiresTools?: boolean }

export type ModelReadiness =
  | { status: 'setup-required' }
  | { status: 'provider-unavailable'; providerId: string }
  | { status: 'model-unavailable'; providerId: string; modelId: string }
  | { status: 'capability-required'; providerId: string; modelId: string; capability: ModelAbility }
  | { status: 'ready'; providerId: string; modelId: string }

/**
 * A turn needs tools when Agent Mode, the browser or the computer is on, or a room runs as a swarm. Web search and
 * knowledge bases are not counted: they fall back to answers without tools.
 */
export function turnNeedsTools(s: {
  agentMode?: boolean
  browserArmed?: boolean
  computerArmed?: boolean
  roomMode?: string
}): boolean {
  return Boolean(s.agentMode || s.browserArmed || s.computerArmed || s.roomMode === 'swarm')
}

/** An OCR model is set (Settings › Default models): a model without vision still reads pictures through it. */
export function isOcrModelSet(settings: { ocrModel?: { provider?: string; model?: string } }): boolean {
  return Boolean(settings.ocrModel?.provider && settings.ocrModel?.model)
}

/** Attachments need a vision model: video always; pictures only when no OCR model reads them for the model. */
export function attachmentsNeedVision(a: { pictureCount: number; hasVideo: boolean; ocrReady: boolean }): boolean {
  return a.hasVideo || (a.pictureCount > 0 && !a.ocrReady)
}

/** The first ability the model is known to lack; a model whose capabilities are unknown lacks nothing. */
function missingAbility(model: Pick<ProviderModelInfo, 'capabilities'>, needs: ModelNeeds): ModelAbility | null {
  if (!model.capabilities) return null
  if (needs.requiresVision && !model.capabilities.includes('vision')) return 'vision'
  if (needs.requiresTools && !model.capabilities.includes('tool_use')) return 'tool_use'
  return null
}

/** Whether a model can take a turn with these needs. Unknown capabilities never block. */
export function modelMeetsNeeds(model: Pick<ProviderModelInfo, 'capabilities'>, needs: ModelNeeds): boolean {
  return missingAbility(model, needs) === null
}

export function getModelReadiness(
  selectedModel: SelectedModel | undefined,
  providers: ProviderInfo[],
  options: ModelNeeds = {}
): ModelReadiness {
  if (!selectedModel) return { status: 'setup-required' }

  const provider = providers.find((candidate) => candidate.id === selectedModel.provider)
  if (!provider) return { status: 'provider-unavailable', providerId: selectedModel.provider }

  const model = (provider.models || provider.defaultSettings?.models)?.find(
    (candidate) => candidate.modelId === selectedModel.modelId
  )
  if (!model) {
    return {
      status: 'model-unavailable',
      providerId: selectedModel.provider,
      modelId: selectedModel.modelId,
    }
  }

  const missing = missingAbility(model, options)
  if (missing) {
    return {
      status: 'capability-required',
      providerId: selectedModel.provider,
      modelId: selectedModel.modelId,
      capability: missing,
    }
  }

  return { status: 'ready', providerId: selectedModel.provider, modelId: selectedModel.modelId }
}
