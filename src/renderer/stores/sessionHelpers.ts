import { isTextFilePath } from '@shared/file-extensions'
import type {
  ExportChatFormat,
  ExportChatScope,
  Session,
  SessionMeta,
  SessionSettings,
  SessionThread,
  SessionThreadBrief,
  Settings,
} from '@shared/types'
import type { DocumentParserConfig } from '@shared/types/settings'
import { pick } from 'lodash'
import i18n from '@/i18n'
import { formatChatAsHtml, formatChatAsMarkdown, formatChatAsTxt } from '@/lib/format-chat'
import { getLogger } from '@/lib/utils'
import { PREVIEW_LINES } from '@/packages/context-management/attachment-payload'
import {
  createHistorySearchRegexp,
  type HistoryScanOptions,
  matchSessionMessages,
  scanHistorySessions,
} from '@/packages/history-search'
import * as localParser from '@/packages/local-parser'
import { estimateTokens, getTokenizerType } from '@/packages/token'
import {
  dataUrlToBlob,
  extractVideoFrames,
  extractVideoPoster,
  formatBytesForDisplay,
  getVideoLimits,
  loadVideoMetadata,
  readAsDataUrl,
} from '@/packages/video'
import {
  formatVideoUrlAttachmentContent,
  isSupportedVideoUrl,
  readVideoUrl,
  storeRemoteThumbnail,
  videoUrlAttachmentTitle,
} from '@/packages/video-url'
import platform from '@/platform'
import storage from '@/storage'
import { StorageKey, StorageKeyGenerator } from '@/storage/StoreStorage'
import { sortSessions } from '@/utils/session-utils'
import * as defaults from '../../shared/defaults'
import {
  createMessage,
  type Message,
  ModelProviderEnum,
  SessionSettingsSchema,
  TOKEN_CACHE_KEYS,
} from '../../shared/types'
import { lastUsedModelStore } from './lastUsedModelStore'
import { getPlatformDefaultDocumentParser, settingsStore } from './settingsStore'

const log = getLogger('session-helpers')

function getCurrentTokenizerType(): 'default' | 'deepseek' {
  const currentModel = lastUsedModelStore.getState().chat
  return getTokenizerType(currentModel)
}

export function computePreviewMetadata(
  content: string,
  tokenizerType: 'default' | 'deepseek',
  existingTokenMap: Record<string, number> = {}
): {
  lineCount: number
  byteLength: number
  tokenCountMap: Record<string, number>
  tokenCalculatedAt: Record<string, number>
} {
  const lineCount = content.split('\n').length
  const byteLength = new TextEncoder().encode(content).length
  const now = Date.now()

  const previewContent = content.split('\n').slice(0, PREVIEW_LINES).join('\n')

  const tokenCountMap: Record<string, number> = { ...existingTokenMap }
  const tokenCalculatedAt: Record<string, number> = {}

  // Only calculate for the specified tokenizer
  const fullKey = tokenizerType // 'default' or 'deepseek'
  const previewKey = `${tokenizerType}_preview`

  if (tokenCountMap[fullKey] === undefined) {
    tokenCountMap[fullKey] = estimateTokens(
      content,
      tokenizerType === 'deepseek' ? { provider: '', modelId: 'deepseek' } : undefined
    )
    tokenCalculatedAt[fullKey] = now
  }

  tokenCountMap[previewKey] = estimateTokens(
    previewContent,
    tokenizerType === 'deepseek' ? { provider: '', modelId: 'deepseek' } : undefined
  )
  tokenCalculatedAt[previewKey] = now

  return { lineCount, byteLength, tokenCountMap, tokenCalculatedAt }
}

function getEffectiveDocumentParserConfig(): DocumentParserConfig {
  const globalConfig = settingsStore.getState().extension?.documentParser
  return globalConfig ?? getPlatformDefaultDocumentParser()
}

/**
 * Parse file using local parser (desktop only)
 */
