import { describe, expect, it } from 'vitest'
import { artifactFileName } from './artifactFile'

describe('artifactFileName', () => {
  it('slugs the title and uses the kind extension', () => {
    expect(artifactFileName({ title: 'Pricing Table v2', kind: 'html' })).toBe('pricing-table-v2.html')
    expect(artifactFileName({ title: 'Flow', kind: 'svg' })).toBe('flow.svg')
    expect(artifactFileName({ title: 'Notes', kind: 'markdown' })).toBe('notes.md')
    expect(artifactFileName({ title: 'Seq', kind: 'mermaid' })).toBe('seq.mmd')
  })

  it('falls back to artifact and picks code extensions by language', () => {
    expect(artifactFileName({ kind: 'code', language: 'python' })).toBe('artifact.py')
    expect(artifactFileName({ kind: 'code', language: 'TypeScript' })).toBe('artifact.ts')
    expect(artifactFileName({ kind: 'code', language: 'bash' })).toBe('artifact.sh')
  })

  it('uses .txt for unknown languages and empty slugs', () => {
    expect(artifactFileName({ title: '***', kind: 'code', language: 'zig' })).toBe('artifact.txt')
  })

  it('cuts at 60 characters without leaving a dash at the end', () => {
    const name = artifactFileName({ title: `${'a'.repeat(59)} bcd`, kind: 'html' })
    expect(name).toBe(`${'a'.repeat(59)}.html`)
  })

  it('keeps letters and digits of any script (M10)', () => {
    expect(artifactFileName({ title: 'Bảng giá 2026', kind: 'html' })).toBe('bảng-giá-2026.html')
    expect(artifactFileName({ title: '价格表', kind: 'markdown' })).toBe('价格表.md')
    expect(artifactFileName({ title: 'Ценовая таблица', kind: 'svg' })).toBe('ценовая-таблица.svg')
  })

  it('never keeps filesystem-reserved characters', () => {
    expect(artifactFileName({ title: 'a/b\\c:d*e?"f<g>h|i', kind: 'html' })).toBe('a-b-c-d-e-f-g-h-i.html')
  })

  it('counts the 60 characters as characters, not UTF-16 units', () => {
    const name = artifactFileName({ title: '𠀀'.repeat(70), kind: 'html' })
    expect(Array.from(name.replace('.html', ''))).toHaveLength(60)
  })

  it('limits the base name to 60 characters', () => {
    const name = artifactFileName({ title: 'a'.repeat(90), kind: 'html' })
    expect(name).toBe(`${'a'.repeat(60)}.html`)
  })
})
