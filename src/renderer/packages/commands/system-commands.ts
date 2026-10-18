/**
 * Built-in slash commands (composer actions), separate from user CommandPackage prompts.
 * Example: /compact → summarize conversation context.
 */

import type { WritingStyle } from '@shared/types/writing'

export type SystemCommandId = 'compact' | 'rewrite'

export type SystemCommand = {
  id: SystemCommandId
  /** Slash name without leading / */
  name: string
  aliases?: string[]
  description: string
}

export const SYSTEM_COMMANDS: readonly SystemCommand[] = [
  {
    id: 'compact',
    name: 'compact',
    aliases: ['compress', 'summarize'],
    description: 'Summarize older messages to free context space',
  },
  {
    id: 'rewrite',
    name: 'rewrite',
    description: 'Rewrite text: clearer, friendlier, shorter, formal or translated',
  },
] as const

/** Match a whole-message slash command: `/compact`, `/compress`, optional trailing spaces. */
export function matchSystemSlashCommand(text: string): SystemCommand | null {
  const trimmed = text.trim()
  const match = trimmed.match(/^\/([a-z][a-z0-9-]*)\s*$/i)
  if (!match) return null
  const name = match[1].toLowerCase()
  return (
    SYSTEM_COMMANDS.find((cmd) => cmd.name === name || cmd.aliases?.includes(name)) ?? null
  )
}

/** Active / partial query matches for the command picker (system builtins). */
export function filterSystemCommands(query: string): SystemCommand[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...SYSTEM_COMMANDS]
  return SYSTEM_COMMANDS.filter((cmd) => {
    if (cmd.name.startsWith(q) || cmd.name.includes(q)) return true
    return cmd.aliases?.some((a) => a.startsWith(q) || a.includes(q)) ?? false
  })
}

const REWRITE_OPTION_RE = /^(clearer|friendlier|shorter|formal|translate)(?=\s|$)\s*/i

/** `/rewrite [option] text…` → the style (if named) and the text; null when the message is not a /rewrite command. */
export function parseRewriteCommand(text: string): { option: WritingStyle | null; text: string } | null {
  const match = text.trimStart().match(/^\/rewrite(?=\s|$)\s*([\s\S]*)$/i)
  if (!match) return null
  const rest = match[1]
  const optionMatch = rest.match(REWRITE_OPTION_RE)
  if (!optionMatch) return { option: null, text: rest.trimEnd() }
  return { option: optionMatch[1].toLowerCase() as WritingStyle, text: rest.slice(optionMatch[0].length).trimEnd() }
}
