import { describe, expect, it } from 'vitest'
import * as history from '@/packages/model-calls/toolsets/pm-pilot-history'
import { CLIENT_ANSWER_TOOL, CLIENT_RECALL_TOOL, chatHoldsLocalOnly, holdsLocalOnlyRecall } from './local-only-chat'

const recall = (localOnly: boolean) => ({
  contentParts: [
    {
      type: 'tool-call' as const,
      state: 'result' as const,
      toolCallId: 't1',
      toolName: CLIENT_RECALL_TOOL,
      args: {},
      result: { localOnly },
    },
  ],
})

describe('local-only-chat', () => {
  it('finds a local-only recall, a local-only summary or a Needs you opening', () => {
    expect(chatHoldsLocalOnly([recall(true)])).toBe(true)
    expect(chatHoldsLocalOnly([{ contentParts: [], pmLocalOnly: true }])).toBe(true)
    expect(chatHoldsLocalOnly([{ contentParts: [], pmQuestionId: 'q1' }])).toBe(true)
    expect(chatHoldsLocalOnly([recall(false), { contentParts: [] }])).toBe(false)
    expect(holdsLocalOnlyRecall(recall(true))).toBe(true)
  })

  it('pm-pilot-history keeps the same exports', () => {
    expect(history.chatHoldsLocalOnly).toBe(chatHoldsLocalOnly)
    expect(history.holdsLocalOnlyRecall).toBe(holdsLocalOnlyRecall)
    expect(history.CLIENT_RECALL_TOOL).toBe(CLIENT_RECALL_TOOL)
    expect(history.CLIENT_ANSWER_TOOL).toBe(CLIENT_ANSWER_TOOL)
  })
})
