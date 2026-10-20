import { createMessage, type Message } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { ch6QuestionIds, hideLocalOnlyRecalls, LOCAL_ONLY_ANSWER_PLACEHOLDER } from './pm-pilot-history'

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
