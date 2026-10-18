import type { MemoryAttachment, Message, MessageContentParts, MessageQuoteAttachment } from '@shared/types'
import type { ModelDependencies } from '@shared/types/adapters'
import type { FilePart, ImagePart, ModelMessage, ReasoningUIPart, TextPart } from 'ai'
import dayjs from 'dayjs'
import { compact } from 'lodash'
import { createModelDependencies } from '@/adapters'
import { isLegacyMemoryActive } from '@/packages/knowledge/for-turn'
import { buildMemoryInjectBlock } from '@/packages/memory/inject'
import { memoryStore } from '@/stores/memoryStore'
import { settingsStore } from '@/stores/settingsStore'
import { cloneMessage, getMessageText } from '@/utils/message'

/**
 * Replace copilot template variables in a system prompt string.
 * Supported variables:
 *   {{CURRENT_DATE}} → YYYY-MM-DD
 *   {{CURRENT_TIME}} → HH:MM
 */
export function replaceCopilotTemplateVars(text: string): string {
  const now = dayjs()
  return text
    .replace(/\{\{CURRENT_DATE\}\}/g, now.format('YYYY-MM-DD'))
    .replace(/\{\{CURRENT_TIME\}\}/g, now.format('HH:mm'))
}

export async function replacePromptTemplateVars(
  text: string,
  options: {
    readClipboard?: boolean
  } = {}
): Promise<string> {
  let nextText = replaceCopilotTemplateVars(text)

  if (options.readClipboard && nextText.includes('{{CLIPBOARD}}')) {
    let clipboardText = ''
    try {
      clipboardText = await navigator.clipboard.readText()
    } catch (error) {
      console.warn('Failed to read clipboard for prompt template vars:', error)
    }
    nextText = nextText.replace(/\{\{CLIPBOARD\}\}/g, clipboardText)
  }

  return nextText
}

async function convertContentParts<T extends TextPart | ImagePart | FilePart>(
  contentParts: MessageContentParts,
  imageType: 'image' | 'file',
  dependencies: ModelDependencies,
  options?: { modelSupportVision: boolean }
): Promise<T[]> {
  return compact(
    await Promise.all(
      contentParts.map(async (c) => {
        if (c.type === 'text') {
          return { type: 'text', text: c.text } as T
        } else if (c.type === 'image') {
          if (options?.modelSupportVision === false) {
            return { type: 'text', text: `This is an image, OCR Result: \n${c.ocrResult}` } as T
          }
          try {
            const imageData = await dependencies.storage.getImage(c.storageKey)
            if (!imageData) {
              console.warn(`Image not found for storage key: ${c.storageKey}`)
              return null
            }
            const base64Data = imageData.replace(/^data:image\/[^;]+;base64,/, '')
            const mediaType = imageData.match(/^data:([^;]+)/)?.[1] || 'image/png'

            if (imageType === 'image') {
              return {
                type: 'image',
                image: base64Data,
                mediaType,
              } as T
            } else {
              return {
                type: 'file',
                data: base64Data,
                mediaType,
              } as T
            }
          } catch (error) {
            console.error(`Failed to get image for storage key ${c.storageKey}:`, error)
            return null
          }
        }
        return null
      })
    )
  )
}

async function convertUserContentParts(
  contentParts: MessageContentParts,
  dependencies: ModelDependencies,
  options?: { modelSupportVision: boolean }
): Promise<Array<TextPart | ImagePart>> {
  return await convertContentParts<TextPart | ImagePart>(contentParts, 'image', dependencies, options)
}

async function convertAssistantContentParts(
  contentParts: MessageContentParts,
  dependencies: ModelDependencies,
  options?: { includeReasoning?: boolean }
): Promise<Array<TextPart | FilePart | ReasoningUIPart>> {
  const convertedParts = await Promise.all(
    contentParts.map(async (part): Promise<TextPart | FilePart | ReasoningUIPart | null> => {
      if (part.type === 'reasoning') {
        if (!options?.includeReasoning) {
          return null
        }

        return {
          type: 'reasoning',
          text: part.text,
        }
      }

      const converted = await convertContentParts<TextPart | FilePart>([part], 'file', dependencies)
      return converted[0] || null
    })
  )

  return compact(convertedParts)
}

function formatMemoryAttachments(attachments: MemoryAttachment[] | undefined): string {
  if (!attachments?.length) return ''

  const facts = attachments.map((attachment) => {
    const tags = attachment.tags.length ? ` [tags: ${attachment.tags.join(', ')}]` : ''
    return `- ${attachment.content}${tags}`
  })

  return `User-selected memory for this turn:\n${facts.join('\n')}`
}

export function formatQuoteAttachment(quote: MessageQuoteAttachment | undefined): string {
  if (!quote?.text?.trim()) return ''

  const role = quote.sourceRole || 'message'
  const kind = quote.isPartial ? 'partial selection' : 'full message'
  const lines = quote.text.replace(/\r\n/g, '\n').split('\n')
  const quoted = lines.map((line) => `> ${line}`).join('\n')

  return `Quoted ${kind} (${role}):\n${quoted}`
}

/**
 * Gemini (and some OpenAI-compat gateways) reject turns with empty `content`.
 * Tool-only assistant rows historically convert to [] because tool-call parts are
 * not re-emitted as model tool history — inject a short summary instead.
 */