async function parseFileWithLocalParser(
  file: File,
  uniqKey: string
): Promise<{ content: string; storageKey: string; tokenCountMap: Record<string, number> }> {
  const result = await platform.parseFileLocally(file)

  if (!result.isSupported || !result.key) {
    throw new Error('local_parser_failed')
  }

  // Get content from temporary storage
  const content = (await storage.getBlob(result.key).catch(() => '')) || ''

  // Store content to unique key
  if (content) {
    await storage.setBlob(uniqKey, content)
  }

  // Calculate token counts
  const tokenCountMap: Record<string, number> = content
    ? {
        [TOKEN_CACHE_KEYS.default]: estimateTokens(content),
        [TOKEN_CACHE_KEYS.deepseek]: estimateTokens(content, { provider: '', modelId: 'deepseek' }),
      }
    : {}

  if (content) {
    await storage.setItem(`${uniqKey}_tokenMap`, tokenCountMap)
  }

  return { content, storageKey: uniqKey, tokenCountMap }
}

/**
 * Parse file using MinerU service (Desktop only)
 */
async function parseFileWithMineruService(
  file: File,
  uniqKey: string,
  apiToken: string
): Promise<{ content: string; storageKey: string; tokenCountMap: Record<string, number> }> {
  // Check if platform supports MinerU parsing
  if (!platform.parseFileWithMineru) {
    throw new Error('third_party_parser_not_supported_in_chat')
  }

  // Call platform method to parse file
  const result = await platform.parseFileWithMineru(file, apiToken)

  // Handle cancellation - throw a special error that will be caught silently
  if (result.cancelled) {
    throw new Error('parsing_cancelled')
  }

  if (!result.success || !result.content) {
    throw new Error('third_party_parser_failed')
  }

  const content = result.content

  // Store content to unique key
  await storage.setBlob(uniqKey, content)

  // Calculate token counts
  const tokenCountMap: Record<string, number> = {
    [TOKEN_CACHE_KEYS.default]: estimateTokens(content),
    [TOKEN_CACHE_KEYS.deepseek]: estimateTokens(content, { provider: '', modelId: 'deepseek' }),
  }

  await storage.setItem(`${uniqKey}_tokenMap`, tokenCountMap)

  return { content, storageKey: uniqKey, tokenCountMap }
}

/**
 * (legacy comment removed)
 * @param file
 * @param settings
 * (legacy comment)
 */
