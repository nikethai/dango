import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const inputBox = readFileSync(resolve(process.cwd(), 'src/renderer/components/InputBox/InputBox.tsx'), 'utf8')

/** handleSubmit's body, from its declaration to the next top-level hook in the component. */
function handleSubmitBody(): string {
  const start = inputBox.indexOf('const handleSubmit = async (')
  expect(start).toBeGreaterThan(-1)
  const end = inputBox.indexOf('\n    }\n', start)
  expect(end).toBeGreaterThan(start)
  return inputBox.slice(start, end)
}

describe('the composer sends the text it has when Enter is pressed (finding 12)', () => {
  test('the sent message is built from the current input at send time', () => {
    const body = handleSubmitBody()
    expect(body).toMatch(/constructUserMessage\(\s*messageInput,/)
    expect(body).toContain('let constructedMessage = userMessage')
  })

  test('the effect-built message, one render behind, is never what gets sent', () => {
    expect(handleSubmitBody()).not.toContain('preConstructedMessage.message')
  })
})
