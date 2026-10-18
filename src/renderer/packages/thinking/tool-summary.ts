import type { MessageToolCallPart } from '@shared/types'
import type { TFunction } from 'i18next'
import { isTaskTrackingTool } from '@/packages/tools/task-tools'
import { isHostChromeTool } from '@/utils/message-stream-ui'

/** One mono row in an opened tool block. `target` is external text (a path, query, URL): render it literally. */
export type ToolRow = { verb: string; target: string; size?: string }

type ToolGroup =
  | 'read'
  | 'files'
  | 'web'
  | 'link'
  | 'knowledge'
  | 'edit'
  | 'terminal'
  | 'browser'
  | 'computer'
  | 'other'

const GROUP_BY_NAME: Record<string, ToolGroup> = {
  read_file: 'read',
  file_search: 'files',
  code_search: 'files',
  search_file_content: 'files',
  web_search: 'web',
  parse_link: 'link',
  read_video: 'link',
  read_video_url: 'link',
  query_knowledge_base: 'knowledge',
  create_file: 'edit',
  edit_file: 'edit',
  delete_file: 'edit',
  terminal: 'terminal',
}

function toolGroup(toolName: string): ToolGroup {
  const known = GROUP_BY_NAME[toolName]
  if (known) return known
  if (toolName.startsWith('memory_')) return 'knowledge'
  if (toolName.startsWith('browser_')) return 'browser'
  if (toolName.startsWith('computer_')) return 'computer'
  return 'other'
}

function groupPhrase(group: ToolGroup, count: number, t: TFunction): string {
  switch (group) {
    case 'read':
      return t('read {{count}} files', { count })
    case 'files':
      return t('searched files')
    case 'web':
      return t('searched the web')
    case 'link':
      return t('opened {{count}} links', { count })
    case 'knowledge':
      return t('searched scope knowledge')
    case 'edit':
      return t('staged {{count}} edits', { count })
    case 'terminal':
      return t('ran {{count}} commands', { count })
    case 'browser':
      return t('used the browser')
    case 'computer':
      return t('used the computer')
    default:
      return t('used {{count}} tools', { count })
  }
}

function groupVerb(group: ToolGroup, t: TFunction): string {
  switch (group) {
    case 'read':
      return t('read', { context: 'tool' })
    case 'files':
    case 'web':
    case 'knowledge':
      return t('search', { context: 'tool' })
    case 'link':
      return t('open', { context: 'tool' })
    case 'edit':
      return t('edit', { context: 'tool' })
    case 'terminal':
      return t('run', { context: 'tool' })
    default:
      return t('use', { context: 'tool' })
  }
}

/** The calls a tool block shows: no task tracking, no host chrome. */
export function visibleToolCalls(parts: MessageToolCallPart[]): MessageToolCallPart[] {
  return parts.filter((part) => !isTaskTrackingTool(part.toolName) && !isHostChromeTool(part))
}

function countByGroup(parts: MessageToolCallPart[]): Map<ToolGroup, number> {
  const counts = new Map<ToolGroup, number>()
  for (const part of parts) {
    const group = toolGroup(part.toolName)
    counts.set(group, (counts.get(group) ?? 0) + 1)
  }
  return counts
}

const upperFirst = (text: string) => (text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text)

/** "Read 2 files · searched scope knowledge · 1 failed"; empty when nothing visible ran. */
export function summarizeToolCalls(parts: MessageToolCallPart[], t: TFunction): string {
  const visible = visibleToolCalls(parts)
  if (visible.length === 0) return ''
  const phrases = [...countByGroup(visible)].map(([group, count]) => groupPhrase(group, count, t))
  let summary = phrases.reduce((first, second) => t('{{first}} · {{second}}', { first, second }))
  const failed = visible.filter((part) => part.state === 'error').length
  if (failed > 0) summary = t('{{summary}} · {{count}} failed', { summary, count: failed })
  return upperFirst(summary)
}

/** The running call's phrase, lower case ("searched the web"); undefined when nothing visible runs. */
export function liveToolHint(parts: MessageToolCallPart[], t: TFunction): string | undefined {
  const visible = visibleToolCalls(parts)
  const running = visible.filter((part) => part.state === 'call').at(-1)
  if (!running) return undefined
  const group = toolGroup(running.toolName)
  return groupPhrase(group, countByGroup(visible).get(group) ?? 1, t)
}

const TARGET_KEYS = ['path', 'query', 'url', 'command', 'fileKey'] as const

function rowTarget(part: MessageToolCallPart): string {
  const args = part.args
  if (args && typeof args === 'object') {
    for (const key of TARGET_KEYS) {
      const value = (args as Record<string, unknown>)[key]
      if (typeof value === 'string' && value) return value
    }
  }
  return part.toolName
}

function kiloChars(length: number): string {
  const k = length / 1000
  return k >= 10 ? String(Math.round(k)) : k.toFixed(1).replace(/\.0$/, '')
}

function rowSize(result: unknown, t: TFunction): string | undefined {
  const record = result && typeof result === 'object' ? (result as Record<string, unknown>) : undefined
  const text = typeof result === 'string' ? result : typeof record?.content === 'string' ? record.content : undefined
  if (text !== undefined) {
    return text.length >= 1000 ? t('{{size}}k', { size: kiloChars(text.length) }) : undefined
  }
  // web_search returns { query, searchResults }; other search tools return an array or { results }.
  const hits = Array.isArray(result)
    ? result
    : Array.isArray(record?.searchResults)
      ? record.searchResults
      : Array.isArray(record?.results)
        ? record.results
        : undefined
  return hits ? t('{{count}} hits', { count: hits.length }) : undefined
}

export function toolRow(part: MessageToolCallPart, t: TFunction): ToolRow {
  const row: ToolRow = { verb: groupVerb(toolGroup(part.toolName), t), target: rowTarget(part) }
  const size = part.state === 'error' ? t('failed') : rowSize(part.result, t)
  if (size) row.size = size
  return row
}
