/**
 * @vitest-environment jsdom
 */

import type { MessagePlanPart } from '@shared/types'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/i18n/locales/en/translation.json'
import type { Task } from '@/stores/taskStore'
import PlanCard, { type PlanCardProps } from './PlanCard'

const h = vi.hoisted(() => ({
  tasks: [] as Task[],
  hydrate: vi.fn(async () => {}),
}))

vi.mock('@/stores/taskStore', () => ({
  useTaskStore: (selector: (state: { tasks: Task[] }) => unknown) => selector({ tasks: h.tasks }),
  taskStore: { getState: () => ({ hydrateSessionTasks: h.hydrate }) },
}))

vi.mock('@/components/Markdown', () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}))

beforeAll(async () => {
  await createInstance()
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
})

beforeEach(() => {
  h.tasks = []
  h.hydrate.mockClear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const FOUR = '1. Find the files\n2. Update the index\n3. Move the notes\n4. Log the result'

const task = (id: string, status: Task['status'], createdAt: number): Task => ({
  id,
  sessionId: 's1',
  title: `Task ${id}`,
  status,
  createdAt,
  updatedAt: createdAt,
})

function renderCard(plan: Partial<MessagePlanPart>, overrides: Partial<PlanCardProps> = {}) {
  const props: PlanCardProps = {
    plan: { type: 'plan', planText: '1. Find\n2. Update\n3. Log', status: 'pending', ...plan },
    sessionId: 's1',
    generating: false,
    touchesFiles: false,
    onRun: vi.fn(async () => {}),
    onRequestChanges: vi.fn(async () => {}),
    onReject: vi.fn(async () => {}),
    onStop: vi.fn(),
    onContinue: vi.fn(async () => {}),
    ...overrides,
  }
  const view = render(<PlanCard {...props} />)
  return { ...view, props }
}

describe('PlanCard proposed', () => {
  it('shows the head, chips, actions and key hint', () => {
    renderCard({}, { touchesFiles: true })
    expect(screen.getByText('Proposed plan')).toBeTruthy()
    expect(screen.getByText('3 steps')).toBeTruthy()
    expect(screen.getByText('edits files · asks before applying').className).toContain('dg-chip--blue')
    expect(screen.getByRole('button', { name: 'Run plan' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy()
    expect(screen.getByText('↵ run · E change · Esc reject')).toBeTruthy()
    expect(screen.getByText('Find')).toBeTruthy()
  })

  it('hides the files chip when the plan touches no files', () => {
    renderCard({})
    expect(screen.queryByText('edits files · asks before applying')).toBeNull()
  })

  it('a single step reads "1 step"', () => {
    renderCard({ planText: '1. Find' })
    expect(screen.getByText('1 step')).toBeTruthy()
  })

  it('shows the plan Markdown when no steps parse', () => {
    renderCard({ planText: 'Inspect the issue, then fix it.' })
    expect(screen.getByTestId('markdown').textContent).toBe('Inspect the issue, then fix it.')
  })

  it('renders step text literally', () => {
    renderCard({ planText: '1. Use {{count}} and <0>tags</0> $t(Stop)' })
    expect(screen.getByText('Use {{count}} and <0>tags</0> $t(Stop)')).toBeTruthy()
  })

  it('keys on the focused card: Enter runs, e opens feedback, Escape rejects', async () => {
    const { props } = renderCard({})
    const card = screen.getByRole('region', { name: 'Proposed plan' })
    expect(card.tabIndex).toBe(0)

    fireEvent.keyDown(card, { key: 'Enter' })
    await waitFor(() => expect(props.onRun).toHaveBeenCalledTimes(1))

    fireEvent.keyDown(card, { key: 'e' })
    const field = await screen.findByPlaceholderText('Describe what the revised plan should change')
    expect(document.activeElement).toBe(field)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    const windowEscape = vi.fn()
    window.addEventListener('keydown', windowEscape)
    fireEvent.keyDown(card, { key: 'Escape' })
    window.removeEventListener('keydown', windowEscape)
    await waitFor(() => expect(props.onReject).toHaveBeenCalledTimes(1))
    // Escape stays with the card: window handlers (the workspace panel's) never see it.
    expect(windowEscape).not.toHaveBeenCalled()
    expect(props.onRequestChanges).not.toHaveBeenCalled()
  })

  it('Enter on the focused Reject button calls only onReject (R14)', async () => {
    const { props } = renderCard({})
    const reject = screen.getByRole('button', { name: 'Reject' })
    reject.focus()
    fireEvent.keyDown(reject, { key: 'Enter' })
    fireEvent.click(reject)
    await waitFor(() => expect(props.onReject).toHaveBeenCalledTimes(1))
    expect(props.onRun).not.toHaveBeenCalled()
  })

  it('typing in the feedback field does not trigger card keys', async () => {
    const { props } = renderCard({})
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }))
    const field = screen.getByPlaceholderText('Describe what the revised plan should change')
    fireEvent.keyDown(field, { key: 'e' })
    fireEvent.keyDown(field, { key: 'Enter' })
    fireEvent.change(field, { target: { value: 'Skip step 2' } })
    expect(props.onRun).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Request revised plan' }))
    await waitFor(() => expect(props.onRequestChanges).toHaveBeenCalledWith('Skip step 2'))
  })

  it('shows the error when an action fails and re-enables the buttons', async () => {
    renderCard({}, { onRun: vi.fn(async () => Promise.reject(new Error('No model'))) })
    fireEvent.click(screen.getByRole('button', { name: 'Run plan' }))
    expect(await screen.findByText('No model')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Run plan' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('PlanCard running', () => {
  it('shows progress from tasks, the timer, Stop and the staging note', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    h.tasks = [
      task('old', 'done', 1),
      task('a', 'done', 88_001),
      task('b', 'in-progress', 88_002),
      task('c', 'pending', 88_003),
      task('d', 'pending', 88_004),
    ]
    const { props, container } = renderCard(
      { planText: FOUR, status: 'approved', startedAt: 88_000 },
      { generating: true, touchesFiles: true, latestPlan: true }
    )
    expect(container.querySelector('svg.dg-mascot[data-state="working"]')).toBeTruthy()
    expect(container.querySelector('svg.dg-mascot')?.getAttribute('width')).toBe('20')
    expect(screen.getByText('Running plan · step 2 of 4')).toBeTruthy()
    // A task from before this run started is not part of it.
    expect(screen.queryByText('Task old')).toBeNull()
    expect(screen.getByText('12 s')).toBeTruthy()
    expect(screen.getByText('Task a').closest('li')?.className).toContain('is-done')
    expect(screen.getByText('Task b').closest('li')?.className).toContain('is-current')
    expect(screen.getByText('Edits are staged and arrive in Review as one Change.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Run plan' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(props.onStop).toHaveBeenCalledTimes(1)
    act(() => {
      vi.advanceTimersByTime(3_000)
    })
    expect(screen.getByText('15 s')).toBeTruthy()
  })

  it('marks failed steps', () => {
    h.tasks = [task('a', 'failed', 1), task('b', 'in-progress', 2)]
    renderCard({ planText: FOUR, status: 'approved', startedAt: 1 }, { generating: true, latestPlan: true })
    expect(screen.getByText('Task a').closest('li')?.className).toContain('is-failed')
  })

  it('without tasks reads the parsed steps; no staging note when no files are touched', () => {
    h.tasks = [task('old', 'done', 0)]
    renderCard({ planText: FOUR, status: 'approved', startedAt: 1 }, { generating: true, latestPlan: true })
    expect(screen.getByText('Running plan · step 1 of 4')).toBeTruthy()
    expect(screen.getByText('Find the files')).toBeTruthy()
    expect(screen.queryByText('Edits are staged and arrive in Review as one Change.')).toBeNull()
  })

  it('an older plan card ignores the session tasks (R13); latestPlan defaults to false', () => {
    h.tasks = [task('a', 'done', 1)]
    renderCard({ planText: FOUR, status: 'approved', startedAt: 1 })
    expect(screen.queryByText('Task a')).toBeNull()
    expect(screen.getByText('Plan stopped · 0 of 4 done')).toBeTruthy()
  })
})

describe('PlanCard stopped', () => {
  it('shows how far it got and Continue', async () => {
    h.tasks = [task('a', 'done', 1), task('b', 'pending', 2), task('c', 'pending', 3), task('d', 'pending', 4)]
    const { props } = renderCard({ planText: FOUR, status: 'approved', startedAt: 1 }, { latestPlan: true })
    expect(screen.getByText('Plan stopped · 1 of 4 done')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(props.onContinue).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: 'Run plan' })).toBeNull()
  })

  it('with no steps reads "Plan stopped"', () => {
    renderCard({ planText: 'Inspect the issue, then fix it.', status: 'approved', startedAt: 1 })
    expect(screen.getByText('Plan stopped')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
  })

  it('hides Continue when every step is done', () => {
    h.tasks = [task('a', 'done', 1), task('b', 'done', 2)]
    renderCard({ planText: FOUR, status: 'approved', startedAt: 1 }, { latestPlan: true })
    expect(screen.getByText('Plan stopped · 2 of 2 done')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
  })
})

describe('PlanCard folded', () => {
  it('finished: closed details with count and duration', () => {
    const { container } = renderCard({ planText: FOUR, status: 'approved', startedAt: 1_000, finishedAt: 121_000 })
    const details = container.querySelector('details')
    expect(details).toBeTruthy()
    expect(details?.open).toBe(false)
    expect(details?.querySelector('summary')?.textContent).toBe('Ran plan · 4 steps · 2 m')
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('legacy finished plan omits the duration (R12)', () => {
    const { container } = renderCard({ planText: FOUR, status: 'approved' })
    expect(container.querySelector('summary')?.textContent).toBe('Ran plan · 4 steps')
  })

  it('revised plans fold and lose their actions', () => {
    const { container } = renderCard({ planText: FOUR, status: 'revised', version: 2 })
    const details = container.querySelector('details')
    expect(details?.open).toBe(false)
    expect(details?.querySelector('summary')?.textContent).toBe('Plan v2')
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('rejected: folded with its steps in the body', () => {
    const { container } = renderCard({ planText: FOUR, status: 'rejected' })
    expect(container.querySelector('summary')?.textContent).toBe('Rejected plan')
    expect(container.querySelectorAll('details li')).toHaveLength(4)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