function assistantToolActivitySummary(contentParts: MessageContentParts): string | null {
  const toolNames = contentParts
    .filter((part): part is Extract<MessageContentParts[number], { type: 'tool-call' }> => part.type === 'tool-call')
    .map((part) => part.toolName)
    .filter(Boolean)
  if (toolNames.length === 0) return null
  const unique = [...new Set(toolNames)]
  return `(Completed tools: ${unique.join(', ')})`
}

export async function convertToModelMessages(
  messages: Message[],
  options?: {
    modelSupportVision: boolean
    dependencies?: ModelDependencies
    includeAssistantReasoning?: boolean
  }
): Promise<ModelMessage[]> {
  const dependencies = options?.dependencies ?? (await createModelDependencies())
  const results = await Promise.all(
    messages.map(async (m): Promise<ModelMessage | null> => {
      switch (m.role) {
        case 'system': {
          const text = replaceCopilotTemplateVars(getMessageText(m)).trim()
          if (!text) return null
          return {
            role: 'system' as const,
            content: text,
          }
        }
        case 'user': {
          const contentParts = await convertUserContentParts(m.contentParts || [], dependencies, options)
          const quoteContext = formatQuoteAttachment(m.quoteAttachment)
          const memoryContext = formatMemoryAttachments(m.memoryAttachments)
          const content = [
            ...(quoteContext ? [{ type: 'text' as const, text: quoteContext }] : []),
            ...contentParts,
            ...(memoryContext ? [{ type: 'text' as const, text: memoryContext }] : []),
          ]
          // Drop empty user turns (Gemini INVALID_ARGUMENT: empty content)
          if (content.length === 0) {
            const fallback = getMessageText(m, true, true).trim()
            if (!fallback) return null
            return { role: 'user' as const, content: [{ type: 'text' as const, text: fallback }] }
          }
          return {
            role: 'user' as const,
            content,
          }
        }
        case 'assistant': {
          const contentParts = m.contentParts || []
          let content = await convertAssistantContentParts(contentParts, dependencies, {
            includeReasoning: options?.includeAssistantReasoning,
          })
          if (content.length === 0) {
            const summary = assistantToolActivitySummary(contentParts)
            const fallback = getMessageText(m, true, true).trim()
            const text = fallback || summary
            if (!text) return null
            content = [{ type: 'text' as const, text }]
          }
          return {
            role: 'assistant' as const,
            content,
          }
        }
        case 'tool':
          return null
        default: {
          const _exhaustiveCheck: never = m.role
          throw new Error(`Unknown role: ${_exhaustiveCheck}`)
        }
      }
    })
  )

  // Filter out null values manually instead of using compact
  return results.filter((result): result is ModelMessage => result !== null)
}

/**
 * Legacy personal info inject (kept only if user re-enables after migration).
 */
function buildPersonalInfoSection(): string {
  const userPersonalInfo = settingsStore.getState().userPersonalInfo
  if (!userPersonalInfo?.enableInjection) return ''
  const entries = userPersonalInfo?.entries ?? []
  if (entries.length === 0) return ''

  const infoLines = entries
    .filter((entry) => entry.key && entry.value)
    .map((entry) => `- ${entry.key}: ${entry.value}`)
    .join('\n')

  return infoLines ? `\n## Personal Info About You (the user):\n${infoLines}\n` : ''
}

export type MemoryInjectContext = {
  agentId?: string
  agentName?: string
  /**
   * When the active model cannot use tools, force on_demand → hybrid inject
   * so identity/pinned facts still arrive without memory_recall.
   */
  forceHybridFallback?: boolean
  /** Override host pre-search query; default = last user message text */
  userQuery?: string
}

function lastUserMessageText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'user') {
      const text = getMessageText(m, false, false).trim()
      if (text) return text
    }
  }
  return ''
}

function buildMemorySection(memory: MemoryInjectContext | undefined, messages: Message[]): string {
  // Once the old notes have moved to knowledge, approved knowledge is the only memory chat reads.
  if (!isLegacyMemoryActive()) return ''
  const state = memoryStore.getState()

  const agentBank = memory?.agentId ? (state.agentBanks[memory.agentId] ?? null) : null
  const userQuery = memory?.userQuery ?? lastUserMessageText(messages)
  const block = buildMemoryInjectBlock({
    settings: state.settings,
    globalBank: state.globalBank,
    agentBank,
    agentName: memory?.agentName,
    userQuery: userQuery || undefined,
    forceHybridFallback: memory?.forceHybridFallback,
  })
  return block ? `\n${block}\n` : ''
}

/**
 *  system prompt + approved knowledge (`formatKnowledgeSection`) + legacy long-term memory
 */
export function injectModelSystemPrompt(
  model: string,
  messages: Message[],
  additionalInfo: string,
  role: 'system' | 'user' = 'system',
  memory?: MemoryInjectContext,
  knowledgeSection?: string
) {
  const personalInfo = buildPersonalInfoSection()
  const memorySection = buildMemorySection(memory, messages)
  const metadataPrompt = `Current model: ${model}\nCurrent date: ${dayjs().format(
    'YYYY-MM-DD'
  )}${personalInfo}${knowledgeSection ?? ''}${memorySection}\n Additional info for this conversation: ${additionalInfo}\n\n`
  let hasInjected = false
  return messages.map((m) => {
    if (m.role === role && !hasInjected) {
      m = cloneMessage(m) // ，other
      m.contentParts = [{ type: 'text', text: metadataPrompt + getMessageText(m) }]
      hasInjected = true
    }
    return m
  })
}
