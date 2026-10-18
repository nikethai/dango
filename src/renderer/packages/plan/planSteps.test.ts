import type { MessagePlanPart } from '@shared/types'
import { describe, expect, it } from 'vitest'
import type { Task } from '@/stores/taskStore'
import {
  parsePlanSteps,
  planCardState,
  planContinueState,
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
    expect(parsePlanSteps('Intro\n1. Find\n2) Update\n- Move\n* Log')).toEqual(['Find', 'Update', 'Move', 'Log'])
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
  it('revised → revised', () => {
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
