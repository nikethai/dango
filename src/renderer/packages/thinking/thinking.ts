import type { ShowThinking } from '@shared/types/settings'

export const THINKING_STILL_MS = 8_000
export const THINKING_REASSURE_MS = 30_000
export const THINKING_ANNOUNCE_MS = 5_000

export function thinkingStage(elapsedMs: number): 'thinking' | 'still' | 'reassure' {
  if (elapsedMs >= THINKING_REASSURE_MS) return 'reassure'
  if (elapsedMs >= THINKING_STILL_MS) return 'still'
  return 'thinking'
}

function cleanLine(line: string): string {
  return line
    .replace(/^\s*(?:>\s*)+/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/(\*\*|__|\*|_|`)/g, '')
    .trim()
}

/** Last meaningful line of streamed reasoning, markdown stripped, at most `maxChars` including the ellipsis. */
export function rollingSummary(text: string, maxChars = 120): string {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*(```|~~~)/.test(lines[i])) continue
    const cleaned = cleanLine(lines[i])
    if (!cleaned) continue
    return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars - 1).trimEnd()}…` : cleaned
  }
  return ''
}

export function thinkingOpenByDefault(pref: ShowThinking, scopeKind: 'project' | 'client' | null): boolean {
  if (pref === 'open') return true
  if (pref === 'closed') return false
  return scopeKind !== 'client'
}
