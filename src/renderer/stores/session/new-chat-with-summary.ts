import { createMessage, type Message } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import { t } from 'i18next'
import { generateSummary } from '@/packages/context-management/summary-generator'
import * as chatStore from '../chatStore'
import { initEmptyChatSession } from '../sessionHelpers'
import * as toastActions from '../toastActions'
import { switchCurrentSession } from './crud'

/**
 * ER5: a chat too long for its model continues in a new chat, "{{name}} (continued)", in the same scope and with the
 * same model, starting from a summary of this one. Opens it and resolves its id; `null` when the summary failed (a
 * toast says so and nothing is created).
 */
export async function startNewChatWithSummary(sessionId: string): Promise<string | null> {
  const source = await chatStore.getSession(sessionId)
  if (!source) return null

  const conversation = source.messages.filter((m) => m.role !== 'system' && !m.error && !m.generating)
  const result = await generateSummary({ messages: conversation, sessionSettings: source.settings })
  if (!result.success || !result.summary) {
    toastActions.add(t("Couldn't summarise this chat. Try again."))
    return null
  }

  const systemPrompt = source.messages.find((m) => m.role === 'system')
  const messages: Message[] = []
  if (systemPrompt) {
    messages.push(createMessage('system', getMessageText(systemPrompt)))
  }
  messages.push(createMessage('user', `Previous conversation summary:\n\n${result.summary}`))

  const projectId = source.projectId || source.folderId
  const created = await chatStore.createSession({
    ...initEmptyChatSession(),
    name: t('{{name}} (continued)', { name: source.name }),
    projectId,
    folderId: projectId,
    agentMode: source.agentMode,
    agentIds: source.agentIds,
    copilotId: source.copilotId,
    // Same model and settings: Dango never switches models by itself.
    settings: source.settings,
    messages,
  })
  switchCurrentSession(created.id)
  return created.id
}
