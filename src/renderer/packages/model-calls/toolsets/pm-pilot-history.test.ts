import { createMessage, type Message } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const localOnlyQuestions = vi.hoisted(() => vi.fn(async (_ids: string[]): Promise<Set<string>> => new Set()))
vi.mock('./pm-pilot', () => ({ loadLocalOnlyQuestionIds: (ids: string[]) => localOnlyQuestions(ids) }))

import { buildContextForAI } from '@/packages/context-management/context-builder'
import {
  ch6QuestionIds,
  chatHoldsLocalOnly,
  cloudSafeMessages,
  hideLocalOnlyRecalls,
  LOCAL_ONLY_ANSWER_PLACEHOLDER,
  localOnlyTurn,
  summaryLocalOnlyMarks,
} from './pm-pilot-history'

const opening = (questionId: string): Message => ({
  ...createMessage('assistant', 'Client asks for the quote. I found two answers: 8,400 · 9,100'),
  pmQuestionId: questionId,
})
const text = (m: Message) => m.contentParts.map((p) => (p.type === 'text' ? p.text : '')).join('')

describe('hideLocalOnlyRecalls in a Needs you chat', () => {
  const chat = (): Message[] => [
    opening('q1'),
    createMessage('user', 'Which one is newer?'),
    createMessage('assistant', 'Jo wrote 8,400 on 12 Sep.'),
    createMessage('user', 'Then 9,100'),
  ]

  it('lists the questions whose chats the messages hold', () => {
    expect(ch6QuestionIds(chat())).toEqual(['q1'])
    expect(ch6QuestionIds([createMessage('user', 'hi')])).toEqual([])
  })

  it("hides the opening and every later answer of a local-only question's chat, keeping the user's words", () => {
    const out = hideLocalOnlyRecalls(chat(), '', new Set(['q1']))
    expect(out.map(text)).toEqual([
      LOCAL_ONLY_ANSWER_PLACEHOLDER,
      'Which one is newer?',
      LOCAL_ONLY_ANSWER_PLACEHOLDER,
      'Then 9,100',
    ])
    expect(JSON.stringify(out)).not.toContain('8,400')
  })

  it('hides them when it is not known whether the question is local-only, and keeps a shareable one', () => {
    expect(JSON.stringify(hideLocalOnlyRecalls(chat(), 'P'))).not.toContain('8,400')
    expect(JSON.stringify(hideLocalOnlyRecalls(chat(), 'P', null))).not.toContain('8,400')
    expect(hideLocalOnlyRecalls(chat(), 'P', new Set()).map(text)[2]).toBe('Jo wrote 8,400 on 12 Sep.')
  })

  it('hides an answer whose client_answer result was marked local-only', () => {
    const answered: Message = {
      ...createMessage('assistant', ''),
      contentParts: [
        {
          type: 'tool-call',
          state: 'result',
          toolCallId: 'c1',
          toolName: 'client_answer',
          args: { answer: '9,100' },
          result: { ok: true, message: 'Saved for Acme: 9,100', localOnly: true },
        },
        { type: 'text', text: 'Saved 9,100 for Acme.' },
      ],
    }
    const out = hideLocalOnlyRecalls([createMessage('user', 'x'), answered], 'P', new Set())
    expect(out.map(text)).toEqual(['x', 'P'])
  })
})

