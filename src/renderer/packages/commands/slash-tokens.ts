/**
 * / command token helpers for composer text.
 * Only word-boundary slashes; ignores URLs like https:// and // comments.
 */

import { fuzzyScoreSkill } from '@/packages/skills'

/** Matches /command-name tokens at word boundaries (not // or ://) */
export const COMMAND_SLASH_TOKEN_RE = /(?:^|[\s([{])\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)/gi

export function extractCommandNamesFromText(text: string): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(COMMAND_SLASH_TOKEN_RE)) {
    const name = match[1].toLowerCase()
    if (!seen.has(name)) {
      seen.add(name)
      names.push(name)
    }
  }
  return names
}

/** Remove /command-name tokens; keep surrounding text clean. */
export function stripCommandSlashTokens(text: string): string {
  return text
    .replace(/(?:^|[\s([{])\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)/gi, (full, _name, offset, source) => {
      // Keep the boundary char if present
      const boundary = full[0] === '/' ? '' : full[0]
      return boundary
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()
}

/**
 * Active / partial at end of input for CommandPicker.
 * Only when message starts with `/` on a single line (composer convention).
 * Returns query without leading / (may be empty if just "/").
 */
export function getActiveCommandSlashQuery(text: string, caret?: number): string | null {
  if (text.includes('\n')) return null
  const pos = caret ?? text.length
  const before = text.slice(0, pos)
  // Entire input is a slash command draft: /partial
  const match = before.match(/^\/([a-z0-9-]*)$/i)
  if (!match) return null
  return match[1].toLowerCase()
}

/**
 * A skill chosen from the / picker: the active `/partial` before the caret becomes `$skill-name `.
 * Same token rules as replaceActiveSkillDollarWithToken, so the draft reads exactly as if picked with `$`.
 */
export function replaceActiveCommandSlashWithSkillToken(text: string, skillName: string, caret?: number): string {
  const token = skillName.toLowerCase().replace(/[^a-z0-9-]/g, '')
  if (!token || /^[0-9]/.test(token)) return text
  const pos = caret ?? text.length
  const before = text.slice(0, pos)
  const after = text.slice(pos)
  const replaced = before.replace(/(?:^|[\s([{])\/[a-z0-9-]*$/i, (m) => {
    const boundary = m.length > 0 && /[\s([{]/.test(m[0]) ? m[0] : ''
    return `${boundary}$${token}`
  })
  const needsSpace = after.length === 0 || !/^\s/.test(after)
  return replaced + (needsSpace ? ' ' : '') + after
}

export function fuzzyScoreCommand(value: string, query: string): number {
  return fuzzyScoreSkill(value, query)
}
