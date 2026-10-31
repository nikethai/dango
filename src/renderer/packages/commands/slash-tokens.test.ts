import { describe, expect, it } from 'vitest'
import {
  extractCommandNamesFromText,
  getActiveCommandSlashQuery,
  replaceActiveCommandSlashWithSkillToken,
  stripCommandSlashTokens,
} from './slash-tokens'

describe('slash tokens', () => {
  it('extracts /command names at boundaries', () => {
    expect(extractCommandNamesFromText('please /review and /fix-issue')).toEqual(['review', 'fix-issue'])
  })

  it('does not treat https URLs as commands', () => {
    expect(extractCommandNamesFromText('see https://example.com/path')).toEqual([])
  })

  it('getActiveCommandSlashQuery only for single-line slash drafts', () => {
    expect(getActiveCommandSlashQuery('/')).toBe('')
    expect(getActiveCommandSlashQuery('/rev')).toBe('rev')
    expect(getActiveCommandSlashQuery('hello /rev')).toBe(null)
    expect(getActiveCommandSlashQuery('/rev\nmore')).toBe(null)
  })

  it('does not treat a /word followed by another / as a command', () => {
    expect(extractCommandNamesFromText('/tmp/alpha-beta and /review/notes')).toEqual([])
  })

  it('strips slash tokens', () => {
    expect(stripCommandSlashTokens('/review the PR', ['review'])).toBe('the PR')
  })
})

describe('stripCommandSlashTokens keeps what is not a command', () => {
  const names = ['review', 'tmp', 'usr', 'fix-issue']

  it('keeps file paths, even when a command shares a segment name', () => {
    expect(stripCommandSlashTokens('Repeat exactly: /tmp/alpha-beta /usr/local/bin', names)).toBe(
      'Repeat exactly: /tmp/alpha-beta /usr/local/bin'
    )
  })

  it('keeps URLs and fractions', () => {
    expect(stripCommandSlashTokens('see https://example.com/a/b, scored 5/7', names)).toBe(
      'see https://example.com/a/b, scored 5/7'
    )
  })

  it('keeps a /word that names no command', () => {
    expect(stripCommandSlashTokens('use /foo here', names)).toBe('use /foo here')
  })

  it('strips only the real command among other slashes', () => {
    expect(stripCommandSlashTokens('/fix-issue in /tmp/a.txt', names)).toBe('in /tmp/a.txt')
  })
})

describe('replaceActiveCommandSlashWithSkillToken', () => {
  it('replaces the active /partial with a $skill token and a space', () => {
    expect(replaceActiveCommandSlashWithSkillToken('fix /rev', 'review-code')).toBe('fix $review-code ')
  })

  it('replaces a whole-input slash draft', () => {
    expect(replaceActiveCommandSlashWithSkillToken('/', 'review-code')).toBe('$review-code ')
  })

  it('works at the caret and keeps the rest', () => {
    expect(replaceActiveCommandSlashWithSkillToken('a /re b', 'review-code', 5)).toBe('a $review-code b')
  })
})
