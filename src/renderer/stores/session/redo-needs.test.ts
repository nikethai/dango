import { createMessage, type Message, type Session } from '@shared/types'
import { describe, expect, test } from 'vitest'
import { turnAbilityNeeds } from './redo-needs'

function msg(id: string, role: 'user' | 'assistant', extra: Partial<Message> = {}): Message {
  return { ...createMessage(role, id), id, ...extra }
}

function session(extra: Partial<Session>, messages: Message[]): Session {
  return { id: 's', name: 'S', type: 'chat', messages, ...extra } as Session
}

const imageTurn = [
  msg('u1', 'user', {
    contentParts: [
      { type: 'text', text: 'look' },
      { type: 'image', storageKey: 'k' },
    ],
  }),
  msg('a1', 'assistant'),
]

describe('turnAbilityNeeds (Redo with another model)', () => {
  test('a plain chat turn needs nothing', () => {
    expect(turnAbilityNeeds(session({}, [msg('u1', 'user'), msg('a1', 'assistant')]), 'a1')).toEqual({
      requiresTools: false,
      requiresVision: false,
    })
  })

  test('an agent chat needs tools, unless the turn was sent without tools', () => {
    expect(turnAbilityNeeds(session({ agentMode: true }, [msg('u1', 'user'), msg('a1', 'assistant')]), 'a1')).toEqual({
      requiresTools: true,
      requiresVision: false,
    })
    expect(
      turnAbilityNeeds(
        session({ browserArmed: true }, [msg('u1', 'user', { toolsOff: true }), msg('a1', 'assistant')]),
        'a1'
      ).requiresTools
    ).toBe(false)
  })

  test('a turn with a picture needs vision', () => {
    expect(turnAbilityNeeds(session({}, imageTurn), 'a1').requiresVision).toBe(true)
  })

  test('a turn inside an older thread is found', () => {
    const s = session({ computerArmed: true, threads: [{ id: 't', name: 't', messages: imageTurn, createdAt: 0 }] }, [
      msg('u9', 'user'),
      msg('a9', 'assistant'),
    ])
    expect(turnAbilityNeeds(s, 'a1')).toEqual({ requiresTools: true, requiresVision: true })
  })

  test('swarm counts only in a room of two or more agents', () => {
    const turn = [msg('u1', 'user'), msg('a1', 'assistant')]
    expect(turnAbilityNeeds(session({ roomMode: 'swarm', agentIds: ['a'] }, turn), 'a1').requiresTools).toBe(false)
    expect(turnAbilityNeeds(session({ roomMode: 'swarm', agentIds: ['a', 'b'] }, turn), 'a1').requiresTools).toBe(true)
  })
})
