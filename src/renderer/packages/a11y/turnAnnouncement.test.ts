import type { Message } from '@shared/types'
import i18next from 'i18next'
import { beforeAll, describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en/translation.json'
import {
  type AnnouncerState,
  initialAnnouncerState,
  nextAnnouncement,
  plainTextForSpeech,
  resumedAnnouncerState,
} from './turnAnnouncement'

beforeAll(async () => {
  await i18next.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
})

const T0 = 1_760_000_000_000
const fresh: AnnouncerState = { lastSpokenAt: null, final: false }

function msg(parts: Message['contentParts'], extra: Partial<Message> = {}): Message {
  return { id: 'a1', role: 'assistant', generating: true, timestamp: T0 - 2_000, contentParts: parts, ...extra }
}

const thinking = (text: string) => msg([{ type: 'reasoning', text, startTime: T0 }])

/** Calls nextAnnouncement in order and returns every non-null text. */
function run(steps: Array<[Message, number]>, start: AnnouncerState = fresh) {
  let state = start
  const spoken: string[] = []
  for (const [m, now] of steps) {
    const next = nextAnnouncement(m, state, now)
    if (next) {
      spoken.push(next.text)
      state = next.state
    }
  }
  return { spoken, state }
}

describe('nextAnnouncement', () => {
  it('speaks the thinking line at most every 5 s, counted from the first reasoning part', () => {
    const m = thinking('Reading the brief\nchecking the brief')
    const first = nextAnnouncement(m, fresh, T0)
    expect(first?.text).toBe('Thinking, 0 seconds, checking the brief')
    const spoken: AnnouncerState = { lastSpokenAt: T0, final: false }
    expect(first?.state).toEqual(spoken)
    expect(nextAnnouncement(m, spoken, T0 + 3_000)).toBeNull()
    expect(nextAnnouncement(m, spoken, T0 + 5_000)?.text).toBe('Thinking, 5 seconds, checking the brief')
  })

  it('a plain wait counts from the message timestamp', () => {
    expect(nextAnnouncement(msg([]), fresh, T0)?.text).toBe('Thinking, 2 seconds')
    expect(nextAnnouncement(msg([], { timestamp: T0 - 1_000 }), fresh, T0)?.text).toBe('Thinking, 1 second')
  })

  it('60 streamed text updates within 4 s produce zero announcements', () => {
    const { state } = run([[thinking('a'), T0]])
    const steps: Array<[Message, number]> = []
    for (let i = 0; i < 60; i++) {
      steps.push([
        msg([
          { type: 'reasoning', text: 'a', startTime: T0 },
          { type: 'text', text: 'word '.repeat(i + 1) },
        ]),
        T0 + 1 + Math.floor((i * 3_999) / 60),
      ])
    }
    expect(run(steps, state).spoken).toEqual([])
  })

  it('once answer text exists it says Writing the answer', () => {
    const m = msg([
      { type: 'reasoning', text: 'planning', startTime: T0 },
      { type: 'text', text: 'Five sections' },
    ])
    expect(nextAnnouncement(m, { lastSpokenAt: T0 + 5_000, final: false }, T0 + 10_000)?.text).toBe(
      'Writing the answer, 10 seconds'
    )
  })

  it('speaks the finished answer as plain text once, then nothing forever', () => {
    const done = msg([{ type: 'text', text: '**Five** sections: `Models`' }], { generating: false })
    const { spoken, state } = run([
      [done, T0 + 1_000],
      [done, T0 + 2_000],
      [done, T0 + 60_000],
    ])
    expect(spoken).toEqual(['Five sections: Models'])
    expect(state.final).toBe(true)
    expect(nextAnnouncement(done, state, T0 + 600_000)).toBeNull()
  })

  it('Stop while the model thinks: "Stopped before answering." once, then the ticks stop', () => {
    const live = thinking('weighing the options')
    const stopped = msg([{ type: 'reasoning', text: 'weighing the options', startTime: T0, duration: 6_000 }], {
      generating: false,
    })
    const { spoken, state } = run([
      [live, T0],
      [live, T0 + 5_000],
      [stopped, T0 + 6_000],
      [stopped, T0 + 11_000],
      [stopped, T0 + 16_000],
      [live, T0 + 21_000],
    ])
    expect(spoken).toEqual([
      'Thinking, 0 seconds, weighing the options',
      'Thinking, 5 seconds, weighing the options',
      'Stopped before answering.',
    ])
    expect(state.final).toBe(true)
  })

  it('a turn that ended in an error ends silent: ModelErrorNotice (role="alert") already says it in plain words', () => {
    const final = { lastSpokenAt: T0, final: true }
    const failed = msg([], { generating: false, error: 'Rate limit reached\nRetry-After: 30', errorCode: 429 })
    expect(nextAnnouncement(failed, fresh, T0)).toEqual({ text: '', state: final })
    const partial = msg([{ type: 'text', text: 'Half an answer' }], { generating: false, error: 'socket hang up' })
    expect(nextAnnouncement(partial, fresh, T0)).toEqual({ text: '', state: final })
    // An error code with no message: final, with nothing to say.
    const codeOnly = msg([], { generating: false, errorCode: 10001 })
    expect(nextAnnouncement(codeOnly, fresh, T0)).toEqual({ text: '', state: final })
  })

  it('Swarm plan and task turns end silent; only the captain answer is spoken', () => {
    const final = { lastSpokenAt: T0, final: true }
    const swarm = { runId: 'r1' }
    const task = msg([{ type: 'text', text: 'Task output nobody sees' }], {
      generating: false,
      roomRole: 'do',
      swarm,
    })
    expect(nextAnnouncement(task, fresh, T0)).toEqual({ text: '', state: final })
    // Swarm Stop: the plan turn ends empty, but the captain still answers, so it is not "Stopped before answering.".
    const stoppedPlan = msg([{ type: 'reasoning', text: 'splitting the work', startTime: T0 }], {
      generating: false,
      roomRole: 'plan',
      swarm: { runId: 'r1', stoppedEarly: true },
    })
    expect(nextAnnouncement(stoppedPlan, fresh, T0)).toEqual({ text: '', state: final })
    const deliver = msg([{ type: 'text', text: 'The **answer**' }], { generating: false, roomRole: 'deliver', swarm })
    expect(nextAnnouncement(deliver, fresh, T0)?.text).toBe('The answer')
  })

  it('a resumed run counts from its live start and is not "Writing" until new answer text arrives', () => {
    const old = T0 - 30 * 60_000
    const resumed = msg([
      { type: 'reasoning', text: 'old plan thinking', startTime: old },
      { type: 'text', text: 'Step 1 done' },
    ])
    resumed.timestamp = old
    const start = resumedAnnouncerState(resumed, T0 - 1_000)
    expect(nextAnnouncement(resumed, start, T0)?.text).toBe('Thinking, 1 second')
    const grown = msg([
      { type: 'reasoning', text: 'old plan thinking', startTime: old },
      { type: 'text', text: 'Step 1 done' },
      { type: 'reasoning', text: 'checking step 2', startTime: T0 + 1_000 },
    ])
    expect(nextAnnouncement(grown, start, T0 + 5_000)?.text).toBe('Thinking, 6 seconds, checking step 2')
    const writing = msg([
      { type: 'reasoning', text: 'old plan thinking', startTime: old },
      { type: 'text', text: 'Step 1 done' },
      { type: 'text', text: 'Step 2' },
    ])
    expect(nextAnnouncement(writing, start, T0 + 5_000)?.text).toBe('Writing the answer, 6 seconds')
  })

  it('a message already finished when first seen starts final and says nothing (opening a chat)', () => {
    const old = msg([{ type: 'text', text: 'An old answer' }], { generating: false })
    const state = initialAnnouncerState(old)
    expect(state).toEqual({ lastSpokenAt: null, final: true })
    expect(nextAnnouncement(old, state, T0)).toBeNull()
    expect(initialAnnouncerState(undefined).final).toBe(true)
    expect(initialAnnouncerState(thinking('x'))).toEqual(fresh)
  })
})

describe('plainTextForSpeech', () => {
  it('reads code as "Code block." and strips Markdown syntax', () => {
    expect(plainTextForSpeech('```ts\nx\n```')).toBe('Code block.')
    expect(plainTextForSpeech('# Title\n> quoted _here_\n![chart](a.png) see [the docs](https://x.y)')).toBe(
      'Title\nquoted here\nsee the docs'
    )
    expect(plainTextForSpeech('| a | b |\n|---|---|\n| 1 | 2 |')).toBe('a b\n1 2')
  })
})
