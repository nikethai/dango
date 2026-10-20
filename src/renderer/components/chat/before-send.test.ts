/**
 * @vitest-environment jsdom
 */

import type { Message, Session } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { settingsStore } from '@/stores/settingsStore'
import {
  beforeSendStore,
  estimateInputTokens,
  registerBeforeSendHost,
  requestBeforeSend,
  runsForRoom,
  settleCostHeadsUp,
} from './before-send'

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/stores/chatStore', () => ({
  peekSession: () => h.session,
  getSession: async () => h.session,
}))

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

describe('message-action cost estimate', () => {
  let unregister: (() => void) | undefined
  afterEach(() => {
    settleCostHeadsUp(false)
    unregister?.()
    unregister = undefined
  })

  it('counts attached files: a short question with a large file exceeds the limit and asks first', async () => {
    // $1 per 1,000 input tokens, output free: the $1 limit is crossed past 1,000 input tokens.
    settingsStore.setState({
      costWarningUsd: 1,
      usagePricingOverrides: { 'test-provider': { 'test-model': { input: 1000, output: 0, cachedInput: 0 } } },
    } as never)
    h.session = {
      id: 's1',
      name: 'Report',
      type: 'chat',
      settings: { provider: 'test-provider', modelId: 'test-model', maxTokens: 1 },
      messages: [
        {
          id: 'u1',
          role: 'user',
          contentParts: [{ type: 'text', text: 'Summarize this' }],
          files: [{ id: 'f1', name: 'report.pdf', fileType: 'application/pdf', tokenCountMap: { default: 50_000 } }],
        },
        { id: 'a1', role: 'assistant', contentParts: [{ type: 'text', text: 'Old answer' }] },
      ],
    } as Session
    unregister = registerBeforeSendHost()
    const run = requestBeforeSend('s1', {
      kind: 'redo-with-model',
      messageId: 'a1',
      model: { provider: 'test-provider', modelId: 'test-model' },
    })
    await vi.waitFor(() => expect(beforeSendStore.getState().ask).not.toBeNull())
    settleCostHeadsUp(true)
    await expect(run).resolves.toBe(true)
  })
})
