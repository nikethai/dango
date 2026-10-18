/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import en from '@/i18n/locales/en/translation.json'
import type { Task } from '@/stores/taskStore'
import { TodoAppCard } from './TodoAppCard'

const h = vi.hoisted(() => ({
  tasks: [] as Task[],
  hydrate: vi.fn(async (_sessionId: string) => {}),
  toggle: vi.fn(),
}))

vi.mock('@/stores/taskStore', () => ({
  useTaskStore: (selector: (state: { tasks: Task[]; toggleTaskDone: typeof h.toggle }) => unknown) =>
    selector({ tasks: h.tasks, toggleTaskDone: h.toggle }),
  taskStore: { getState: () => ({ hydrateSessionTasks: h.hydrate }) },
}))

beforeAll(async () => {
  await createInstance()
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
})

afterEach(() => {
  cleanup()
  h.hydrate.mockClear()
  h.toggle.mockClear()
})

describe('TodoAppCard', () => {
  it('hydrates the session tasks on mount so its toggles work after a reload', () => {
    h.tasks = [{ id: 't1', sessionId: 's1', title: 'Find', status: 'pending', createdAt: 1, updatedAt: 1 }]
    render(<TodoAppCard sessionId="s1" snapshot={[{ id: 't1', title: 'Find', status: 'pending' }]} />)
    expect(h.hydrate).toHaveBeenCalledWith('s1')
    fireEvent.click(screen.getByRole('button', { name: 'Mark as done: Find' }))
    expect(h.toggle).toHaveBeenCalledWith('t1')
  })
})
