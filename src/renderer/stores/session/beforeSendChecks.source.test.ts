import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const readSource = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

/** The first `streamText(model, {` call in generate(): the main turn, where tool inputs are decided. */
function mainStreamTextCall(source: string): string {
  const start = source.indexOf('streamText(model, {')
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf('\n        })\n', start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

/** The text of one option of the call, from its name to the next option at the same indent. */
function fieldValue(call: string, field: string): string {
  const match = new RegExp(`\\n( +)${field}`).exec(call)
  expect(match, field).not.toBeNull()
  const start = (match?.index ?? 0) + 1
  const indent = match?.[1] ?? ''
  const next = new RegExp(`\\n${indent}[A-Za-z]+[:,]`, 'g')
  next.lastIndex = start + indent.length + field.length
  const end = next.exec(call)?.index ?? call.length
  return call.slice(start, end)
}

describe('abilities are checked before sending, never during a turn', () => {
  const generation = readSource('src/renderer/stores/session/generation.ts')
  const imports = generation
    .split('\n')
    .filter((line) => /^import\b|^\s+from\s|^} from /.test(line))
    .join('\n')

  test('generation.ts does not import the before-send checks', () => {
    expect(imports).not.toMatch(/modelReadiness/)
    expect(imports).not.toMatch(/headsUp/)
    expect(generation).not.toMatch(/\bturnNeedsTools\b/)
    expect(generation).not.toMatch(/\bheadsUp\b/)
  })

  test('a tools-off turn takes no tools', () => {
    expect(generation).toContain('isToolsOffTurn(')
    const call = mainStreamTextCall(generation)
    for (const field of ['webBrowsing:', 'knowledgeBase:', 'nativeWebSearch:', 'enableImageGenerationTool:']) {
      expect(fieldValue(call, field), field).toContain('toolsOffForTurn')
    }
  })
})
