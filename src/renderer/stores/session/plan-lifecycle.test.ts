import type { Message, MessagePlanPart, Session } from '@shared/types'
import i18next from 'i18next'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  addReviewEntry: vi.fn(async (input: unknown) => input),
  getStagedChangeSetId: vi.fn((_sessionId: string): string | undefined => undefined),
}))
vi.mock('@/packages/review', () => ({ addReviewEntry: h.addReviewEntry }))
vi.mock('@/packages/model-calls/toolsets/file', () => ({ getStagedChangeSetId: h.getStagedChangeSetId }))

import {
  canResumePlan,
  finishExecutedPlan,
  nextPlanVersion,
  planResumePrompt,
  planResumeRefusal,
  planTitle,
  recordFinishedPlan,
  resumedRunParts,
  withResumedParts,
} from './plan-lifecycle'

beforeAll(async () => {
  await i18next.init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } })
})

beforeEach(() => {
  h.addReviewEntry.mockClear()
  h.getStagedChangeSetId.mockReset()
  h.getStagedChangeSetId.mockReturnValue(undefined)
})

const plan = (p: Partial<MessagePlanPart>): MessagePlanPart => ({
  type: 'plan',
  planText: '1. Move plans/*.md to docs/specs/\n2. Update the index',
  status: 'pending',
  ...p,
})

const msg = (id: string, parts: Message['contentParts'] = [], role: Message['role'] = 'assistant'): Message => ({
  id,
  role,
  contentParts: parts,
})

const editCall = (state: 'call' | 'result' | 'error', toolName = 'edit_file') =>
  ({ type: 'tool-call', state, toolCallId: `t-${toolName}-${state}`, toolName, args: {} }) as const

describe('nextPlanVersion', () => {
  it('is 1 with no earlier plan', () => {
    expect(nextPlanVersion([msg('u1', [], 'user'), msg('a1')], 'a1')).toBe(1)
  })
  it('is 2 when the latest earlier plan is revised without a version', () => {
    const messages = [msg('a0', [plan({ status: 'revised' })]), msg('u1', [], 'user'), msg('a1')]
    expect(nextPlanVersion(messages, 'a1')).toBe(2)
  })
  it('is 3 when the latest earlier plan is revised with version 2', () => {
    const messages = [
      msg('a0', [plan({ status: 'revised' })]),
      msg('a1', [plan({ status: 'revised', version: 2 })]),
      msg('u1', [], 'user'),
      msg('a2'),
    ]
    expect(nextPlanVersion(messages, 'a2')).toBe(3)
  })
  it('is 1 when the latest earlier plan was approved', () => {
    const messages = [msg('a0', [plan({ status: 'approved', version: 2 })]), msg('u1', [], 'user'), msg('a1')]
    expect(nextPlanVersion(messages, 'a1')).toBe(1)
  })
  it('ignores plans after the target message', () => {
    const messages = [msg('a1'), msg('a2', [plan({ status: 'revised', version: 4 })])]
    expect(nextPlanVersion(messages, 'a1')).toBe(1)
  })
})

describe('planTitle', () => {
  it('takes the first parsed step', () => {
    expect(planTitle('Here is the plan.\n\n1. Find the files\n2. Move them')).toBe('Find the files')
    expect(planTitle('Intro\n- Move\n* Log')).toBe('Move')
  })
  it('falls back to the first non-empty line', () => {
    expect(planTitle('\n\n  Tidy the docs folder  \nthen stop')).toBe('Tidy the docs folder')
  })
  it('keeps at most 80 characters', () => {
    const title = planTitle(`1. ${'a'.repeat(200)}`)
    expect(title.length).toBeLessThanOrEqual(80)
    expect(title.endsWith('…')).toBe(true)
  })
})

