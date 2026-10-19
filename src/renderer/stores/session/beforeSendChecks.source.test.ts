import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const readSource = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

/** Every .ts/.tsx source under a folder, as [relative path, text]. */
function readSourceTree(relativeDir: string): [string, string][] {
  const entries = readdirSync(resolve(process.cwd(), relativeDir), { recursive: true }) as string[]
  return entries
    .filter((entry) => /\.tsx?$/.test(entry))
    .map((entry) => [join(relativeDir, entry), readSource(join(relativeDir, entry))])
}

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

describe('cost is checked before sending, never during a turn', () => {
  test('never interrupts a started run', () => {
    const generation = readSource('src/renderer/stores/session/generation.ts')
    expect(generation).not.toMatch(/\bshouldShowCostSheet\b/)
    expect(generation).not.toMatch(/useCostHeadsUp/)
    const modelCalls = readSourceTree('src/renderer/packages/model-calls')
    expect(modelCalls.length).toBeGreaterThan(0)
    for (const [path, text] of modelCalls) {
      expect(text, path).not.toMatch(/\bshouldShowCostSheet\b/)
      expect(text, path).not.toMatch(/headsUp/)
    }
  })

  test('the composer asks before sending', () => {
    const inputBox = readSource('src/renderer/components/InputBox/InputBox.tsx')
    const submit = inputBox.slice(inputBox.indexOf('const handleSubmit = async'))
    const ask = submit.indexOf('confirmCost(')
    expect(ask).toBeGreaterThan(-1)
    expect(ask).toBeLessThan(submit.indexOf('setIsSubmitting(true)'))
  })
})
