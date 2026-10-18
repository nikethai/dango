import type { MessagePlanPart } from '@shared/types'
import { describe, expect, it } from 'vitest'
import type { Task } from '@/stores/taskStore'
import {
  parsePlanSteps,
  planCardState,
  planContinueState,
  planHasMoreThanSteps,
  planRunOrigin,
  planRunTasks,
  planStepViews,
  sortTasksForDisplay,
} from './planSteps'

function task(partial: Partial<Task> & Pick<Task, 'id' | 'status'>): Task {
  return {
    sessionId: 's1',
    title: partial.title ?? partial.id,
    createdAt: partial.createdAt ?? 0,
    updatedAt: partial.updatedAt ?? 0,
    ...partial,
  }
}

const plan = (fields: Partial<MessagePlanPart>): MessagePlanPart => ({
  type: 'plan',
  planText: '1. Find\n2. Update',
  status: 'pending',
  ...fields,
})

describe('parsePlanSteps', () => {
  it('reads numbered and bulleted lines', () => {
    // One list is one kind: a bulleted list after a numbered one is a second list (see I3), so each kind is read alone.
    expect(parsePlanSteps('Intro\n1. Find\n2) Update')).toEqual(['Find', 'Update'])
    expect(parsePlanSteps('Intro\n- Move\n* Log\n+ Ship')).toEqual(['Move', 'Log', 'Ship'])
  })
  it('counts only the top-level items of the first list: nested bullets are part of their step', () => {
    const text = '1. Find the files\n   - in src\n   - in docs\n2. Update the index\n    1. sort it\n3. Log'
    expect(parsePlanSteps(text)).toEqual(['Find the files', 'Update the index', 'Log'])
  })
  it('an indented list is still the top level when it is the first list', () => {
    expect(parsePlanSteps('  1. Find\n     - deep\n  2. Update')).toEqual(['Find', 'Update'])
  })
  it('stops at a Notes or Risks section: heading, bold label or "Label:" line', () => {
    expect(parsePlanSteps('1. A\n2. B\n\n## Risks\n1. r1\n2. r2')).toEqual(['A', 'B'])
    expect(parsePlanSteps('- A\n- B\n\n**Notes**\n- n1')).toEqual(['A', 'B'])
    expect(parsePlanSteps('1. A\n2. B\nRisks:\n3. r1')).toEqual(['A', 'B'])
  })
  it('stops at prose after a blank line, and at a list of the other kind', () => {
    expect(parsePlanSteps('- A\n- B\n\nThen we ship.\n- C')).toEqual(['A', 'B'])
    expect(parsePlanSteps('1. A\n2. B\n- touched: a.ts')).toEqual(['A', 'B'])
  })
  it('keeps a loose list (blank lines between items) and lazy continuation lines', () => {
    expect(parsePlanSteps('1. A\n\n2. B\n\n3. C')).toEqual(['A', 'B', 'C'])
    expect(parsePlanSteps('1. A\nmore about A\n2. B')).toEqual(['A', 'B'])
  })
  it('ignores list-looking lines inside code fences', () => {
    expect(parsePlanSteps('```\n1. not a step\n```\n1. Real')).toEqual(['Real'])
  })
  it('plain prose has no steps', () => {
    expect(parsePlanSteps('Inspect the issue, implement the fix, then validate it.')).toEqual([])
    expect(parsePlanSteps('')).toEqual([])
  })
  it('keeps at most 20 steps', () => {
    const text = Array.from({ length: 30 }, (_, i) => `${i + 1}. Step ${i + 1}`).join('\n')
    const steps = parsePlanSteps(text)
    expect(steps).toHaveLength(20)
    expect(steps[19]).toBe('Step 20')
  })
})

describe('planCardState', () => {
  it('pending → proposed', () => {
    expect(planCardState(plan({ status: 'pending' }), false)).toBe('proposed')
  })
  it('rejected with the revised flag → revised', () => {
    expect(planCardState(plan({ status: 'rejected', revised: true, version: 1 }), false)).toBe('revised')
  })
  it("a stored status 'revised' (written by an earlier 6a build) → revised", () => {
    expect(planCardState(plan({ status: 'revised', version: 1 }), false)).toBe('revised')
  })
  it('rejected → rejected', () => {
    expect(planCardState(plan({ status: 'rejected' }), false)).toBe('rejected')
  })
  it('approved with finishedAt → finished', () => {
    expect(planCardState(plan({ status: 'approved', startedAt: 1, finishedAt: 2 }), false)).toBe('finished')
  })
  it('approved and generating → running', () => {
    expect(planCardState(plan({ status: 'approved', startedAt: 1 }), true)).toBe('running')
  })
  it('approved, not generating, no finishedAt → stopped', () => {
    expect(planCardState(plan({ status: 'approved', startedAt: 1 }), false)).toBe('stopped')
  })
  it('legacy approved plan without startedAt, not generating → finished (R12)', () => {
    expect(planCardState(plan({ status: 'approved' }), false)).toBe('finished')
  })
})

