import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { describe, expect, it } from 'vitest'
import { ownMatchers, routeThread } from './route'
import { recordId, type SourceRecord } from './types'

const OWN = 'pm@agency.com'

function rec(over: Partial<SourceRecord> & { externalId: string }): SourceRecord {
  return {
    id: recordId('gmail', over.externalId),
    sourceKind: 'gmail',
    sourceId: null,
    accountId: 'acc1',
    threadOrTaskId: 't1',
    scopeId: null,
    author: 'jo@acme.com',
    participants: ['jo@acme.com', OWN],
    occurredAt: 1000,
    title: 'Quote',
    text: 'Hi',
    sentByMe: false,
    noise: false,
    link: { label: 'Gmail thread "Quote"', url: 'https://mail.google.com/mail/#all/t1' },
    ...over,
  }
}

function src(id: string, scopeId: string, matchers: string[]) {
  return { id, scopeId, config: { accountId: 'acc1', matchers } }
}

describe('ownMatchers', () => {
  it('keeps the domain of a company address and drops a public one', () => {
    expect(ownMatchers('PM@Agency.com')).toEqual({ address: 'pm@agency.com', domain: 'agency.com' })
    expect(ownMatchers('me@gmail.com')).toEqual({ address: 'me@gmail.com' })
  })
})

