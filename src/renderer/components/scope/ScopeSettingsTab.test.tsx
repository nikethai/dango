/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import type { Scope } from '@shared/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { patchScope } from '@/projects/scope-store'
import { createDangoMantineTheme } from '@/theme/mantineTheme'
import { ScopeSettingsTab } from './ScopeSettingsTab'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars?.[name] ?? '')),
  }),
}))

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const client = { id: 's1', name: 'Acme Co', kind: 'client', order: 0 } as Scope
const project = {
  id: 's2',
  name: 'Dango app',
  kind: 'project',
  order: 1,
  readsEverywhere: { facts: true, documents: true },
} as Scope

function setup(scope: Scope, extra: { onChange?: (patch: object) => void; onDelete?: () => void } = {}) {
  const props = {
    scope,
    agentOptions: [
      { value: 'none', label: 'None' },
      { value: 'a1', label: 'Researcher' },
    ],
    onChange: extra.onChange ?? vi.fn(),
    onDelete: extra.onDelete ?? vi.fn(),
  }
  const ui = (s: Scope) => (
    <MantineProvider theme={createDangoMantineTheme()}>
      <ScopeSettingsTab {...props} scope={s} />
    </MantineProvider>
  )
  const view = render(ui(scope))
  return { ...view, rerenderScope: (s: Scope) => view.rerender(ui(s)), props }
}

const sw = (name: string) => screen.getByRole('switch', { name: new RegExp(name) })

describe('ScopeSettingsTab', () => {
  it('client defaults', () => {
    setup(client)
    expect(sw('Preferences').getAttribute('aria-checked')).toBe('true')
    expect((sw('Preferences') as HTMLButtonElement).disabled).toBe(true)
    expect(sw('Facts').getAttribute('aria-checked')).toBe('true')
    expect(sw('Documents').getAttribute('aria-checked')).toBe('false')
  })

  it('toggling documents stores both switches', () => {
    const onChange = vi.fn()
    setup(client, { onChange })
    fireEvent.click(sw('Documents'))
    expect(onChange).toHaveBeenCalledWith({ readsEverywhere: { facts: true, documents: true } })
  })

  it('project defaults', () => {
    setup(project)
    expect(sw('Facts').getAttribute('aria-checked')).toBe('true')
    expect(sw('Documents').getAttribute('aria-checked')).toBe('true')
  })

  it('kind change', () => {
    const onChange = vi.fn()
    const { rerenderScope } = setup(project, { onChange })
    expect(sw('Documents').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByText('Client'))
    expect(onChange).toHaveBeenCalledWith({ kind: 'client' })
    rerenderScope(patchScope([project], 's2', { kind: 'client' })[0])
    expect(sw('Documents').getAttribute('aria-checked')).toBe('false')
  })

  it('labels the kind control with visible text', () => {
    setup(client)
    expect(screen.getByText('Is this a project or a client?')).toBeTruthy()
  })

  it('empty name reverts on blur', () => {
    const onChange = vi.fn()
    setup(client, { onChange })
    const input = screen.getByLabelText('Name') as HTMLInputElement
    fireEvent.change(input, { target: { value: '  ' } })
    fireEvent.blur(input)
    expect(input.value).toBe('Acme Co')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('precedence note', () => {
    setup(client)
    expect(screen.getByText('When this scope and Everywhere disagree, this scope wins here.')).toBeTruthy()
  })

  it('reserved name', () => {
    const onChange = vi.fn()
    setup(client, { onChange })
    const input = screen.getByLabelText('Name')
    fireEvent.change(input, { target: { value: 'everywhere' } })
    fireEvent.blur(input)
    expect(screen.getByText('Everywhere is built in. Pick another name.')).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('saves a new name on blur and Enter', () => {
    const onChange = vi.fn()
    setup(client, { onChange })
    const input = screen.getByLabelText('Name')
    fireEvent.change(input, { target: { value: 'Acme Inc' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledWith({ name: 'Acme Inc' })
    fireEvent.change(input, { target: { value: 'Acme Ltd' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith({ name: 'Acme Ltd' })
  })

  it('delete asks first', () => {
    const onDelete = vi.fn()
    setup(client, { onDelete })
    fireEvent.click(screen.getByRole('button', { name: 'Delete scope' }))
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.getByText('Delete Acme Co?')).toBeTruthy()
    expect(screen.getByText('Its chats move to Recents. You can undo for 5 seconds.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Delete Acme Co?')).toBeNull()
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete scope' }))
    const buttons = screen.getAllByRole('button', { name: 'Delete scope' })
    fireEvent.click(buttons[buttons.length - 1])
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})
