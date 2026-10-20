import { describe, expect, it } from 'vitest'
import { demoteUnsupported, entryShapeForTier, unsupportedContacts } from './act'
import { DAILY_DRAFT_CAP } from './types'

describe('entryShapeForTier', () => {
  it.each([
    [
      { tier: 'high', draftsToday: 0, localOnlyBlocked: false },
      { kind: 'proposal', risk: 'safe' },
    ],
    [
      { tier: 'high', draftsToday: DAILY_DRAFT_CAP - 1, localOnlyBlocked: false },
      { kind: 'proposal', risk: 'safe' },
    ],
    [
      { tier: 'high', draftsToday: DAILY_DRAFT_CAP, localOnlyBlocked: false },
      { kind: 'proposal', risk: 'risky' },
    ],
    [
      { tier: 'medium', draftsToday: 0, localOnlyBlocked: false },
      { kind: 'proposal', risk: 'risky' },
    ],
    [{ tier: 'low', draftsToday: 0, localOnlyBlocked: false }, { kind: 'needs-you' }],
    [{ tier: 'high', draftsToday: 0, localOnlyBlocked: true }, { kind: 'needs-you' }],
    [{ tier: 'medium', draftsToday: 0, localOnlyBlocked: true }, { kind: 'needs-you' }],
  ] as const)('%o → %o', (input, shape) => {
    expect(entryShapeForTier(input)).toEqual(shape)
  })
})

describe('unsupportedContacts', () => {
  const evidence = ['Pay via https://pay.acme.com/inv/12 or write to billing@acme.com.']

  it('finds a URL or an email address the evidence does not hold', () => {
    expect(unsupportedContacts('Pay at https://evil.example/x today.', evidence)).toEqual(['https://evil.example/x'])
    expect(unsupportedContacts('Write to help@evil.example.', evidence)).toEqual(['help@evil.example'])
    expect(unsupportedContacts('See www.evil.example for it.', evidence)).toEqual(['www.evil.example'])
  })

  it('accepts contacts the evidence holds, ignoring case and trailing punctuation', () => {
    expect(unsupportedContacts('Use https://pay.acme.com/inv/12.', evidence)).toEqual([])
    expect(unsupportedContacts('Write to Billing@Acme.com, thanks.', evidence)).toEqual([])
    expect(unsupportedContacts('The launch is on 4 Nov.', evidence)).toEqual([])
  })

  it('does not accept a contact only because a longer one in the evidence starts with it', () => {
    expect(unsupportedContacts('Go to https://pay.acme.com/inv/1 now', evidence)).toEqual([
      'https://pay.acme.com/inv/1',
    ])
  })
})

describe('demoteUnsupported', () => {
  const evidence = ['The portal is https://portal.acme.com.']

  it('treats a High answer with a URL or address not in the cited evidence as Medium', () => {
    expect(demoteUnsupported('high', 'Log in at https://phish.example', evidence)).toBe('medium')
    expect(demoteUnsupported('high', 'Ask ceo@phish.example', evidence)).toBe('medium')
  })

  it('keeps a High answer whose contacts are all in the evidence', () => {
    expect(demoteUnsupported('high', 'Log in at https://portal.acme.com', evidence)).toBe('high')
    expect(demoteUnsupported('high', 'The launch is 4 Nov', evidence)).toBe('high')
  })

  it('never raises or changes Medium and Low', () => {
    expect(demoteUnsupported('medium', 'https://phish.example', evidence)).toBe('medium')
    expect(demoteUnsupported('low', 'https://phish.example', evidence)).toBe('low')
  })
})