describe('resuming a stopped plan', () => {
  it('only a started, unfinished approved plan can resume', () => {
    expect(canResumePlan(plan({ status: 'approved', startedAt: 1 }))).toBe(true)
    expect(canResumePlan(plan({ status: 'approved', startedAt: 1, finishedAt: 2 }))).toBe(false)
    expect(canResumePlan(plan({ status: 'approved' }))).toBe(false)
    expect(canResumePlan(plan({ status: 'pending' }))).toBe(false)
    expect(canResumePlan(undefined)).toBe(false)
  })
  it("keeps the stopped run's visible work, without the plan part", () => {
    const tool = { type: 'tool-call', toolCallId: 'c1', toolName: 'edit_file', state: 'result', args: {} } as const
    const parts: Message['contentParts'] = [
      plan({ status: 'approved', startedAt: 1 }),
      tool,
      { type: 'text', text: 'Half way' },
    ]
    expect(resumedRunParts(parts)).toEqual([tool, { type: 'text', text: 'Half way' }])
  })
  it('the resumed run paints after the stopped work', () => {
    const before: Message['contentParts'] = [{ type: 'text', text: 'Half way' }]
    expect(withResumedParts(before, { contentParts: [{ type: 'text', text: 'Done' }] }).contentParts).toEqual([
      { type: 'text', text: 'Half way' },
      { type: 'text', text: 'Done' },
    ])
    const noParts: { contentParts?: Message['contentParts']; text: string } = { text: 'x' }
    expect(withResumedParts(before, noParts)).toBe(noParts)
  })
  it('the resume prompt asks to continue from where the run stopped', () => {
    expect(planResumePrompt()).toMatch(/stopped/i)
    expect(planResumePrompt()).toMatch(/tasks/i)
  })
})

describe('planResumeRefusal', () => {
  const stopped = (fields: Partial<MessagePlanPart> = {}): Message =>
    ({
      id: 'a1',
      role: 'assistant',
      contentParts: [plan({ status: 'approved', startedAt: 1, ...fields })],
    }) as Message
  const sessionWith = (...messages: Message[]): Session => ({ id: 's1', name: 'Chat', messages }) as Session
  const ok = { generationActive: false, planModeOn: true }
  it('none for the latest stopped plan at the tail', () => {
    expect(planResumeRefusal(sessionWith(stopped()), 'a1', ok)).toBeNull()
  })
  it('refuses a plan that is not the tail of the chat', () => {
    const later = { id: 'u2', role: 'user', contentParts: [] } as unknown as Message
    expect(planResumeRefusal(sessionWith(stopped(), later), 'a1', ok)).toBe('Only the latest plan can be continued.')
  })
  it('refuses while a generation is active in the chat', () => {
    expect(planResumeRefusal(sessionWith(stopped()), 'a1', { ...ok, generationActive: true })).toBe(
      'Wait for the current reply to finish, then continue the plan.'
    )
  })
  it('refuses a finished plan and a missing message', () => {
    expect(planResumeRefusal(sessionWith(stopped({ finishedAt: 2 })), 'a1', ok)).toBe(
      'This plan can no longer be continued.'
    )
    expect(planResumeRefusal(sessionWith(), 'a1', ok)).toBe('This plan can no longer be continued.')
  })
  it('refuses when plan mode is off', () => {
    expect(planResumeRefusal(sessionWith(stopped()), 'a1', { ...ok, planModeOn: false })).toBe(
      'Turn on plan mode to continue this plan.'
    )
  })
})

describe('finishExecutedPlan', () => {
  const running = plan({ status: 'approved', startedAt: 1 })
  it('no stop: stamps finishedAt', () => {
    expect(finishExecutedPlan(running, { stoppedDuringStream: false, stoppedDuringContinue: false, now: 5 })).toEqual(
      plan({ status: 'approved', startedAt: 1, finishedAt: 5 })
    )
  })
  it('stop during the main stream: no finishedAt', () => {
    expect(
      finishExecutedPlan(running, { stoppedDuringStream: true, stoppedDuringContinue: false, now: 5 }).finishedAt
    ).toBeUndefined()
  })
  it('stop during the closing answer (continue stream): no finishedAt', () => {
    expect(
      finishExecutedPlan(running, { stoppedDuringStream: false, stoppedDuringContinue: true, now: 5 }).finishedAt
    ).toBeUndefined()
  })
})

