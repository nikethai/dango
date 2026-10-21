import { describe, expect, it } from 'vitest'
import { defaultScopeKind, suggestScopeName } from './scopeName'

describe('suggestScopeName', () => {
  it('uses the last path segment for a folder', () => {
    expect(suggestScopeName({ kind: 'folder', label: 'dango', ref: '/Users/x/Projects/dango' })).toBe('dango')
  })

  it('handles Windows paths with a trailing separator', () => {
    expect(suggestScopeName({ kind: 'folder', label: 'acme-site', ref: 'C:\\work\\acme-site\\' })).toBe('acme-site')
  })

  it('uses the collection name for documents', () => {
    expect(suggestScopeName({ kind: 'documents', label: 'Specs', ref: 'Specs' })).toBe('Specs')
  })

  it("uses the address's domain without TLD, capitalised, for gmail", () => {
    expect(suggestScopeName({ kind: 'gmail', label: 'pm@acme.com', ref: 'pm@acme.com' })).toBe('Acme')
    expect(suggestScopeName({ kind: 'gmail', label: 'pm@mail.acme.co.uk', ref: 'pm@mail.acme.co.uk' })).toBe('Acme')
  })

  it('gives nothing for a public mail domain', () => {
    for (const domain of ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com']) {
      expect(suggestScopeName({ kind: 'gmail', label: `pm@${domain}`, ref: `pm@${domain}` })).toBe('')
    }
    expect(suggestScopeName({ kind: 'gmail', label: 'PM@Gmail.com', ref: 'PM@Gmail.com' })).toBe('')
  })

  it('gives nothing for a drive or file system root', () => {
    expect(suggestScopeName({ kind: 'folder', label: 'C:\\', ref: 'C:\\' })).toBe('')
    expect(suggestScopeName({ kind: 'folder', label: 'D:', ref: 'D:' })).toBe('')
    expect(suggestScopeName({ kind: 'folder', label: '/', ref: '/' })).toBe('')
  })

  it('gives nothing for gmail without an address', () => {
    expect(suggestScopeName({ kind: 'gmail', label: 'Gmail' })).toBe('')
  })

  it('uses the label for asana', () => {
    expect(suggestScopeName({ kind: 'asana', label: 'Acme workspace', ref: 'pm@acme.com' })).toBe('Acme workspace')
  })

  it('uses the domain name for an asana label that is an address', () => {
    expect(suggestScopeName({ kind: 'asana', label: 'pm@acme.com', ref: 'pm@acme.com' })).toBe('Acme')
    expect(suggestScopeName({ kind: 'asana', label: 'pm@gmail.com', ref: 'pm@gmail.com' })).toBe('')
  })

  it('gives nothing for codex threads', () => {
    expect(suggestScopeName({ kind: 'codex-threads', label: 'Codex threads', ref: '~/.codex' })).toBe('')
  })
})

describe('defaultScopeKind', () => {
  it('is client for gmail and asana, project otherwise', () => {
    expect(defaultScopeKind('gmail')).toBe('client')
    expect(defaultScopeKind('asana')).toBe('client')
    expect(defaultScopeKind('folder')).toBe('project')
    expect(defaultScopeKind('documents')).toBe('project')
    expect(defaultScopeKind('codex-threads')).toBe('project')
  })
})
