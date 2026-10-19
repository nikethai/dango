import { describe, expect, it } from 'vitest'
import { filterSystemCommands, matchSystemSlashCommand, parseRewriteCommand } from './system-commands'

describe('system-commands', () => {
  it('matches /compact and aliases as whole-message commands', () => {
    expect(matchSystemSlashCommand('/compact')?.id).toBe('compact')
    expect(matchSystemSlashCommand('  /compact  ')?.id).toBe('compact')
    expect(matchSystemSlashCommand('/compress')?.id).toBe('compact')
    expect(matchSystemSlashCommand('/summarize')?.id).toBe('compact')
  })

  it('does not match prose or package-style mid-text tokens', () => {
    expect(matchSystemSlashCommand('please /compact later')).toBe(null)
    expect(matchSystemSlashCommand('/compact the chat now')).toBe(null)
    expect(matchSystemSlashCommand('hello')).toBe(null)
    expect(matchSystemSlashCommand('/')).toBe(null)
  })

  it('filters picker by query', () => {
    expect(filterSystemCommands('').map((c) => c.name)).toContain('compact')
    expect(filterSystemCommands('comp').map((c) => c.name)).toEqual(['compact'])
    expect(filterSystemCommands('zzz')).toEqual([])
  })

  it('parses /rewrite with an optional style and the text', () => {
    expect(parseRewriteCommand('/rewrite shorter Hey team, so sorry')).toEqual({
      option: 'shorter',
      text: 'Hey team, so sorry',
    })
    expect(parseRewriteCommand('/Rewrite  hello\nworld')).toEqual({ option: null, text: 'hello\nworld' })
    expect(parseRewriteCommand('/rewrite')).toEqual({ option: null, text: '' })
    expect(parseRewriteCommand('/rewriter x')).toBe(null)
    expect(parseRewriteCommand('say /rewrite')).toBe(null)
  })

  it('parses translate, a bare option and a newline right after the option', () => {
    expect(parseRewriteCommand('/rewrite translate Hola a todos')).toEqual({
      option: 'translate',
      text: 'Hola a todos',
    })
    expect(parseRewriteCommand('/rewrite shorter')).toEqual({ option: 'shorter', text: '' })
    expect(parseRewriteCommand('/rewrite Formal  ')).toEqual({ option: 'formal', text: '' })
    expect(parseRewriteCommand('/rewrite clearer\nFirst line\nSecond line')).toEqual({
      option: 'clearer',
      text: 'First line\nSecond line',
    })
    // An option word that only starts a longer word is text, not an option.
    expect(parseRewriteCommand('/rewrite shortest path')).toEqual({ option: null, text: 'shortest path' })
  })

  it('lists rewrite in the picker and keeps /compact', () => {
    expect(filterSystemCommands('rew').map((c) => c.id)).toEqual(['rewrite'])
    expect(matchSystemSlashCommand('/compact')?.id).toBe('compact')
  })
})