describe('recordFinishedPlan', () => {
  const finished = plan({ status: 'approved', startedAt: 1_000, finishedAt: 2_000 })
  const session = (parts: Message['contentParts'], extra: Partial<Session> = {}): Session => ({
    id: 's1',
    name: 'Docs move',
    messages: [msg('u1', [], 'user'), msg('a1', [...parts, finished])],
    ...extra,
  })

  it('no change entry without staged edits', async () => {
    await recordFinishedPlan(session([editCall('result')]), 'a1', finished)
    expect(h.addReviewEntry).not.toHaveBeenCalled()
  })

  it('no change entry when a change set is staged but this plan made no edits', async () => {
    h.getStagedChangeSetId.mockReturnValue('cs-1')
    await recordFinishedPlan(
      session([editCall('call'), editCall('error', 'delete_file'), editCall('result', 'read_file')]),
      'a1',
      plan({ ...finished, finishedAt: 2_001 })
    )
    expect(h.addReviewEntry).not.toHaveBeenCalled()
  })

  it('stopped run (no finishedAt): no entry', async () => {
    h.getStagedChangeSetId.mockReturnValue('cs-1')
    await recordFinishedPlan(session([editCall('result')]), 'a1', plan({ status: 'approved', startedAt: 1 }))
    expect(h.addReviewEntry).not.toHaveBeenCalled()
  })

  it('one change entry per finished plan', async () => {
    h.getStagedChangeSetId.mockReturnValue('cs-1')
    const s = session([editCall('result', 'create_file')], { projectId: 'p1' })
    await recordFinishedPlan(s, 'a1', finished)
    expect(h.getStagedChangeSetId).toHaveBeenCalledWith('s1')
    expect(h.addReviewEntry).toHaveBeenCalledTimes(1)
    expect(h.addReviewEntry).toHaveBeenCalledWith({
      kind: 'change',
      ref: { type: 'change', id: 'cs-1' },
      text: 'Plan finished: Move plans/*.md to docs/specs/',
      sub: 'From the chat "Docs move"',
      scopeId: 'p1',
      chatId: 's1',
    })
    await recordFinishedPlan(s, 'a1', { ...finished })
    expect(h.addReviewEntry).toHaveBeenCalledTimes(1)
  })

  it('a failed write can be retried', async () => {
    h.getStagedChangeSetId.mockReturnValue('cs-3')
    const p = plan({ status: 'approved', finishedAt: 4_000 })
    const s: Session = { id: 's3', name: 'Retry', messages: [msg('a3', [editCall('result'), p])] }
    h.addReviewEntry.mockRejectedValueOnce(new Error('disk full'))
    await expect(recordFinishedPlan(s, 'a3', p)).rejects.toThrow('disk full')
    await recordFinishedPlan(s, 'a3', p)
    expect(h.addReviewEntry).toHaveBeenCalledTimes(2)
    await recordFinishedPlan(s, 'a3', p)
    expect(h.addReviewEntry).toHaveBeenCalledTimes(2)
  })

  it('files under Everywhere for a chat with no scope, and keeps external text literal', async () => {
    h.getStagedChangeSetId.mockReturnValue('cs-2')
    const odd = plan({ planText: '1. Rename {{name}} to <b>x</b>', status: 'approved', finishedAt: 3_000 })
    const s: Session = {
      id: 's2',
      name: 'Say "{{title}}" $t(Stop)',
      messages: [msg('a9', [editCall('result', 'delete_file'), odd])],
    }
    await recordFinishedPlan(s, 'a9', odd)
    expect(h.addReviewEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeId: 'everywhere',
        text: 'Plan finished: Rename {{name}} to <b>x</b>',
        sub: 'From the chat "Say "{{title}}" $t(Stop)"',
      })
    )
  })
})
