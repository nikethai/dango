import { ApiError } from '../../../models/errors'
import OpenAICompatible, { type OpenAICompatibleSettings } from '../../../models/openai-compatible'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'
import { fetchXaiModels } from '../../oauth/xai-models'

interface Options extends OpenAICompatibleSettings {}

function isXaiImageModel(modelId: string): boolean {
  const id = (modelId || '').toLowerCase()
  return id.includes('imagine-image') || id.includes('grok-imagine') || id.includes('grok-2-image')
}

export default class XAI extends OpenAICompatible {
  public name = 'xAI'
  public options: Options
  constructor(options: Omit<Options, 'apiHost'>, dependencies: ModelDependencies) {
    const apiHost = 'https://api.x.ai/v1'
    super(
      {
        apiKey: options.apiKey,
        apiHost,
        cloudflareClientId: options.cloudflareClientId,
        cloudflareClientSecret: options.cloudflareClientSecret,
        model: options.model,
        temperature: options.temperature,
        topP: options.topP,
        maxOutputTokens: options.maxOutputTokens,
        stream: options.stream,
      },
      dependencies
    )
    this.options = {
      ...options,
      apiHost,
    }
  }

  /**
   * Prefer desktop-native HTTP (no CORS) for SuperGrok OAuth / API key model lists.
   */
  public async listModels(): Promise<ProviderModelInfo[]> {
    if (!this.options.apiKey) {
      return []
    }
    try {
      return await fetchXaiModels(this.options.apiKey, { apiBase: this.options.apiHost })
    } catch (err) {
      console.error('[xAI] listModels failed', err)
      // Fall back to OpenAI-compatible path (may still CORS-fail in webview)
      return super.listModels()
    }
  }

  /**
   * Grok Imagine image generation via OpenAI-compatible Images API.
   * https://api.x.ai/v1/images/generations
   */
  public async paint(
    params: {
      prompt: string
      images?: { imageUrl: string }[]
      num: number
      aspectRatio?: string
    },
    signal?: AbortSignal,
    callback?: (picBase64: string) => void | Promise<void>,
    _onProviderJobUpdate?: (data: { providerJobId?: string; queueNumber?: number }) => void
  ): Promise<string[]> {
    const modelId = this.options.model.modelId
    if (!isXaiImageModel(modelId)) {
      throw new ApiError(`xAI model "${modelId}" does not support image generation. Use grok-imagine-image.`)
    }
    if (!this.options.apiKey) {
      throw new ApiError('xAI is not signed in. Open Settings → Providers → xAI and sign in with SuperGrok.')
    }

    const n = Math.min(Math.max(1, params.num || 1), 10)
    const referenceImages = (params.images || [])
      .map((image) => image.imageUrl)
      .filter((url): url is string => Boolean(url))
    const body: Record<string, unknown> = {
      model: modelId,
      prompt: params.prompt,
      n,
      // Prefer base64 so we can store without a second network hop
      response_format: 'b64_json',
    }
    if (params.aspectRatio && params.aspectRatio !== 'auto') {
      body.aspect_ratio = params.aspectRatio
    }
    // Grok Imagine image-to-image: pass reference image URLs/data URLs when editing.
    if (referenceImages.length > 0) {
      body.image = referenceImages[0]
      if (referenceImages.length > 1) {
        body.images = referenceImages
      }
    }

    const res = await this.dependencies.request.apiRequest({
      url: `${this.options.apiHost.replace(/\/+$/, '')}/images/generations`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: signal || undefined,
      useProxy: this.options.useProxy,
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText)
      throw new ApiError(`xAI image generation failed (${res.status}): ${errText.slice(0, 400)}`)
    }

    const json = (await res.json()) as {
      data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>
      error?: { message?: string }
    }

    if (json.error?.message) {
      throw new ApiError(json.error.message)
    }

    const results: string[] = []
    for (const item of json.data || []) {
      let dataUrl: string | null = null
      if (item.b64_json) {
        dataUrl = item.b64_json.startsWith('data:') ? item.b64_json : `data:image/png;base64,${item.b64_json}`
      } else if (item.url) {
        // Download URL → base64 data URL
        const imgRes = await this.dependencies.request.apiRequest({
          url: item.url,
          method: 'GET',
          headers: {},
          signal: signal || undefined,
          useProxy: this.options.useProxy,
        })
        if (imgRes.ok) {
          const buf = await imgRes.arrayBuffer()
          const bytes = new Uint8Array(buf)
          let binary = ''
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
          const b64 = btoa(binary)
          const ctype = imgRes.headers.get('content-type') || 'image/png'
          dataUrl = `data:${ctype};base64,${b64}`
        }
      }
      if (dataUrl) {
        results.push(dataUrl)
        await callback?.(dataUrl)
      }
    }

    if (results.length === 0) {
      throw new ApiError('xAI image generation returned no images')
    }
    return results
  }
}
