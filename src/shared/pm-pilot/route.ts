import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { type GmailSourceConfig, PUBLIC_MAIL_DOMAINS, type SourceRecord } from './types'

/*
 * Which client scope a Gmail thread belongs to. Pure: addresses and matchers in, a decision out. Addresses, names
 * and subjects are external data; nothing here interprets them beyond comparing lower-cased addresses.
 */

export type RouteSource = { id: string; scopeId: string; config: GmailSourceConfig }

export type RouteResult =
  | { type: 'noise' }
  | { type: 'own' }
  | { type: 'scope'; sourceId: string; scopeId: string }
  /** `domain`: the outside sender's domain, or the full address for a public mail domain (gmail.com, …). */
  | { type: 'unknown'; domain: string; candidateScopeIds: string[] }

function domainOf(address: string): string {
  const at = address.lastIndexOf('@')
  return at >= 0 ? address.slice(at + 1) : ''
}

function isPublicDomain(domain: string): boolean {
  return PUBLIC_MAIL_DOMAINS.includes(domain)
}

/** The user's own address, and their company domain unless it is a public mail domain. */
export function ownMatchers(ownAddress: string): { address: string; domain?: string } {
  const address = ownAddress.trim().toLowerCase()
  const domain = domainOf(address)
  return domain && !isPublicDomain(domain) ? { address, domain } : { address }
}

/** `@acme.com` or `acme.com` match the domain; `jo@acme.com` matches that address only. */
function matches(matcher: string, address: string): boolean {
  const m = matcher.trim().toLowerCase()
  if (!m) return false
  if (m.startsWith('@')) return domainOf(address) === m.slice(1)
  if (m.includes('@')) return address === m
  return domainOf(address) === m
}

/** How an outside address is keyed for a question: its domain, or the whole address on a public domain. */
function questionKey(address: string): string {
  const domain = domainOf(address)
  return !domain || isPublicDomain(domain) ? address : domain
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

export function routeThread(records: SourceRecord[], sources: RouteSource[], ownAddress: string): RouteResult {
  const byNewest = [...records].sort((a, b) => b.occurredAt - a.occurredAt)
  const newestInbound = byNewest.find((r) => !r.sentByMe) ?? byNewest[0]
  if (newestInbound?.noise) return { type: 'noise' }

  const own = ownMatchers(ownAddress)
  const isOwn = (address: string) =>
    (!!own.address && address === own.address) || (!!own.domain && domainOf(address) === own.domain)

  const addresses = unique(
    records
      .flatMap((r) => [r.author, ...r.participants])
      .map((a) => a.trim().toLowerCase())
      .filter((a) => a.includes('@'))
  )
  const outside = addresses.filter((a) => !isOwn(a))
  if (outside.length === 0) return { type: 'own' }

  const newestAuthor = newestInbound?.author.trim().toLowerCase() ?? ''
  const sender = outside.includes(newestAuthor) ? newestAuthor : outside[0]

  // Gmail sources on Everywhere keep records but are never routing targets (preflight R14).
  const targets = sources.filter((s) => s.scopeId !== EVERYWHERE_SCOPE_ID)
  const matching = targets.filter((s) => s.config.matchers.some((m) => outside.some((a) => matches(m, a))))
  const matchingScopes = unique(matching.map((s) => s.scopeId))
  if (matchingScopes.length === 1) return { type: 'scope', sourceId: matching[0].id, scopeId: matchingScopes[0] }

  const candidateScopeIds = matchingScopes.length > 1 ? matchingScopes : unique(targets.map((s) => s.scopeId))
  return { type: 'unknown', domain: questionKey(sender), candidateScopeIds }
}