describe('cloudSafeMessages', () => {
  const recall: Message = {
    ...createMessage('assistant', ''),
    contentParts: [
      {
        type: 'tool-call',
        state: 'result',
        toolCallId: 'c1',
        toolName: 'client_recall',
        args: { query: 'price' },
        result: { ok: true, records: [{ text: 'The price is 4,200' }], localOnly: true },
      },
      { type: 'text', text: 'Jo said 4,200.' },
    ],
  }
  const chat = (): Message[] => [opening('q1'), createMessage('user', 'Which is newer?'), recall]

  beforeEach(() => {
    localOnlyQuestions.mockReset().mockResolvedValue(new Set(['q1']))
  })

  it('hides local-only CH6 text and recall answers for a cloud model', async () => {
    const out = JSON.stringify(await cloudSafeMessages(chat(), { provider: 'openai', modelId: 'gpt-x' }, {}))
    expect(out).not.toContain('8,400')
    expect(out).not.toContain('4,200')
    expect(out).toContain('Which is newer?')
    expect(localOnlyQuestions).toHaveBeenCalledWith(['q1'])
  })

  it('treats an unknown provider as cloud, and an unreadable question as local-only', async () => {
    localOnlyQuestions.mockRejectedValue(new Error('storage down'))
    expect(JSON.stringify(await cloudSafeMessages(chat(), undefined, {}))).not.toContain('8,400')
  })

  it('leaves everything for a local model', async () => {
    const messages = chat()
    expect(await cloudSafeMessages(messages, { provider: 'ollama', modelId: 'm' }, {})).toBe(messages)
    expect(localOnlyQuestions).not.toHaveBeenCalled()
  })

  it('treats Ollama on another machine, or running a cloud model, as cloud', async () => {
    const lan = { providers: { ollama: { apiHost: 'http://10.0.0.5:11434' } } }
    const out = await cloudSafeMessages(chat(), { provider: 'ollama', modelId: 'm' }, lan)
    expect(out.map(text)).toContain(LOCAL_ONLY_ANSWER_PLACEHOLDER)
    expect(JSON.stringify(out)).not.toContain('4,200')
    const cloudModel = await cloudSafeMessages(chat(), { provider: 'ollama', modelId: 'gpt-oss:120b-cloud' }, {})
    expect(JSON.stringify(cloudModel)).not.toContain('4,200')
  })

  it('hides a message that carries a local-only question (a summary of that chat), whatever its role', async () => {
    const summary: Message = {
      ...createMessage('user', 'Previous conversation summary: Jo quoted 8,400'),
      pmQuestionId: 'q1',
    }
    const out = await cloudSafeMessages(
      [summary, createMessage('user', 'go on')],
      { provider: 'openai', modelId: 'gpt-x' },
      {}
    )
    expect(JSON.stringify(out)).not.toContain('8,400')
    expect(text(out[1])).toBe('go on')
  })
})

describe('after a local-only recall (final review I2)', () => {
  const recall = (): Message => ({
    ...createMessage('assistant', ''),
    contentParts: [
      {
        type: 'tool-call',
        state: 'result',
        toolCallId: 'c1',
        toolName: 'client_recall',
        args: { query: 'price' },
        result: { ok: true, records: [{ text: 'The price is 4,200' }], localOnly: true },
      },
      { type: 'text', text: 'Jo said 4,200.' },
    ],
  })
  const chat = (): Message[] => [
    createMessage('user', 'What did Jo quote?'),
    createMessage('assistant', 'Let me look.'),
    recall(),
    createMessage('user', 'And with tax?'),
    createMessage('assistant', '4,200 plus 10% is 4,620.'),
    createMessage('user', 'Thanks'),
  ]

  it('hides every later assistant message too, keeping earlier answers and the user words', () => {
    const out = hideLocalOnlyRecalls(chat(), 'P', new Set())
    expect(out.map(text)).toEqual(['What did Jo quote?', 'Let me look.', 'P', 'And with tax?', 'P', 'Thanks'])
    expect(JSON.stringify(out)).not.toContain('4,620')
  })

  it('a cloud turn after a switch from a local model gets none of it', async () => {
    const out = JSON.stringify(await cloudSafeMessages(chat(), { provider: 'openai', modelId: 'gpt-x' }, {}))
    expect(out).not.toContain('4,200')
    expect(out).not.toContain('4,620')
  })

  it('a summary marked local-only is hidden, whatever its role, and so is every later answer', () => {
    const summary: Message = { ...createMessage('user', 'Summary: Jo quoted 4,200'), pmLocalOnly: true }
    const out = hideLocalOnlyRecalls(
      [summary, createMessage('user', 'go on'), createMessage('assistant', 'So 4,620 with tax.')],
      'P',
      new Set()
    )
    expect(out.map(text)).toEqual(['P', 'go on', 'P'])
  })

  it('marks a summary built from such messages, and from a marked summary', () => {
    expect(summaryLocalOnlyMarks(chat())).toEqual({ pmLocalOnly: true })
    expect(summaryLocalOnlyMarks([{ ...createMessage('user', 'S'), pmLocalOnly: true }])).toEqual({ pmLocalOnly: true })
    expect(summaryLocalOnlyMarks([opening('q1'), recall()])).toEqual({ pmQuestionId: 'q1', pmLocalOnly: true })
    expect(summaryLocalOnlyMarks([opening('q1')])).toEqual({ pmQuestionId: 'q1' })
    expect(summaryLocalOnlyMarks([createMessage('user', 'hi')])).toEqual({})
  })
})

