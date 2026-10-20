import type { LanguageModelV3 } from '@ai-sdk/provider'
import {
  APICallError,
  type EmbeddingModel,
  type FinishReason,
  experimental_generateImage as generateImage,
  type ImageModel,
  type JSONValue,
  type LanguageModelUsage,
  type ModelMessage,
  type Provider,
  type ProviderMetadata,
  RetryError,
  simulateStreamingMiddleware,
  stepCountIs,
  streamText,
  type TextStreamPart,
  type ToolSet,
  type TypedToolCall,
  type TypedToolError,
  type TypedToolResult,
  wrapLanguageModel,
} from 'ai'
import { createRetryable, isErrorAttempt, type RetryContext } from 'ai-retry'
import type {
  GroundingMetadata,
  MessageContentParts,
  MessageReasoningPart,
  MessageTextPart,
  MessageToolCallPart,
  ProviderModelInfo,
  SearchCitation,
  StreamTextResult,
} from '../types'
import { isSensitiveToolName, redactSensitiveToolPayload } from '../privacy/sensitive-tools'

/** Metadata-only tool error payload persisted on message parts. */
export function persistedSensitiveToolErrorResult(toolName: string, serializedError: unknown, input: unknown) {
  return {
    error: serializedError,
    input: isSensitiveToolName(toolName) ? redactSensitiveToolPayload(toolName, input) : input,
    toolName,
  }
}
import type { ModelDependencies } from '../types/adapters'
import { annotateTextWithGrounding, groundingMetadataToCitations } from '../utils/search'
import { ApiError, ProviderAPIError } from './errors'
import { apiErrorFromCallError } from './retry-after'
import {
  applyReasoningDelta,
  applyTextDelta,
  finalizeReasoningDuration,
  flushPendingStreamText,
  resolveStreamResultText,
  type StreamContentCursor,
} from './stream-content-parts'
import type { CallChatCompletionOptions, ModelInterface } from './types'

const RETRY_CONFIG = {
  MAX_ATTEMPTS: 5,
  INITIAL_DELAY_MS: 1000,
  BACKOFF_FACTOR: 2,
} as const

function is5xxError(error: unknown): boolean {
  if (APICallError.isInstance(error)) {
    const statusCode = error.statusCode
    return statusCode !== undefined && statusCode >= 500 && statusCode < 600
  }
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const statusCode = (error as { statusCode: unknown }).statusCode
    return typeof statusCode === 'number' && statusCode >= 500 && statusCode < 600
  }
  if (error instanceof ApiError && error.message) {
    const match = error.message.match(/Status Code (\d+)/)
    if (match) {
      const statusCode = parseInt(match[1], 10)
      return statusCode >= 500 && statusCode < 600
    }
  }
  return false
}

// ai sdk CallSettings
export interface CallSettings {
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  providerOptions?: Record<string, Record<string, JSONValue>>
}

interface ToolExecutionResult {
  toolCallId: string
  result: unknown
  isError?: boolean
}

type FinalResultMetadata = Pick<StreamTextResult, 'citations' | 'searchProvider' | 'searchQuery' | 'groundingMetadata'>
type UsageWithDetails = LanguageModelUsage & {
  reasoningTokens?: number
  cachedInputTokens?: number
  inputTokensDetails?: {
    cachedTokens?: number
  }
  input_tokens_details?: {
    cached_tokens?: number
  }
  outputTokensDetails?: {
    reasoningTokens?: number
  }
  output_tokens_details?: {
    reasoning_tokens?: number
  }
}

function normalizeUsage(usage?: LanguageModelUsage): LanguageModelUsage | undefined {
  if (!usage) return undefined
  const detailedUsage = usage as UsageWithDetails
  const cachedInputTokens =
    detailedUsage.cachedInputTokens ??
    detailedUsage.inputTokensDetails?.cachedTokens ??
    detailedUsage.input_tokens_details?.cached_tokens
  const reasoningTokens =
    detailedUsage.reasoningTokens ??
    detailedUsage.outputTokensDetails?.reasoningTokens ??
    detailedUsage.output_tokens_details?.reasoning_tokens

  return {
    ...usage,
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
  }
}

