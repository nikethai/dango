import { createMessage, type Message } from '@shared/types'
import { describe, expect, test } from 'vitest'
import { isToolsOffTurn } from './tools-off'

function msg(id: string, role: 'user' | 'assistant', toolsOff?: boolean): Message {
  return { ...createMessage(role, id), id, ...(toolsOff ? { toolsOff } : {}) }
}

describe('isToolsOffTurn', () => {
  test("the turn's user message asked to answer without tools", () => {
    expect(isToolsOffTurn([msg('u1', 'user', true), msg('a1', 'assistant')], 'a1')).toBe(true)
  })

  test('a plain turn keeps its tools', () => {
    expect(isToolsOffTurn([msg('u1', 'user'), msg('a1', 'assistant')], 'a1')).toBe(false)
  })

  test("only the turn's own user message counts", () => {
    const messages = [msg('u1', 'user', true), msg('a1', 'assistant'), msg('u2', 'user'), msg('a2', 'assistant')]
    expect(isToolsOffTurn(messages, 'a2')).toBe(false)
  })

  test('an unknown id is not tools-off', () => {
    expect(isToolsOffTurn([msg('u1', 'user', true), msg('a1', 'assistant')], 'nope')).toBe(false)
  })
})