describe('planStepViews', () => {
  it('tasks win when present', () => {
    const views = planStepViews('1. A\n2. B\n3. C', [
      task({ id: 't1', title: 'Find', status: 'done', createdAt: 1 }),
      task({ id: 't2', title: 'Update', status: 'in-progress', createdAt: 2 }),
      task({ id: 't3', title: 'Log', status: 'pending', createdAt: 3 }),
    ])
    expect(views.map((v) => v.status)).toEqual(['done', 'current', 'pending'])
    expect(views.map((v) => v.title)).toEqual(['Find', 'Update', 'Log'])
  })
  it('keeps task creation order and marks failed tasks', () => {
    const views = planStepViews('', [
      task({ id: 'b', status: 'failed', createdAt: 2 }),
      task({ id: 'a', status: 'done', createdAt: 1 }),
    ])
    expect(views).toEqual([
      { title: 'a', status: 'done' },
      { title: 'b', status: 'failed' },
    ])
  })
  it('without tasks every parsed step is pending', () => {
    expect(planStepViews('1. Find\n2. Update', [])).toEqual([
      { title: 'Find', status: 'pending' },
      { title: 'Update', status: 'pending' },
    ])
  })
})

describe('planRunTasks', () => {
  const tasks = [
    task({ id: 'old', status: 'done', createdAt: 50 }),
    task({ id: 'other', status: 'pending', createdAt: 150, sessionId: 's2' }),
    task({ id: 'new', status: 'in-progress', createdAt: 150 }),
  ]
  it("keeps this session's tasks created since the run started", () => {
    expect(planRunTasks(tasks, 's1', 100).map((t) => t.id)).toEqual(['new'])
  })
  it('a done task from before startedAt is excluded', () => {
    expect(planRunTasks(tasks, 's1', 100).some((t) => t.id === 'old')).toBe(false)
  })
  it('without startedAt keeps every task of the session', () => {
    expect(planRunTasks(tasks, 's1', undefined).map((t) => t.id)).toEqual(['old', 'new'])
  })
  it('a run that creates no tasks falls back to the parsed steps', () => {
    const run = planRunTasks(tasks, 's1', 1_000)
    expect(run).toEqual([])
    expect(planStepViews('1. Find\n2. Log', run).map((v) => v.status)).toEqual(['pending', 'pending'])
  })
})

describe('planContinueState', () => {
  const ok = { latestPlan: true, isTail: true, generationActive: false, planModeOn: true }
  it('ready only for the latest plan at the tail with nothing generating', () => {
    expect(planContinueState(ok)).toBe('ready')
  })
  it('hidden for an older plan, a plan with later messages, or while anything generates', () => {
    expect(planContinueState({ ...ok, latestPlan: false })).toBe('hidden')
    expect(planContinueState({ ...ok, isTail: false })).toBe('hidden')
    expect(planContinueState({ ...ok, generationActive: true })).toBe('hidden')
  })
  it('blocked when plan mode is off', () => {
    expect(planContinueState({ ...ok, planModeOn: false })).toBe('blocked')
  })
})

describe('sortTasksForDisplay', () => {
  it('orders in-progress, pending, failed, then done', () => {
    const sorted = sortTasksForDisplay([
      task({ id: 'd', status: 'done', createdAt: 1 }),
      task({ id: 'p', status: 'pending', createdAt: 2 }),
      task({ id: 'f', status: 'failed', createdAt: 3 }),
      task({ id: 'i', status: 'in-progress', createdAt: 4 }),
    ])
    expect(sorted.map((t) => t.id)).toEqual(['i', 'p', 'f', 'd'])
  })

  it('stable by createdAt within the same status', () => {
    const sorted = sortTasksForDisplay([
      task({ id: 'b', status: 'pending', createdAt: 20 }),
      task({ id: 'a', status: 'pending', createdAt: 10 }),
    ])
    expect(sorted.map((t) => t.id)).toEqual(['a', 'b'])
  })
})

describe('planRunOrigin', () => {
  it('is startedAt for a plan that never stopped, and undefined for a legacy plan', () => {
    expect(planRunOrigin(plan({ status: 'approved', startedAt: 1_000 }))).toBe(1_000)
    expect(planRunOrigin(plan({ status: 'approved' }))).toBeUndefined()
  })
  it('a resumed plan counts its earlier runs, not the time it sat stopped', () => {
    // Ran 60 s, sat stopped, resumed at 500 s: the timer reads as if it started 60 s before the resume.
    expect(planRunOrigin(plan({ status: 'approved', startedAt: 0, runMs: 60_000, runStartedAt: 500_000 }))).toBe(
      440_000
    )
  })
})

describe('planHasMoreThanSteps', () => {
  it('false when the plan is only its step list', () => {
    expect(planHasMoreThanSteps('1. Find\n2. Update\n')).toBe(false)
  })
  it('true with an intro, nested detail or a trailing section', () => {
    expect(planHasMoreThanSteps('Here is the plan.\n\n1. Find\n2. Update')).toBe(true)
    expect(planHasMoreThanSteps('1. Find\n   - in src\n2. Update')).toBe(true)
    expect(planHasMoreThanSteps('1. Find\n2. Update\n\n## Risks\n- none')).toBe(true)
  })
  it('true for prose without steps', () => {
    expect(planHasMoreThanSteps('Just do it.')).toBe(true)
  })
})
