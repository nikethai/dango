import type { ShowThinking } from '@shared/types/settings'

export const THINKING_STILL_MS = 8_000
export const THINKING_REASSURE_MS = 30_000
export const THINKING_ANNOUNCE_MS = 5_000

export function thinkingStage(elapsedMs: number): 'thinking' | 'still' | 'reassure' {
  if (elapsedMs >= THINKING_REASSURE_MS) return 'reassure'
  if (elapsedMs >= THINKING_STILL_MS) return 'still'
  return 'thinking'
}

const RULE_LINE = /^\s*([-*_])(\s*\1){2,}\s*$/
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
const FENCE_LINE = /^\s*(```|~~~)/

function cleanLine(line: string): string {
  return line
    .replace(/^\s*(?:>\s*)+/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^\s*\[[ xX]\]\s+/, '')
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`/g, '')
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '$1')
    .replace(/(?<![\w])__(?=\S)(.+?)(?<=\S)__(?![\w])/g, '$1')
    .replace(/(?<![\w*])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![\w*])/g, '$1')
    .replace(/(?<![\w])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![\w])/g, '$1')
    .trim()
}

/** Last meaningful prose line of streamed reasoning (never code), markdown stripped, at most `maxChars` including the ellipsis. */
export function rollingSummary(text: string, maxChars = 120): string {
  const max = Math.max(2, maxChars)
  let inFence = false
  let last = ''
  for (const line of text.split(/\r?\n/)) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence || RULE_LINE.test(line) || TABLE_SEPARATOR.test(line)) continue
    const cleaned = cleanLine(line)
    if (!cleaned || cleaned === '…') continue
    last = cleaned
  }
  const chars = Array.from(last)
  if (chars.length <= max) return last
  return `${chars
    .slice(0, max - 1)
    .join('')
    .trimEnd()}…`
}

export function thinkingOpenByDefault(pref: ShowThinking, scopeKind: 'project' | 'client' | null): boolean {
  if (pref === 'open') return true
  if (pref === 'closed') return false
  return scopeKind !== 'client'
}
