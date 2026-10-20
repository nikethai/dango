import { describe, expect, it } from 'vitest'
import { firstChatSuggestions } from './firstChatSuggestions'

describe('firstChatSuggestions', () => {
  it('offers three general starters without a scope', () => {
    expect(firstChatSuggestions({ scopeKind: null })).toEqual([
      'What needs me today?',
      'What changed this week?',
      'Help me write a reply',
    ])
  })

  it('names the project in a project scope', () => {
    const out = firstChatSuggestions({ scopeName: 'Atlas', scopeKind: 'project' })
    expect(out).toEqual([
      'What changed in Atlas since I last looked?',
      'Summarise what we know about Atlas',
      "What's still open in Atlas?",
    ])
  })

  it('names the client in a client scope', () => {
    const out = firstChatSuggestions({ scopeName: 'Acme', scopeKind: 'client' })
    expect(out).toEqual(['What did we promise Acme last?', 'Draft a reply to Acme', "What's still open with Acme?"])
  })

  it('inserts a scope name with quotes verbatim', () => {
    const name = `O'Brien "Bros" & <Co> {{x}}`
    const out = firstChatSuggestions({ scopeName: name, scopeKind: 'client' })
    expect(out).toHaveLength(3)
    for (const line of out) expect(line).toContain(name)
    expect(out[1]).toBe(`Draft a reply to ${name}`)
  })

  it('falls back to the general starters when a scope has no name', () => {
    expect(firstChatSuggestions({ scopeName: '  ', scopeKind: 'project' })).toHaveLength(3)
    expect(firstChatSuggestions({ scopeName: '', scopeKind: 'project' })[0]).toBe('What needs me today?')
  })
})