describe('legacy memory in chats that hold local-only text (B3)', () => {
  const recallAnswer = (result: unknown): Message => ({
    ...createMessage('assistant', 'Jo wrote 8,400.'),
    contentParts: [
      { type: 'tool-call', state: 'result', toolCallId: 'r1', toolName: 'client_recall', args: {}, result },
      { type: 'text', text: 'Jo wrote 8,400.' },
    ],
  })

  it('knows a chat holds local-only text by a local-only recall, a pmLocalOnly summary or a Needs you opening', () => {
    expect(chatHoldsLocalOnly([recallAnswer({ localOnly: true })])).toBe(true)
    expect(chatHoldsLocalOnly([{ ...createMessage('assistant', 's'), pmLocalOnly: true }])).toBe(true)
    expect(chatHoldsLocalOnly([{ ...createMessage('assistant', 'q'), pmQuestionId: 'q1' }])).toBe(true)
    expect(chatHoldsLocalOnly([createMessage('user', 'hi'), recallAnswer({})])).toBe(false)
  })

  it('treats a local turn as local-only when the chat holds local-only text or client recall is offered', () => {
    expect(localOnlyTurn({ holdsLocalOnly: false, cloudModel: false, clientRecallOffered: true })).toBe(true)
    expect(localOnlyTurn({ holdsLocalOnly: true, cloudModel: false, clientRecallOffered: false })).toBe(true)
    expect(localOnlyTurn({ holdsLocalOnly: true, cloudModel: true, clientRecallOffered: true })).toBe(false)
    expect(localOnlyTurn({ holdsLocalOnly: false, cloudModel: false, clientRecallOffered: false })).toBe(false)
  })
})

describe('after a compaction point, with the local-only recall more than 2 rounds old (review I1)', () => {
  it('a cloud turn gets the placeholder and the chat still holds local-only text', async () => {
    const summary: Message = { ...createMessage('assistant', 'Earlier: greetings.'), isSummary: true }
    const boundary = createMessage('assistant', 'hello')
    const answer: Message = {
      ...createMessage('assistant', ''),
      contentParts: [
        {
          type: 'tool-call',
          state: 'result',
          toolCallId: 'r1',
          toolName: 'client_recall',
          args: { query: 'quote' },
          result: { localOnly: true },
        },
        { type: 'text', text: 'Jo wrote 8,400.' },
      ],
    }
    const messages = [
      createMessage('user', 'hi'),
      boundary,
      summary,
      createMessage('user', 'What did Jo quote?'),
      answer,
      createMessage('user', 'a'),
      createMessage('assistant', 'b'),
      createMessage('user', 'c'),
      createMessage('assistant', 'd'),
    ]
    // generation.ts genMessageContext: the context after the compaction point, old tool calls cleaned.
    const context = buildContextForAI({
      messages,
      compactionPoints: [{ summaryMessageId: summary.id, boundaryMessageId: boundary.id, createdAt: 1 }],
    })
    expect(context.some((m) => m.contentParts.some((p) => p.type === 'tool-call'))).toBe(false)
    expect(chatHoldsLocalOnly(context)).toBe(true)
    const sent = await cloudSafeMessages(context, { provider: 'openai', modelId: 'gpt-5' }, undefined)
    expect(JSON.stringify(sent)).not.toContain('8,400')
    expect(sent.map(text)).toContain(LOCAL_ONLY_ANSWER_PLACEHOLDER)
  })
})
