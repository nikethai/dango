/**
 * @vitest-environment jsdom
 */

import type { Message } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { estimateInputTokens, runsForRoom } from './before-send'

const text = (id: string, role: Message['role'], body: string) =>
  ({ id, role, contentParts: [{ type: 'text', text: body }] }) as Message

describe('before-send estimates', () => {
  it('estimates input as characters / 4 over the context (for while exact counts are still running)', () => {
    expect(estimateInputTokens([])).toBe(0)
    expect(estimateInputTokens([text('s', 'system', 'abcd'), text('u', 'user', 'efghij')])).toBe(3)
  })

  it('a Swarm room runs each agent twice; everything else is one run', () => {
    expect(runsForRoom(undefined, 0)).toBe(1)
    expect(runsForRoom('discuss', 3)).toBe(1)
    expect(runsForRoom('swarm', 1)).toBe(1)
    expect(runsForRoom('swarm', 3)).toBe(6)
  })
})
