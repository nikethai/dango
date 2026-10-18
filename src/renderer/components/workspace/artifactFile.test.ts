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

  it('limits the base name to 60 characters', () => {
    const name = artifactFileName({ title: 'a'.repeat(90), kind: 'html' })
    expect(name).toBe(`${'a'.repeat(60)}.html`)
  })
})
