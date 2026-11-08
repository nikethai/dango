import { AIProviderNoImplementedChatError, ApiError } from '../../../models/errors'
import type { CallChatCompletionOptions, ModelInterface } from '../../../models/types'
import type { ProviderModelInfo, ProviderSettings } from '../../../types'
import { ComfyUIClient } from './comfyui-client'
import type { ComfyUIGenerationParams } from './comfyui-types'
import { DEFAULT_COMFYUI_LORA_STRENGTH, normalizeComfyUILoras, resolveComfyUIOption } from './comfyui-utils'
import { buildComfyUIWorkflow, DEFAULT_NEGATIVE_PROMPT } from './comfyui-workflow'

export interface ComfyUIModelOptions {
  apiHost: string
  model: ProviderModelInfo
  providerSettings: ProviderSettings
}

export default class ComfyUI implements ModelInterface {
  public name = 'ComfyUI'
  public modelId: string

  private client: ComfyUIClient
  private providerSettings: ProviderSettings

  constructor(options: ComfyUIModelOptions) {
    this.modelId = options.model.modelId
    this.client = new ComfyUIClient(options.apiHost)
    this.providerSettings = options.providerSettings
  }

  isSupportVision(): boolean {
    return false
  }

  isSupportToolUse(): boolean {
    return false
  }

  isSupportSystemMessage(): boolean {
    return false
  }

  chat(_messages: unknown[], _options: CallChatCompletionOptions): never {
    throw new AIProviderNoImplementedChatError('ComfyUI')
  }

  async paint(
    params: {
      prompt: string
      images?: { imageUrl: string }[]
      num: number
      aspectRatio?: string
      comfyuiParams?: ComfyUIGenerationParams
    },
    signal?: AbortSignal,
    callback?: (picBase64: string) => void | Promise<void>,
    onProviderJobUpdate?: (data: { providerJobId?: string; queueNumber?: number }) => void
  ): Promise<string[]> {
    const ps = this.providerSettings

    // Merge provider settings defaults with per-generation overrides
    const genParams: ComfyUIGenerationParams & { prompt: string } = {
      checkpoint: ps.comfyuiCheckpoint,
      loras: ps.comfyuiLoras,
      lora: ps.comfyuiLora,
      loraStrength: ps.comfyuiLoraStrength ?? DEFAULT_COMFYUI_LORA_STRENGTH,
      negativePrompt: ps.comfyuiNegativePrompt ?? DEFAULT_NEGATIVE_PROMPT,
      steps: ps.comfyuiDefaultSteps ?? 29,
      cfg: ps.comfyuiDefaultCfg ?? 4.9,
      samplerName: ps.comfyuiDefaultSampler ?? 'euler_ancestral',
      scheduler: ps.comfyuiDefaultScheduler ?? 'simple',
      orientation: 'vertical',
      upscale: false,
      ...params.comfyuiParams,
      prompt: params.prompt,
    }

    if (!params.comfyuiParams?.orientation && params.aspectRatio) {
      genParams.orientation = params.aspectRatio === 'horizontal' ? 'horizontal' : 'vertical'
    }

    if (!genParams.checkpoint) {
      throw new ApiError(
        'No checkpoint configured. Please go to Settings → Providers → ComfyUI and select a checkpoint from your server.'
      )
    }

    genParams.loras = normalizeComfyUILoras(genParams)

    try {
      const objectInfo = await this.client.getObjectInfo()
      const serverInfo = this.client.parseServerInfo(objectInfo)

      genParams.checkpoint = resolveComfyUIOption(genParams.checkpoint, serverInfo.checkpoints)
      genParams.loras = genParams.loras.map((lora) => ({
        ...lora,
        name: resolveComfyUIOption(lora.name, serverInfo.loras) ?? lora.name,
      }))
      genParams.samplerName = resolveComfyUIOption(genParams.samplerName, serverInfo.samplers)
      genParams.scheduler = resolveComfyUIOption(genParams.scheduler, serverInfo.schedulers)
    } catch {
      // Continue with the saved values if preflight metadata fetch fails.
    }

    const results: string[] = []
    let referenceImageName: string | undefined
    const firstReference = params.images?.find((image) => Boolean(image.imageUrl))?.imageUrl
    if (firstReference) {
      referenceImageName = await this.client.uploadImage(firstReference, `dango-ref-${Date.now()}.png`)
    }

    for (let i = 0; i < params.num; i++) {
      if (signal?.aborted) {
        throw new DOMException('Generation was cancelled', 'AbortError')
      }

      const workflow = buildComfyUIWorkflow({
        ...genParams,
        seed: Math.floor(Math.random() * 2 ** 32),
        referenceImageName,
        denoise: referenceImageName ? 0.65 : undefined,
      })

      const { prompt_id, number } = await this.client.queuePrompt(workflow)
      onProviderJobUpdate?.({
        providerJobId: prompt_id,
        queueNumber: number,
      })
      const history = await this.client.pollForCompletion(prompt_id, signal)

      const outputNode = history.outputs['9']
      if (!outputNode?.images || outputNode.images.length === 0) {
        throw new ApiError('ComfyUI produced no output images')
      }

      for (const img of outputNode.images) {
        const dataUrl = await this.client.getImage(img.filename, img.subfolder, img.type)
        results.push(dataUrl)
        await callback?.(dataUrl)
      }
    }

    return results
  }
}
