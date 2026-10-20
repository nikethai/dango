import { isSensitiveToolName } from '@shared/privacy/sensitive-tools'
import { ToolRiskTier } from '@shared/types/mcp'
import { t } from 'i18next'

export type PermissionChoice = 'once' | 'always' | 'deny'

/** What a tool call will do, in words for the permission sheet. Built from raw args, shown once, never persisted. */
export type ToolActionSummary = { what: string; why?: string; touches: string[] }

const ALWAYS_ASKS_PATTERN = /(^|[_-])(send|reply|delete|remove|trash|pay|purchase|checkout|transfer)([_-]|$)/i
const SEND_LIKE_PATTERN = /(^|[_-])(send|reply)([_-]|$)/i
const COMMAND_LIKE_PATTERN = /exec|command|shell|terminal/i
const EDIT_TOOLS = new Set(['edit_file', 'create_file', 'apply_workspace_changes'])
const RUN_TOOLS = new Set(['run_local_code', 'prepare_local_execution'])
const WHY_MAX = 140
const COMMAND_MAX = 80

/** Tools that send, delete, pay, or change workspace files ask every time, whatever Trust says. */
export function alwaysAsks(toolName: string): boolean {
  return isSensitiveToolName(toolName) || ALWAYS_ASKS_PATTERN.test(toolName)
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

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
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
  return cut((match ? match[0] : text).trim(), WHY_MAX)
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
  if (SEND_LIKE_PATTERN.test(toolName)) return t('Send a message')
  return t('Use {{toolLabel}}', { toolLabel: toolLabel(toolName) })
}

/**
 * Summarise a tool call for the permission sheet. Only names paths, hosts, the command (cut to 80 chars)
 * and recipients; never file content, diffs, source or stdin.
 */
export function describeToolAction(toolName: string, args: unknown, description?: string): ToolActionSummary {
  const rec = asRecord(args)
  const why =
    nonEmptyString(rec.reason) ??
    nonEmptyString(rec.explanation) ??
    nonEmptyString(rec.purpose) ??
    firstSentence(description)

  const touches: string[] = [...pathsOf(rec)]
  const host = hostOf(rec.url)
  if (host) touches.push(host)
  const command = nonEmptyString(rec.command)
  if (command) touches.push(cut(command, COMMAND_MAX))
  if (SEND_LIKE_PATTERN.test(toolName)) touches.push(...stringList(rec.to), ...stringList(rec.recipient))

  const summary: ToolActionSummary = { what: describeWhat(toolName, rec), touches: [...new Set(touches)] }
  if (why) summary.why = why
  return summary
}
