import { DAILY_DRAFT_CAP, type Tier } from './types'

/*
 * Which Review entry a judged thread becomes (slice 10, Task 8). Pure. Trust is slice 5's: this only says which
 * entries are safe to arrive done. Model text is untrusted, so a contact (URL or email address) it adds that the cited
 * evidence does not hold keeps the entry from being safe.
 */

export type EntryShape = { kind: 'proposal'; risk: 'safe' | 'risky' } | { kind: 'needs-you' }

/**
 * A local-only block or a Low tier asks the user; High under the daily cap is a safe proposal; anything else (Medium,
 * High over the cap) is a risky proposal, which always waits.
 */
export function entryShapeForTier(input: { tier: Tier; draftsToday: number; localOnlyBlocked: boolean }): EntryShape {
  if (input.localOnlyBlocked || input.tier === 'low') return { kind: 'needs-you' }
  if (input.tier === 'high' && input.draftsToday < DAILY_DRAFT_CAP) return { kind: 'proposal', risk: 'safe' }
  return { kind: 'proposal', risk: 'risky' }
}

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi
const WWW_RE = /\bwww\.[^\s<>"'`]+/gi
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g
const TRAILING = /[.,;:!?)\]}'"*_]+$/

/** URLs, `www.` links and email addresses in `text`, without trailing punctuation, in order, once each. */
function contactsIn(text: string): string[] {
  const out: string[] = []
  const add = (raw: string) => {
    const value = raw.replace(TRAILING, '')
    if (value && !out.includes(value)) out.push(value)
  }
  // URLs first, then `www.` links and addresses in what is left, so a URL is not counted twice.
  const rest = text.replace(URL_RE, (m) => {
    add(m)
    return ' '
  })
  for (const m of rest.match(WWW_RE) ?? []) add(m)
  for (const m of text.match(EMAIL_RE) ?? []) add(m)
  return out
}

/** One form per contact: lower case, no scheme, no trailing slash. Whole contacts are compared, never prefixes. */
function contactKey(contact: string): string {
  return contact
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
}

/** The URLs and email addresses in `text` that none of `supportTexts` holds. */
export function unsupportedContacts(text: string, supportTexts: string[]): string[] {
  const known = new Set(supportTexts.flatMap(contactsIn).map(contactKey))
  return contactsIn(text).filter((c) => !known.has(contactKey(c)))
}

/**
 * A High tier whose model text (the judge's answer or the written draft) holds a URL or email address the cited
 * evidence does not hold is treated as Medium: it can still be drafted, but never arrives done. Other tiers are kept.
 */
export function demoteUnsupported(tier: Tier, modelText: string, citedTexts: string[]): Tier {
  if (tier !== 'high') return tier
  return unsupportedContacts(modelText, citedTexts).length > 0 ? 'medium' : tier
}