export default abstract class AbstractAISDKModel implements ModelInterface {
  public name = 'AI SDK Model'
  public injectDefaultMetadata = true
  public modelId = ''

  public isSupportToolUse() {
    return this.options.model.capabilities?.includes('tool_use') || false
  }
  public isSupportVision() {
    return this.options.model.capabilities?.includes('vision') || false
  }
  public isSupportReasoning() {
    return this.options.model.capabilities?.includes('reasoning') || false
  }

  static isSupportTextEmbedding() {
    return false
  }

  public constructor(
    public options: { model: ProviderModelInfo; stream?: boolean },
    protected dependencies: ModelDependencies
  ) {
    this.modelId = options.model.modelId
  }

  protected abstract getProvider(
    options: CallChatCompletionOptions
  ): Pick<Provider, 'languageModel'> & Partial<Pick<Provider, 'embeddingModel' | 'imageModel'>>

  protected abstract getChatModel(options: CallChatCompletionOptions): LanguageModelV3

  protected getImageModel(): ImageModel | null {
    return null
  }

  protected getTextEmbeddingModel(options: CallChatCompletionOptions): EmbeddingModel | null {
    const provider = this.getProvider(options)
    if (provider.embeddingModel) {
      return provider.embeddingModel(this.options.model.modelId)
    }
    return null
  }

  public isSupportSystemMessage() {
    return true
  }

  protected getCallSettings(_options: CallChatCompletionOptions): CallSettings {
    return {}
  }

  public async chat(messages: ModelMessage[], options: CallChatCompletionOptions): Promise<StreamTextResult> {
    try {
      return await this._callChatCompletion(messages, options)
    } catch (e) {
      if (e instanceof ProviderAPIError) {
        throw e
      }
      // (legacy comment removed)
      if (
        e instanceof ApiError &&
        e.message.includes('Invalid content type. image_url is only supported by certain models.')
      ) {
        throw ProviderAPIError.fromCodeName('model_not_support_image', 'model_not_support_image_2')
      }

      if (options.contentPrivacy !== 'ephemeral') {
        this.dependencies.sentry.withScope((scope) => {
          scope.setTag('provider_name', this.name)
          scope.setExtra('messages', JSON.stringify(messages))
          scope.setExtra('options', JSON.stringify(options))
          this.dependencies.sentry.captureException(e)
        })
      }
      throw e
    }
  }

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
    const imageModel = this.getImageModel()
    if (!imageModel) {
      throw new ApiError('Provider doesnt support image generation')
    }

    const referenceImages = (params.images || [])
      .map((image) => image.imageUrl)
      .filter((url): url is string => Boolean(url))

    const prompt =
      referenceImages.length > 0
        ? {
            text: params.prompt,
            images: referenceImages,
          }
        : params.prompt