export async function preprocessFile(
  file: File,
  _settings: SessionSettings
): Promise<{
  file: File
  content: string
  storageKey: string
  tokenCountMap?: Record<string, number>
  lineCount?: number
  byteLength?: number
  error?: string
}> {
  try {
    const uniqKey = StorageKeyGenerator.fileUniqKey(file)

    // Check if file has already been processed (cache hit)
    const existingContent = await storage.getBlob(uniqKey).catch(() => null)
    if (existingContent) {
      log.debug(`File already preprocessed: ${file.name}, using cached content.`)
      const existingTokenMap: Record<string, number> = (await storage.getItem(`${uniqKey}_tokenMap`, {})) as Record<
        string,
        number
      >

      const tokenizerType = getCurrentTokenizerType()
      const { lineCount, byteLength, tokenCountMap } = computePreviewMetadata(
        existingContent,
        tokenizerType,
        existingTokenMap
      )

      await storage.setItem(`${uniqKey}_tokenMap`, tokenCountMap)

      return {
        file,
        content: existingContent,
        storageKey: uniqKey,
        tokenCountMap,
        lineCount,
        byteLength,
      }
    }

    // Get document parser configuration from global settings
    const parserConfig = getEffectiveDocumentParserConfig()
    log.debug(`Using document parser: ${parserConfig.type} for file: ${file.name}`)

    let result: { content: string; storageKey: string; tokenCountMap: Record<string, number> }

    // Text files always use local parsing for efficiency (same as Knowledge Base behavior)
    // This applies to all platforms (desktop/web/mobile)
    if (isTextFilePath(file.name)) {
      log.debug(`Text file detected, using local parser: ${file.name}`)
      try {
        result = await parseFileWithLocalParser(file, uniqKey)
      } catch (_error) {
        throw new Error('local_parser_failed')
      }
    } else {
      // Non-text files use the configured parser
      switch (parserConfig.type) {
        case 'none': {
          // No parser configured - non-text files are not supported
          // Prompt user to enable a parser in settings
          throw new Error('document_parser_not_configured')
        }

        case 'local': {
          // Local parsing - only available on desktop
          // On mobile/web, this will fail and throw local_parser_failed
          try {
            result = await parseFileWithLocalParser(file, uniqKey)
          } catch (_error) {
            // Local parsing failed, throw appropriate error
            throw new Error('local_parser_failed')
          }
          break
        }

        case 'chatbox-ai': {
          // legacy cloud service cloud parsing is disabled in this build.
          // Treat legacy parser values as local parsing.
          try {
            result = await parseFileWithLocalParser(file, uniqKey)
          } catch (_error) {
            throw new Error('local_parser_failed')
          }
          break
        }

        case 'mineru': {
          // MinerU parsing - available on desktop only
          const apiToken = parserConfig.mineru?.apiToken
          if (!apiToken) {
            throw new Error('mineru_api_token_required')
          }
          try {
            result = await parseFileWithMineruService(file, uniqKey, apiToken)
          } catch (error) {
            // Re-throw known errors, wrap unknown ones
            if (error instanceof Error && error.message.startsWith('third_party_parser')) {
              throw error
            }
            throw new Error('third_party_parser_failed')
          }
          break
        }

        default: {
          // Unknown parser type, fall back to error
          throw new Error('document_parser_not_configured')
        }
      }
    }

    const tokenizerType = getCurrentTokenizerType()
    const { lineCount, byteLength, tokenCountMap } = computePreviewMetadata(
      result.content,
      tokenizerType,
      result.tokenCountMap
    )
    await storage.setItem(`${result.storageKey}_tokenMap`, tokenCountMap)

    return {
      file,
      content: result.content,
      storageKey: result.storageKey,
      tokenCountMap,
      lineCount,
      byteLength,
    }
  } catch (error) {
    log.error('Failed to preprocess file:', error)
    return {
      file,
      content: '',
      storageKey: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * (legacy comment removed)
 * @param url
 * @param settings
 * (legacy comment)
 */
export async function preprocessLink(
  url: string,
  _settings: SessionSettings
): Promise<{
  url: string
  title: string
  content: string
  storageKey: string
  tokenCountMap?: Record<string, number>
  lineCount?: number
  byteLength?: number
  error?: string
}> {
  try {
    const uniqKey = StorageKeyGenerator.linkUniqKey(url)

    // Video platform URLs: use video-url reader (not generic page parse).
    // Never hard-fail the chip — users attach YT/TT/FB links expecting summarize flow.
    if (isSupportedVideoUrl(url)) {
      return await preprocessVideoPlatformLink(url, uniqKey)
    }

    // (legacy comment removed)
    const existingContent = await storage.getBlob(uniqKey).catch(() => null)
    if (existingContent) {
      // (legacy comment removed)
      const titleMatch = existingContent.match(/<title[^>]*>([^<]+)<\/title>/i)
      const title = titleMatch ? titleMatch[1] : url.replace(/^https?:\/\//, '')

      // Get existing token map or create new one
      const existingTokenMap: Record<string, number> = (await storage.getItem(`${uniqKey}_tokenMap`, {})) as Record<
        string,
        number
      >

      const tokenizerType = getCurrentTokenizerType()
      const { lineCount, byteLength, tokenCountMap } = computePreviewMetadata(
        existingContent,
        tokenizerType,
        existingTokenMap
      )

      await storage.setItem(`${uniqKey}_tokenMap`, tokenCountMap)

      return {
        url,
        title,
        content: existingContent,
        storageKey: uniqKey,
        tokenCountMap,
        lineCount,
        byteLength,
      }
    }

    // (legacy comment removed)
    const { key, title } = await localParser.parseUrl(url)
    const content = (await storage.getBlob(key).catch(() => '')) || ''

    // (legacy comment removed)
    if (content) {
      await storage.setBlob(uniqKey, content)
    }

    const tokenizerType = getCurrentTokenizerType()
    const { lineCount, byteLength, tokenCountMap } = content
      ? computePreviewMetadata(content, tokenizerType)
      : { lineCount: undefined, byteLength: undefined, tokenCountMap: {} }

    if (content) {
      await storage.setItem(`${uniqKey}_tokenMap`, tokenCountMap)
    }

    return {
      url,
      title,
      content,
      storageKey: uniqKey,
      tokenCountMap,
      lineCount,
      byteLength,
    }
  } catch (error) {
    // Last-chance soft success for video URLs so send is never blocked
    if (isSupportedVideoUrl(url)) {
      const uniqKey = StorageKeyGenerator.linkUniqKey(url)
      const content = [
        '<title>Video URL</title>',
        `URL: ${url}`,
        '',
        'Could not prefetch video content.',
        'The agent should call read_video_url on this URL.',
      ].join('\n')
      await storage.setBlob(uniqKey, content).catch(() => {})
      return {
        url,
        title: url.replace(/^https?:\/\//, ''),
        content,
        storageKey: uniqKey,
      }
    }
    return {
      url,
      title: url.replace(/^https?:\/\//, ''),
      content: '',
      storageKey: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Prefetch public video platform links via packages/video-url.
 * Always returns a non-error attachment so InputBox submit is not blocked.
 */
async function preprocessVideoPlatformLink(
  url: string,
  uniqKey: string
): Promise<{
  url: string
  title: string
  content: string
  storageKey: string
  tokenCountMap?: Record<string, number>
  lineCount?: number
  byteLength?: number
  imageStorageKey?: string
  thumbnailUrl?: string
}> {
  const thumbMetaKey = `${uniqKey}_thumbKey`

  // Prefer cache when we already have video-formatted content
  const existingContent = await storage.getBlob(uniqKey).catch(() => null)
  if (existingContent?.includes('Platform:') || existingContent?.includes('Transcript')) {
    const titleMatch = existingContent.match(/^(?:Title: |<title>)(.+?)(?:<\/title>)?$/m)
    const title = titleMatch?.[1]?.trim() || url.replace(/^https?:\/\//, '')
    const tokenizerType = getCurrentTokenizerType()
    const existingTokenMap: Record<string, number> = (await storage.getItem(`${uniqKey}_tokenMap`, {})) as Record<
      string,
      number
    >
    const { lineCount, byteLength, tokenCountMap } = computePreviewMetadata(
      existingContent,
      tokenizerType,
      existingTokenMap
    )
    await storage.setItem(`${uniqKey}_tokenMap`, tokenCountMap)
    const cachedThumb = (await storage.getItem(thumbMetaKey, '')) as string
    return {
      url,
      title,
      content: existingContent,
      storageKey: uniqKey,
      tokenCountMap,
      lineCount,
      byteLength,
      imageStorageKey: cachedThumb || undefined,
    }
  }

  let content: string
  let title: string
  let thumbnailUrl: string | undefined
  try {
    const result = await readVideoUrl({ url, mode: 'auto' })
    content = formatVideoUrlAttachmentContent(result)
    title = videoUrlAttachmentTitle(result, url)
    thumbnailUrl = result.thumbnailUrl
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    content = [
      '<title>Video URL</title>',
      `URL: ${url}`,
      '',
      `Prefetch note: ${message}`,
      'The agent should call the read_video_url tool on this URL.',
    ].join('\n')
    title = url.replace(/^https?:\/\//, '')
  }

  await storage.setBlob(uniqKey, content)

  const imageStorageKey = await storeRemoteThumbnail(thumbnailUrl)
  if (imageStorageKey) {
    await storage.setItem(thumbMetaKey, imageStorageKey)
  }

  const tokenizerType = getCurrentTokenizerType()
  const { lineCount, byteLength, tokenCountMap } = computePreviewMetadata(content, tokenizerType)
  await storage.setItem(`${uniqKey}_tokenMap`, tokenCountMap)

  return {
    url,
    title,
    content,
    storageKey: uniqKey,
    tokenCountMap,
    lineCount,
    byteLength,
    imageStorageKey,
    thumbnailUrl,
  }
}

/**
 * Preprocess a video attachment: validate limits, store binary as data URL, extract poster.
 * Does not auto-sample model frames (that happens on send when vision is available).
 */
export async function preprocessVideo(
  file: File,
  options?: { formFactor?: 'desktop' | 'mobile' | 'web'; signal?: AbortSignal }
): Promise<{
  file: File
  content: string
  storageKey: string
  byteLength?: number
  mediaKind: 'video'
  durationSec?: number
  width?: number
  height?: number
  posterStorageKey?: string
  error?: string
}> {
  const formFactor = options?.formFactor ?? platform.formFactor
  const limits = getVideoLimits(formFactor === 'desktop' ? 'desktop' : formFactor === 'mobile' ? 'mobile' : 'web')

  try {
    if (file.size > limits.maxFileBytes) {
      throw new Error(`video_too_large:${formatBytesForDisplay(limits.maxFileBytes)}`)
    }

    const metadata = await loadVideoMetadata(file, options?.signal)
    if (metadata.durationSec > limits.maxDurationSec) {
      throw new Error(`video_too_long:${Math.floor(limits.maxDurationSec / 60)}`)
    }

    const storageKey = StorageKeyGenerator.videoUniqKey(file)
    const existing = await storage.getBlob(storageKey).catch(() => null)
    if (!existing) {
      const dataUrl = await readAsDataUrl(file)
      await storage.setBlob(storageKey, dataUrl)
    }

    const posterKey = StorageKeyGenerator.picture('video-poster')
    const { posterDataUrl } = await extractVideoPoster(file, {
      jpegQuality: limits.jpegQuality,
      signal: options?.signal,
    })
    await storage.setBlob(posterKey, posterDataUrl)

    return {
      file,
      content: '',
      storageKey,
      byteLength: file.size,
      mediaKind: 'video',
      durationSec: metadata.durationSec,
      width: metadata.width,
      height: metadata.height,
      posterStorageKey: posterKey,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    log.error(`preprocessVideo failed for ${file.name}:`, error)
    return {
      file,
      content: '',
      storageKey: '',
      mediaKind: 'video',
      error: message,
    }
  }
}

/**
 * For vision models: sample default frames from video attachments and attach as images.
 * Idempotent if sampledFrameKeys already present.
 */
export async function enrichUserMessageWithVideoFrames(
  message: Message,
  options: {
    modelSupportVision: boolean
    formFactor?: 'desktop' | 'mobile' | 'web'
    signal?: AbortSignal
  }
): Promise<Message> {
  if (!options.modelSupportVision || !message.files?.length) {
    return message
  }

  const formFactor = options.formFactor ?? platform.formFactor
  const limits = getVideoLimits(formFactor === 'desktop' ? 'desktop' : formFactor === 'mobile' ? 'mobile' : 'web')
  const videos = message.files.filter((f) => f.mediaKind === 'video' && f.storageKey)
  if (videos.length === 0) {
    return message
  }

  let msg = message
  const contentParts = [...(msg.contentParts || [])]
  const updatedFiles = [...(msg.files || [])]

  for (let i = 0; i < updatedFiles.length; i++) {
    const file = updatedFiles[i]
    if (file.mediaKind !== 'video' || !file.storageKey) {
      continue
    }
    if (file.sampledFrameKeys?.length) {
      continue
    }

    const dataUrl = await storage.getBlob(file.storageKey).catch(() => null)
    if (!dataUrl) {
      log.error(`Video blob missing for ${file.storageKey}`)
      continue
    }

    try {
      const blob = dataUrlToBlob(dataUrl)
      const extracted = await extractVideoFrames(blob, {
        maxFrames: limits.defaultAutoFrames,
        mode: 'evenly_spaced',
        jpegQuality: limits.jpegQuality,
        signal: options.signal,
      })

      const frameKeys: string[] = []
      const timestamps: number[] = []
      for (const frame of extracted.frames) {
        const key = StorageKeyGenerator.picture('video-frame')
        await storage.setBlob(key, frame.dataUrl)
        frameKeys.push(key)
        timestamps.push(frame.timestampSec)
        contentParts.push({ type: 'image', storageKey: key })
      }

      // Timestamp index as text so the model maps images to times
      if (frameKeys.length > 0) {
        const indexLines = timestamps
          .map((t, idx) => `  - frame ${idx + 1}: t=${t.toFixed(2)}s (image storage)`)
          .join('\n')
        const textPart = contentParts.find((p) => p.type === 'text')
        const indexBlock = `\n\n[Video frames from "${file.name}"]\n${indexLines}\n`
        if (textPart && textPart.type === 'text') {
          textPart.text = `${textPart.text}${indexBlock}`
        } else {
          contentParts.unshift({ type: 'text', text: indexBlock.trim() })
        }
      }

      updatedFiles[i] = {
        ...file,
        durationSec: file.durationSec ?? extracted.metadata.durationSec,
        width: file.width || extracted.metadata.width,
        height: file.height || extracted.metadata.height,
        sampledFrameKeys: frameKeys,
        sampledFrameTimestamps: timestamps,
      }
    } catch (err) {
      log.error(`Failed to sample frames for ${file.name}:`, err)
    }
  }

  msg = {
    ...msg,
    contentParts,
    files: updatedFiles,
  }
  return msg
}

/**
 * (legacy comment removed)
 * @param text
 * @param pictureKeys
 * @param preprocessedFiles
 * @param preprocessedLinks
 * (legacy comment)
 */
export function constructUserMessage(
  text: string,
  pictureKeys: string[] = [],
  preprocessedFiles: Array<{
    file: File
    content: string
    storageKey: string
    tokenCountMap?: Record<string, number>
    lineCount?: number
    byteLength?: number
    mediaKind?: 'document' | 'video'
    durationSec?: number
    width?: number
    height?: number
    posterStorageKey?: string
    sampledFrameKeys?: string[]
    sampledFrameTimestamps?: number[]
    error?: string
  }> = [],
  preprocessedLinks: Array<{
    url: string
    title: string
    content: string
    storageKey: string
    tokenCountMap?: Record<string, number>
    lineCount?: number
    byteLength?: number
    imageStorageKey?: string
  }> = []
): Message {
  // (legacy comment removed)
  const msg = createMessage('user', text)

  // (legacy comment removed)
  if (pictureKeys.length > 0) {
    msg.contentParts = msg.contentParts ?? []
    msg.contentParts.push(...pictureKeys.map((k) => ({ type: 'image' as const, storageKey: k })))
  }

  if (preprocessedFiles.length > 0) {
    msg.files = preprocessedFiles
      .filter((f) => !f.error && f.storageKey)
      .map((f) => ({
        id: f.storageKey || f.file.name,
        name: f.file.name,
        fileType: f.file.type,
        storageKey: f.storageKey,
        tokenCountMap: f.tokenCountMap,
        lineCount: f.lineCount,
        byteLength: f.byteLength,
        mediaKind: f.mediaKind,
        durationSec: f.durationSec,
        width: f.width,
        height: f.height,
        posterStorageKey: f.posterStorageKey,
        sampledFrameKeys: f.sampledFrameKeys,
        sampledFrameTimestamps: f.sampledFrameTimestamps,
      }))
  }

  if (preprocessedLinks.length > 0) {
    msg.links = preprocessedLinks.map((l) => ({
      id: l.storageKey || l.url,
      url: l.url,
      title: l.title,
      storageKey: l.storageKey,
      tokenCountMap: l.tokenCountMap,
      lineCount: l.lineCount,
      byteLength: l.byteLength,
      imageStorageKey: l.imageStorageKey,
    }))
  }

  return msg
}

export async function exportChat(session: Session, scope: ExportChatScope, format: ExportChatFormat) {
  const threads: SessionThread[] = scope === 'all_threads' ? [...(session.threads || [])] : []
  threads.push({
    id: session.id,
    name: session.threadName || session.name,
    messages: session.messages,
    createdAt: Date.now(),
  })

  if (format === 'Markdown') {
    const content = formatChatAsMarkdown(session.name, threads)
    platform.exporter.exportTextFile(`${session.name}.md`, content)
  } else if (format === 'TXT') {
    const content = formatChatAsTxt(session.name, threads)
    platform.exporter.exportTextFile(`${session.name}.txt`, content)
  } else if (format === 'HTML') {
    const content = await formatChatAsHtml(session.name, threads)
    platform.exporter.exportTextFile(`${session.name}.html`, content)
  }
}

export function mergeSettings(
  globalSettings: Settings,
  sessionSetting?: SessionSettings,
  sessionType?: 'picture' | 'chat'
): SessionSettings {
  const globalSessionDefaults = SessionSettingsSchema.parse(globalSettings)
  if (!sessionSetting) {
    return globalSessionDefaults
  }
  return SessionSettingsSchema.parse({
    ...globalSessionDefaults,
    ...(sessionType === 'picture'
      ? {
          imageGenerateNum: defaults.pictureSessionSettings().imageGenerateNum,
          dalleStyle: defaults.pictureSessionSettings().dalleStyle,
        }
      : {
          maxContextMessageCount: defaults.chatSessionSettings().maxContextMessageCount,
        }),
    ...sessionSetting,
  })
}

export function initEmptyChatSession(): Omit<Session, 'id'> {
  const settings = settingsStore.getState().getSettings()
  const { chat: lastUsedChatModel } = lastUsedModelStore.getState()
  const globalSessionDefaults = SessionSettingsSchema.parse(settings)
  const newSession: Omit<Session, 'id'> = {
    name: 'Untitled',
    type: 'chat',
    messages: [],
    settings: {
      maxContextMessageCount: settings.maxContextMessageCount ?? Number.MAX_SAFE_INTEGER,
      temperature: settings.temperature || undefined,
      topP: settings.topP || undefined,
      providerOptions: globalSessionDefaults.providerOptions,
      ...(settings.defaultChatModel
        ? {
            provider: settings.defaultChatModel.provider,
            modelId: settings.defaultChatModel.model,
          }
        : lastUsedChatModel),
    },
  }
  if (settings.defaultPrompt && newSession.settings?.provider !== ModelProviderEnum.OpenClaw) {
    newSession.messages.push(createMessage('system', settings.defaultPrompt || defaults.getDefaultPrompt()))
  }
  return newSession
}

export function initEmptyPictureSession(): Omit<Session, 'id'> {
  const { picture: lastUsedPictureModel } = lastUsedModelStore.getState()

  return {
    name: 'Untitled',
    type: 'picture',
    messages: [createMessage('system', i18n.t('Image Creator Intro') || '')],
    settings: {
      ...lastUsedPictureModel,
    },
  }
}

export function getSessionMeta(session: SessionMeta & { messages?: { timestamp?: number }[] }): SessionMeta {
  const base = pick(session, [
    'id',
    'name',
    'starred',
    'hidden',
    'folderId',
    'projectId',
    'tags',
    'archived',
    'assistantAvatarKey',
    'picUrl',
    'type',
  ]) as SessionMeta

  if (Array.isArray(session.messages) && session.messages.length > 0) {
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const timestamp = session.messages[i]?.timestamp
      if (typeof timestamp === 'number') {
        return { ...base, updatedAt: timestamp }
      }
    }
  }

  if (typeof session.updatedAt === 'number') {
    return { ...base, updatedAt: session.updatedAt }
  }

  // New empty session (has messages array, often empty) — stamp now for Recents ordering/time
  if (Array.isArray(session.messages)) {
    return { ...base, updatedAt: Date.now() }
  }

  return base
}

/**
 * Searches one session, or every listed session in list order, emitting per-session batches of matching messages.
 * `opts` (global search only) skips sessions before reading them, stops on abort, or stops after `maxSessions`
 * matching sessions; without it the scan stops at `LINEAR_HISTORY_SEARCH_RESULT_CAP` matching messages.
 */
export async function searchSessions(
  searchInput: string,
  sessionId?: string,
  onResult?: (result: Session[]) => void,
  opts?: HistoryScanOptions
) {
  const regexp = createHistorySearchRegexp(searchInput)

  const emitBatch = (batch: Session[]) => {
    if (batch.length === 0) {
      return
    }
    onResult?.(batch)
  }

  if (sessionId) {
    const session = await storage.getItem<Session | null>(StorageKeyGenerator.session(sessionId), null)
    if (session) {
      const matchedMessages = matchSessionMessages(session, regexp)
      emitBatch([{ ...session, messages: matchedMessages }])
    }
  } else {
    const sessionsList = sortSessions(await storage.getItem<SessionMeta[]>(StorageKey.ChatSessionsList, []))
    await scanHistorySessions(
      sessionsList,
      (id) => storage.getItem<Session | null>(StorageKeyGenerator.session(id), null),
      regexp,
      emitBatch,
      opts
    )
  }
}

export function getCurrentThreadHistoryHash(s: Session) {
  const ret: { [firstMessageId: string]: SessionThreadBrief } = {}
  if (s.threads) {
    for (const thread of s.threads) {
      if (!thread.messages || thread.messages.length === 0) {
        continue
      }
      ret[thread.messages[0].id] = {
        id: thread.id,
        name: thread.name,
        createdAt: thread.createdAt,
        createdAtLabel: new Date(thread.createdAt).toLocaleString(),
        firstMessageId: thread.messages[0].id,
        messageCount: thread.messages.length,
      }
    }
    if (s.messages && s.messages.length > 0) {
      ret[s.messages[0].id] = {
        id: s.id,
        name: s.threadName || '',
        firstMessageId: s.messages[0].id,
        messageCount: s.messages.length,
      }
    }
  }
  return ret
}

export function getAllMessageList(s: Session) {
  let messageContext: Message[] = []
  if (s.threads) {
    for (const thread of s.threads) {
      messageContext = messageContext.concat(thread.messages)
    }
  }
  if (s.messages) {
    messageContext = messageContext.concat(s.messages)
  }
  return messageContext
}
