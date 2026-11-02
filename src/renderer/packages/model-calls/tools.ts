import type { Message } from '@shared/types'
import { last } from 'lodash'
import * as promptFormat from '@/packages/prompts'
import platform from '@/platform'
import * as settingActions from '@/stores/settingActions'
import { getMessageText, sequenceMessages } from '@/utils/message'
import type { ModelInterface } from '../../../shared/models/types'
import { generateText } from '.'

/**
 * Extracts and parses JSON from a model response result to find search actions
 * @param result The model response result containing content parts
 * @returns The parsed search action object or null if none found
 */
function extractSearchActionFromResult<T = any>(result: {
  contentParts: Array<{ type: string; text?: string }>
}): T | null {
  const regex = /{(?:[^{}]|{(?:[^{}]|{[^{}]*})*})*}/g
  const textPart = result.contentParts.find((part) => part.type === 'text')

  if (!textPart || !textPart.text) {
    return null
  }

  const match = textPart.text.match(regex)
  if (match) {
    for (const jsonString of match) {
      try {
        const jsonObject = JSON.parse(jsonString) as T
        return jsonObject
      } catch (error) {
        console.warn('Failed to parse JSON string:', jsonString, error)
      }
    }
  }

  return null
}

export async function knowledgeBaseSearchByPromptEngineering(
  model: ModelInterface,
  messages: Message[],
  knowledgeBaseId: number
) {
  const language = settingActions.getLanguage()
  const systemPrompt = promptFormat.constructKnowledgeBaseSearchAction(language)
  const result = await generateText(
    model,
    sequenceMessages([
      {
        id: '',
        role: 'system',
        contentParts: [{ type: 'text', text: systemPrompt }],
      },
      ...messages,
    ])
  )

  const searchAction = await extractSearchActionFromResult<{
    action: 'search' | 'proceed'
    query: string
  }>(result)

  if (searchAction && searchAction.action === 'search') {
    const knowledgeBaseController = platform.getKnowledgeBaseController()
    const searchResults = await knowledgeBaseController.search(knowledgeBaseId, searchAction.query)
    return { query: searchAction.query, searchResults }
  }

  return { query: '', searchResults: [] }
}

export function constructMessagesWithKnowledgeBaseResults(
  messages: Message[],
  searchResults: Array<{
    id: number
    score: number
    text: string
    fileId: number
    filename: string
    mimeType: string
    chunkIndex: number
  }>
) {
  const systemPrompt = promptFormat.answerWithKnowledgeBaseResults()
  const formattedSearchResults = searchResults
    .map((it, i) => {
      return `[document ${i + 1} begin]
File: ${it.filename}
Content: ${it.text}
[document ${i + 1} end]`
    })
    .join('\n')

  return sequenceMessages([
    {
      id: '',
      role: 'system',
      contentParts: [{ type: 'text', text: systemPrompt }],
    },
    ...messages.slice(0, -1), // (legacy)
    {
      id: '',
      role: 'user',
      contentParts: [
        {
          type: 'text',
          text: `${formattedSearchResults}\nUser Message:\n${getMessageText(
            last(messages) ?? { id: '', role: 'user', contentParts: [{ type: 'text', text: '' }] }
          )}`,
        },
      ],
    },
  ])
}