describe('routeThread', () => {
  it('routes by domain', () => {
    const sources = [src('s-acme', 'acme', ['@acme.com']), src('s-beta', 'beta', ['@beta.io'])]
    expect(routeThread([rec({ externalId: 'm1' })], sources, OWN)).toEqual({
      type: 'scope',
      sourceId: 's-acme',
      scopeId: 'acme',
    })
  })

  it('routes by exact address', () => {
    const sources = [src('s-jo', 'jo-scope', ['jo@acme.com']), src('s-other', 'other', ['ann@acme.com'])]
    expect(routeThread([rec({ externalId: 'm1' })], sources, OWN)).toEqual({
      type: 'scope',
      sourceId: 's-jo',
      scopeId: 'jo-scope',
    })
  })

  it('two matching scopes is unknown with both as candidates', () => {
    const sources = [
      src('s-a', 'scope-a', ['@acme.com']),
      src('s-b', 'scope-b', ['jo@acme.com']),
      src('s-c', 'scope-c', ['@other.com']),
    ]
    expect(routeThread([rec({ externalId: 'm1' })], sources, OWN)).toEqual({
      type: 'unknown',
      domain: 'acme.com',
      candidateScopeIds: ['scope-a', 'scope-b'],
    })
  })

  it('no match is unknown with every scope as a candidate', () => {
    const sources = [src('s-a', 'scope-a', ['@beta.io']), src('s-c', 'scope-c', ['@other.com'])]
    expect(routeThread([rec({ externalId: 'm1' })], sources, OWN)).toEqual({
      type: 'unknown',
      domain: 'acme.com',
      candidateScopeIds: ['scope-a', 'scope-c'],
    })
  })

  it('a newsletter is noise even from an unknown domain', () => {
    const records = [rec({ externalId: 'm1', author: 'news@unknown-shop.com', participants: [OWN], noise: true })]
    expect(routeThread(records, [src('s-a', 'scope-a', ['@acme.com'])], OWN)).toEqual({ type: 'noise' })
  })

  it('looks only at the newest inbound message for noise', () => {
    const records = [
      rec({ externalId: 'm1', occurredAt: 1000, noise: true }),
      rec({ externalId: 'm2', occurredAt: 2000, noise: false }),
      rec({ externalId: 'm3', occurredAt: 3000, author: OWN, sentByMe: true, noise: false }),
    ]
    expect(routeThread(records, [src('s-a', 'scope-a', ['@acme.com'])], OWN).type).toBe('scope')
  })

  it("mail only between the user's colleagues is own", () => {
    const records = [rec({ externalId: 'm1', author: 'lan@agency.com', participants: ['lan@agency.com', OWN] })]
    expect(routeThread(records, [src('s-a', 'scope-a', ['@acme.com'])], OWN)).toEqual({ type: 'own' })
  })

  it('a gmail.com client is keyed by full address', () => {
    const records = [rec({ externalId: 'm1', author: 'Bob@Gmail.com', participants: ['bob@gmail.com', OWN] })]
    expect(routeThread(records, [src('s-a', 'scope-a', ['@acme.com'])], OWN)).toEqual({
      type: 'unknown',
      domain: 'bob@gmail.com',
      candidateScopeIds: ['scope-a'],
    })
    expect(routeThread(records, [src('s-bob', 'bob', ['bob@gmail.com'])], OWN)).toEqual({
      type: 'scope',
      sourceId: 's-bob',
      scopeId: 'bob',
    })
  })

  it('a gmail.com user sees other gmail.com people as outside', () => {
    const own = 'me@gmail.com'
    const records = [rec({ externalId: 'm1', author: 'bob@gmail.com', participants: ['bob@gmail.com', own] })]
    expect(routeThread(records, [], own)).toEqual({ type: 'unknown', domain: 'bob@gmail.com', candidateScopeIds: [] })
  })

  it('never routes to a Gmail source on Everywhere', () => {
    const sources = [src('s-all', EVERYWHERE_SCOPE_ID, ['@acme.com']), src('s-a', 'scope-a', ['@beta.io'])]
    expect(routeThread([rec({ externalId: 'm1' })], sources, OWN)).toEqual({
      type: 'unknown',
      domain: 'acme.com',
      candidateScopeIds: ['scope-a'],
    })
  })

  it('a newest inbound newsletter is noise even when older mail is not', () => {
    const records = [
      rec({ externalId: 'm1', occurredAt: 1000, noise: false }),
      rec({ externalId: 'm2', occurredAt: 2000, author: 'news@acme.com', noise: true }),
    ]
    expect(routeThread(records, [src('s-a', 'scope-a', ['@acme.com'])], OWN)).toEqual({ type: 'noise' })
  })

  it('a domain matcher matches subdomains but not look-alikes', () => {
    const sources = [src('s-a', 'scope-a', ['acme.com']), src('s-b', 'scope-b', ['@beta.io'])]
    const from = (address: string) => [rec({ externalId: 'm1', author: address, participants: [address, OWN] })]
    expect(routeThread(from('jo@eu.acme.com'), sources, OWN)).toMatchObject({ type: 'scope', scopeId: 'scope-a' })
    expect(routeThread(from('x@acme.com.evil.io'), sources, OWN)).toMatchObject({ type: 'unknown' })
    expect(routeThread(from('x@notacme.com'), sources, OWN)).toMatchObject({ type: 'unknown' })
    expect(routeThread(from('x@eu.beta.io'), sources, OWN)).toMatchObject({ type: 'scope', scopeId: 'scope-b' })
  })

  it("an empty own address still treats the user's sent mail as own", () => {
    const records = [
      rec({
        externalId: 'm1',
        occurredAt: 1000,
        author: 'me@agency.com',
        participants: ['me@agency.com', 'lan@agency.com'],
        sentByMe: true,
      }),
      rec({
        externalId: 'm2',
        occurredAt: 2000,
        author: 'lan@agency.com',
        participants: ['lan@agency.com', 'me@agency.com'],
      }),
    ]
    expect(routeThread(records, [src('s-a', 'scope-a', ['@acme.com'])], '')).toEqual({ type: 'own' })
  })

  it('an inbound From claiming the user is not trusted as own', () => {
    const records = [rec({ externalId: 'm1', author: 'jo@acme.com', participants: ['jo@acme.com'], sentByMe: false })]
    expect(routeThread(records, [src('s-a', 'scope-a', ['@acme.com'])], '')).toMatchObject({ type: 'scope' })
  })

  it('an empty own address is not an error', () => {
    const sources = [src('s-a', 'scope-a', ['@acme.com'])]
    expect(routeThread([rec({ externalId: 'm1' })], sources, '').type).toBe('scope')
  })
})
