import { oneLine, type SearchHit } from './types'

const QUOTE_LIMIT = 280

/** The composer prefill for "New chat with it": the hit quoted on one line, then where it came from. */
export function attachPrefill(hit: SearchHit): string {
  const quoted = oneLine(hit.excerpt?.trim() ? hit.excerpt : hit.title).slice(0, QUOTE_LIMIT)
  return `> ${quoted}\n> — ${oneLine(hit.sourceLabel)}\n\n`
}