    const result = await generateImage({
      model: imageModel,
      prompt,
      n: params.num,
      aspectRatio:
        params.aspectRatio && params.aspectRatio !== 'auto' ? (params.aspectRatio as `${number}:${number}`) : undefined,
      abortSignal: signal,
    })
    const dataUrls = result.images.map((image) => `data:${image.mediaType};base64,${image.base64}`)
    for (const dataUrl of dataUrls) {
      await callback?.(dataUrl)
    }
    return dataUrls
  }

  /**
   * Adds a content part to the message and handles timing for reasoning parts
   * @param contentPart - The content part to add
   * @param contentParts - Array of existing content parts
   * @param options - Call options with result change callback
   */
  private addContentPart(
    contentPart: MessageContentParts[number],
    contentParts: MessageContentParts,
    options: CallChatCompletionOptions
  ): void {
    // Handle timing for reasoning parts in non-streaming mode
    if (contentPart.type === 'reasoning') {
      const reasoningPart = contentPart as MessageReasoningPart
      const now = Date.now()
      reasoningPart.startTime = now
      // In non-streaming mode, reasoning content arrives complete, so we set
      // a minimal duration to indicate the thinking process occurred
      reasoningPart.duration = 1
    }
    contentParts.push(contentPart)
    options.onResultChange?.({ contentParts })
  }

  private processToolCalls<T extends ToolSet>(
    toolCalls: TypedToolCall<T>[],
    contentParts: MessageContentParts,
    options: CallChatCompletionOptions
  ): void {
    for (const toolCall of toolCalls) {
      const args = isSensitiveToolName(toolCall.toolName)
        ? redactSensitiveToolPayload(toolCall.toolName, toolCall.input)
        : toolCall.input
      this.addContentPart(
        {
          type: 'tool-call',
          state: 'call',
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          args,
        },
        contentParts,
        options
      )
    }
  }

  private processToolResults<T extends ToolSet>(
    toolResults: TypedToolResult<T>[],
    contentParts: MessageContentParts,
    options: CallChatCompletionOptions
  ): void {
    for (const toolResult of toolResults) {
      const result = toolResult.output
      const mappedResult: ToolExecutionResult = {
        toolCallId: toolResult.toolCallId,
        result,
      }
      this.updateToolResultPart(mappedResult, contentParts)
      options.onResultChange?.({ contentParts })
    }
  }

  private processToolErrors<T extends ToolSet>(
    toolErrors: TypedToolError<T>[],
    contentParts: MessageContentParts,
    options: CallChatCompletionOptions
  ): void {
    for (const toolError of toolErrors) {
      const serializedError =
        toolError.error instanceof Error
          ? {
              name: toolError.error.name,
              message: toolError.error.message,
              stack: toolError.error.stack,
            }
          : toolError.error
      const mappedResult: ToolExecutionResult = {
        toolCallId: toolError.toolCallId,
        result: persistedSensitiveToolErrorResult(toolError.toolName, serializedError, toolError.input),
        isError: true,
      }
      this.updateToolResultPart(mappedResult, contentParts)
      options.onResultChange?.({ contentParts })
    }
  }

  private updateToolResultPart(toolResult: ToolExecutionResult, contentParts: MessageContentParts): void {
    const toolCallPart = contentParts.find((p) => p.type === 'tool-call' && p.toolCallId === toolResult.toolCallId) as
      | MessageToolCallPart
      | undefined

    if (toolCallPart) {
      const isError = toolResult.isError || (toolResult.result as unknown) instanceof Error
      if (isError) {
        const sensitive = isSensitiveToolName(toolCallPart.toolName)
        if ((toolResult.result as unknown) instanceof Error) {
          const error = toolResult.result as Error
          if (!sensitive) {
            console.debug('mcp tool execute error', error)
          }
          toolCallPart.result = {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        } else {
          const payload = toolResult.result ?? { message: 'Unknown tool error' }
          if (!sensitive) {
            console.debug('mcp tool execute error', payload)
          }
          if (sensitive && payload && typeof payload === 'object') {
            const rec = payload as Record<string, unknown>
            toolCallPart.result = persistedSensitiveToolErrorResult(
              toolCallPart.toolName,
              rec.error ?? rec.message,
              rec.input ?? rec
            )
          } else {
            toolCallPart.result = payload
          }
        }
        toolCallPart.state = 'error'
      } else {
        toolCallPart.state = 'result'
        toolCallPart.result = isSensitiveToolName(toolCallPart.toolName)
          ? redactSensitiveToolPayload(toolCallPart.toolName, toolResult.result)
          : toolResult.result
      }
    }
  }

  private async processImageFile(
    mimeType: string,
    base64: string,
    contentParts: MessageContentParts,
    responseType: 'response' = 'response'
  ): Promise<void> {
    const storageKey = await this.dependencies.storage.saveImage(responseType, `data:${mimeType};base64,${base64}`)
    contentParts.push({ type: 'image', storageKey })
  }

  private async processStreamChunk<T extends ToolSet>(
    chunk: TextStreamPart<T>,
    cursor: StreamContentCursor,
    _options: CallChatCompletionOptions
  ): Promise<StreamContentCursor> {
    const { contentParts } = cursor

    switch (chunk.type) {
      case 'text-delta':
        // Whitespace-only deltas do not end reasoning; leading whitespace is buffered.
        return applyTextDelta(cursor, chunk.text)

      case 'reasoning-delta':
        // Some providers may emit empty reasoning chunks; ignore only truly empty deltas.
        // Keep whitespace-only chunks (e.g. '\n') so formatting is preserved in the UI.
        return applyReasoningDelta(cursor, chunk.text)

      case 'tool-call': {
        // Any pending answer whitespace is flushed before tool work so it is not lost.
        const next = flushPendingStreamText(cursor)
        finalizeReasoningDuration(next.currentReasoningPart)
        this.processToolCalls([chunk], next.contentParts, _options)
        return {
          contentParts: next.contentParts,
          currentTextPart: undefined,
          currentReasoningPart: undefined,
          pendingTextWhitespace: '',
        }
      }

      case 'tool-result':
        this.processToolResults([chunk], contentParts, _options)
        return cursor
      case 'tool-error': {
        const next = flushPendingStreamText(cursor)
        finalizeReasoningDuration(next.currentReasoningPart)
        this.processToolErrors([chunk], next.contentParts, _options)
        return {
          contentParts: next.contentParts,
          currentTextPart: undefined,
          currentReasoningPart: undefined,
          pendingTextWhitespace: '',
        }
      }

      case 'file':
        if (chunk.file.mediaType?.startsWith('image/') && chunk.file.base64) {
          const next = flushPendingStreamText(cursor)
          finalizeReasoningDuration(next.currentReasoningPart)
          await this.processImageFile(chunk.file.mediaType, chunk.file.base64, next.contentParts)
          return {
            contentParts: next.contentParts,
            currentTextPart: undefined,
            currentReasoningPart: undefined,
            pendingTextWhitespace: '',
          }
        }
        return cursor
      case 'error':
        this.handleError(chunk.error)
        return cursor
      case 'finish':
        return cursor
      default:
        return cursor
    }
  }

  private handleError(error: unknown, context: string = ''): never {
    // streamText retries in-request, then wraps the last failed call in a RetryError: keep its status and Retry-After.
    if (APICallError.isInstance(error) || (RetryError.isInstance(error) && APICallError.isInstance(error.lastError))) {
      throw apiErrorFromCallError(error, `${this.name}${context}`)
    }
    if (error instanceof ApiError) {
      throw error
    }
    if (error instanceof ProviderAPIError) {
      throw error
    }
    throw new ApiError(`Error from ${this.name}${context}: ${error}`)
  }

  /**
   * Finalizes the result and ensures all reasoning parts have duration set
   * This is a fallback to ensure timing is captured even if not set during streaming
   * @param contentParts - Array of message content parts
   * @param usage - Token usage information
   * @param options - Call options with result change callback
   * @returns The finalized stream text result
   */
  private finalizeResult(
    contentParts: MessageContentParts,
    result: {
      usage?: LanguageModelUsage
      finishReason?: FinishReason
      tokenSpeed?: number
      text?: string
    },
    finalResultMetadata: FinalResultMetadata,
    options: CallChatCompletionOptions
  ): StreamTextResult {
    // Fallback: Set final duration for any reasoning parts that don't have it yet
    // This should rarely be needed since we capture duration at transition points,
    // but provides safety for edge cases
    const now = Date.now()
    for (const part of contentParts) {
      if (part.type === 'reasoning' && part.startTime && !part.duration) {
        part.duration = now - part.startTime
      }
    }

    const normalizedUsage = normalizeUsage(result.usage)

    options.onResultChange?.({
      contentParts,
      citations: finalResultMetadata.citations,
      searchProvider: finalResultMetadata.searchProvider,
      searchQuery: finalResultMetadata.searchQuery,
      groundingMetadata: finalResultMetadata.groundingMetadata,
      tokenCount: normalizedUsage?.outputTokens,
      tokensUsed: normalizedUsage?.totalTokens,
      tokenSpeed: result.tokenSpeed,
    })
    return {
      contentParts,
      text: result.text,
      usage: normalizedUsage,
      finishReason: result.finishReason,
      citations: finalResultMetadata.citations,
      searchProvider: finalResultMetadata.searchProvider,
      searchQuery: finalResultMetadata.searchQuery,
      groundingMetadata: finalResultMetadata.groundingMetadata,
    }
  }

  private extractFinalResultMetadata(
    contentParts: MessageContentParts,
    providerMetadata?: ProviderMetadata
  ): FinalResultMetadata {
    const googleProviderMetadata = providerMetadata?.google as
      | {
          groundingMetadata?: GroundingMetadata | null
        }
      | undefined
    const groundingMetadata = googleProviderMetadata?.groundingMetadata

    if (!groundingMetadata) {
      return {}
    }

    const citations = groundingMetadataToCitations(groundingMetadata)
    const firstTextPart = contentParts.find((part): part is MessageTextPart => part.type === 'text')

    if (firstTextPart) {
      firstTextPart.text = annotateTextWithGrounding(firstTextPart.text, groundingMetadata)
    }

    return {
      citations,
      searchProvider: 'gemini-grounding',
      searchQuery: groundingMetadata.webSearchQueries?.[0] || groundingMetadata.retrievalQueries?.[0],
      groundingMetadata,
    }
  }

  private async handleStreamingCompletion<T extends ToolSet>(
    model: LanguageModelV3,
    coreMessages: ModelMessage[],
    options: CallChatCompletionOptions<T>,
    callSettings: CallSettings
  ): Promise<StreamTextResult> {
    // Computer Use harness (and others) may force toolChoice / prune screenshots per step.
    // Cast through unknown: CallChatCompletionOptions.prepareStep is intentionally loose.
    const prepareStep = options.prepareStep as never
    const result = streamText({
      model,
      messages: coreMessages,
      // Cap multi-step tool loops. Unbounded MAX_SAFE_INTEGER left chats stuck on "Using tools…".
      stopWhen: stepCountIs(options.maxSteps && options.maxSteps > 0 ? options.maxSteps : 5),
      tools: options.tools,
      abortSignal: options.signal,
      ...(prepareStep ? { prepareStep } : {}),
      ...callSettings,
    })

    let streamCursor: StreamContentCursor = {
      contentParts: [],
      currentTextPart: undefined,
      currentReasoningPart: undefined,
      pendingTextWhitespace: '',
    }

    // Token speed tracking — use character count (O(1) per chunk) instead of regex word splitting
    let streamStartTime: number | undefined
    let outputCharCount = 0

    // RAF-based update batching: accumulate changes, emit at screen refresh rate (~60fps)
    // contentParts is mutated in-place by processStreamChunk, so RAF always sees latest data
    const hasRAF = typeof requestAnimationFrame === 'function'
    let rafId: number | undefined
    let pendingUpdate = false
    let lastEmittedSpeed: number | undefined

    const computeSpeed = (): number | undefined => {
      const elapsedSec = streamStartTime !== undefined ? (Date.now() - streamStartTime) / 1000 : 0
      // Approximate: ~4 chars per token (much cheaper than regex split per chunk)
      const approxTokens = Math.round(outputCharCount / 4)
      return elapsedSec > 0.5 ? Math.round(approxTokens / elapsedSec) : undefined
    }

    const scheduleUpdate = () => {
      if (pendingUpdate) return
      pendingUpdate = true
      if (hasRAF) {
        rafId = requestAnimationFrame(() => {
          pendingUpdate = false
          rafId = undefined
          lastEmittedSpeed = computeSpeed()
          options.onResultChange?.({
            contentParts: streamCursor.contentParts,
            tokenSpeed: lastEmittedSpeed,
          })
        })
      } else {
        // Fallback for non-browser environments (Node/tests)
        lastEmittedSpeed = computeSpeed()
        options.onResultChange?.({
          contentParts: streamCursor.contentParts,
          tokenSpeed: lastEmittedSpeed,
        })
        pendingUpdate = false
      }
    }

    const flushUpdate = () => {
      if (rafId !== undefined && hasRAF) {
        cancelAnimationFrame(rafId)
        rafId = undefined
      }
      pendingUpdate = false
      lastEmittedSpeed = computeSpeed()
      options.onResultChange?.({
        contentParts: streamCursor.contentParts,
        tokenSpeed: lastEmittedSpeed,
      })
    }

    try {
      for await (const chunk of result.fullStream) {
        // Handle error chunks
        if (chunk.type === 'error') {
          this.handleError(chunk.error)
        }

        // Track character count for speed estimation (O(1) per chunk)
        if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
          if (streamStartTime === undefined) {
            streamStartTime = Date.now()
          }
          outputCharCount += chunk.text.length
        }

        streamCursor = await this.processStreamChunk(chunk, streamCursor, options)

        // Tool-related chunks flush immediately so users see tool execution feedback right away
        if (chunk.type === 'tool-call' || chunk.type === 'tool-result' || chunk.type === 'tool-error') {
          flushUpdate()
        } else {
          scheduleUpdate()
        }
      }
    } catch (error) {
      // Flush buffered whitespace + finalize reasoning on interrupt
      streamCursor = flushPendingStreamText(streamCursor)
      flushUpdate()
      throw error
    }

    // Final flush: surface any buffered leading whitespace and emit last paint
    streamCursor = flushPendingStreamText(streamCursor)
    flushUpdate()
    const contentParts = streamCursor.contentParts

    // Compute final token speed for persistence
    const finalTokenSpeed = computeSpeed()
    const providerMetadata = await result.providerMetadata
    const finalResultMetadata = this.extractFinalResultMetadata(contentParts, providerMetadata)
    let aggregatedText = ''
    try {
      aggregatedText = (await result.text) || ''
    } catch {
      aggregatedText = ''
    }

    return this.finalizeResult(
      contentParts,
      {
        usage: await result.totalUsage,
        finishReason: await result.finishReason,
        tokenSpeed: finalTokenSpeed,
        text: resolveStreamResultText(contentParts, aggregatedText),
      },
      finalResultMetadata,
      options
    )
  }

  private async _callChatCompletion<T extends ToolSet>(
    coreMessages: ModelMessage[],
    options: CallChatCompletionOptions<T>
  ): Promise<StreamTextResult> {
    let baseModel = this.getChatModel(options)
    const callSettings = this.getCallSettings(options)

    if (this.options.stream === false) {
      baseModel = wrapLanguageModel({
        model: baseModel,
        middleware: simulateStreamingMiddleware(),
      })
    }

    const retryable5xx = (context: RetryContext<LanguageModelV3>) => {
      if (isErrorAttempt(context.current)) {
        const { error } = context.current
        if (is5xxError(error)) {
          return {
            model: baseModel,
            maxAttempts: RETRY_CONFIG.MAX_ATTEMPTS,
            delay: RETRY_CONFIG.INITIAL_DELAY_MS,
            backoffFactor: RETRY_CONFIG.BACKOFF_FACTOR,
          }
        }
      }
      return undefined
    }

    const model = createRetryable({
      model: baseModel,
      retries: [retryable5xx],
      onError: (context) => {
        if (isErrorAttempt(context.current)) {
          // Provider error bodies can echo prompts, credentials, or source text.
          console.debug(`[ai-retry] Error on attempt ${context.attempts.length}`)
        }
      },
      onRetry: (context) => {
        const attemptNumber = context.attempts.length + 1
        const lastError = context.attempts[context.attempts.length - 1]
        const errorMessage =
          lastError && 'error' in lastError
            ? lastError.error instanceof Error
              ? lastError.error.message
              : String(lastError.error)
            : 'Unknown error'

        console.debug(`[ai-retry] Retrying attempt ${attemptNumber}/${RETRY_CONFIG.MAX_ATTEMPTS}`)

        options.onStatusChange?.({
          type: 'retrying',
          attempt: attemptNumber,
          maxAttempts: RETRY_CONFIG.MAX_ATTEMPTS,
          error: options.contentPrivacy === 'ephemeral' ? 'Provider request failed' : errorMessage,
        })
      },
    })

    try {
      const result = await this.handleStreamingCompletion(model, coreMessages, options, callSettings)
      options.onStatusChange?.(null)
      return result
    } catch (error) {
      options.onStatusChange?.(null)
      throw error
    }
  }
}
