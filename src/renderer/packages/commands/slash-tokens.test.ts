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

  it('strips slash tokens', () => {
    expect(stripCommandSlashTokens('/review the PR')).toMatch(/the PR/i)
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
