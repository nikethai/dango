/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDangoMantineTheme } from '@/theme/mantineTheme'
import FolderItem, { type FolderItemProps } from '../session/FolderItem'
import { EverywhereRow } from './EverywhereRow'
import { NewScopeSheet } from './NewScopeSheet'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search: _search,
    children,
    ...rest
  }: {
    to: string
    params?: Record<string, string>
    search?: unknown
    children?: ReactNode
  }) => (
    <a href={to.replace(/\$(\w+)/g, (_m, key: string) => params?.[key] ?? '')} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}))
const translate = vi.hoisted(() => vi.fn((key: string) => key))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => false }))
vi.mock('../project/ProjectMenu', () => ({ projectFolderActions: () => [] }))

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
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

function wrap(node: ReactNode) {
  return <MantineProvider theme={createDangoMantineTheme()}>{node}</MantineProvider>
}

function renderFolder(props: Partial<FolderItemProps> = {}) {
  const handlers = {
    onToggle: vi.fn(),
    onOpen: vi.fn(),
    onOpenSettings: vi.fn(),
    onCreateChat: vi.fn(),
    onDelete: vi.fn(),
  }
  render(
    wrap(
      <FolderItem
        count={2}
        expanded
        name="Acme Co"
        kind="project"
        active={false}
        projectId="p1"
        {...handlers}
        {...props}
      />
    )
  )
  return handlers
}

describe('EverywhereRow', () => {
  it('links to /scope/everywhere with an icon and no menu', () => {
    const { container } = render(wrap(<EverywhereRow active={false} />))
    const link = screen.getByRole('link', { name: 'Everywhere' })
    expect(link.getAttribute('href')).toBe('/scope/everywhere')
    expect(container.querySelector('svg')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Scope options' })).toBeNull()
  })
})

describe('FolderItem as a scope row', () => {
  it('shows the client chip only for client scopes', () => {
    renderFolder({ kind: 'client' })
    expect(screen.getByText('client').className).toContain('dg-chip')
    expect(translate).toHaveBeenCalledWith('client')
    cleanup()
    const { container } = render(
      wrap(
        <FolderItem
          count={0}
          expanded
          name="X"
          kind="project"
          active={false}
          onToggle={vi.fn()}
          onOpen={vi.fn()}
          onOpenSettings={vi.fn()}
        />
      )
    )
    expect(container.querySelector('.dg-chip')).toBeNull()
  })

  it('opens on name click and toggles only on chevron click', () => {
    const h = renderFolder()
    fireEvent.click(screen.getByText('Acme Co'))
    expect(h.onOpen).toHaveBeenCalledTimes(1)
    expect(h.onToggle).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Toggle chats' }))
    expect(h.onToggle).toHaveBeenCalledTimes(1)
    expect(h.onOpen).toHaveBeenCalledTimes(1)
  })

  it('marks the active row', () => {
    const { container } = render(
      wrap(
        <FolderItem
          count={0}
          expanded
          name="X"
          kind="project"
          active
          onToggle={vi.fn()}
          onOpen={vi.fn()}
          onOpenSettings={vi.fn()}
        />
      )
    )
    expect(container.querySelector('.studio-rail-row-active')).not.toBeNull()
  })

  it('has the scope menu items and none of the old ones', async () => {
    renderFolder()
    fireEvent.click(screen.getByRole('button', { name: 'Scope options' }))
    expect(await screen.findByText('Scope settings')).toBeTruthy()
    expect(screen.getAllByText('New chat').length).toBeGreaterThan(0)
    expect(screen.getByText('Delete scope')).toBeTruthy()
    expect(screen.queryByText('Rename Project')).toBeNull()
    expect(screen.queryByText('Set Default Copilot')).toBeNull()
  })
})

describe('NewScopeSheet', () => {
  it('disables Create with an empty name', () => {
    render(wrap(<NewScopeSheet opened onClose={vi.fn()} onCreate={vi.fn()} />))
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('refuses the reserved name', () => {
    render(wrap(<NewScopeSheet opened onClose={vi.fn()} onCreate={vi.fn()} />))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Everywhere' } })
    expect(screen.getByText('Everywhere is built in. Pick another name.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the kind question as visible text', () => {
    render(wrap(<NewScopeSheet opened onClose={vi.fn()} onCreate={vi.fn()} />))
    expect(screen.getByText('Is this a project or a client?')).toBeTruthy()
  })

  it('creates a client scope', () => {
    const onCreate = vi.fn()
    render(wrap(<NewScopeSheet opened onClose={vi.fn()} onCreate={onCreate} />))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acme Co' } })
    fireEvent.click(screen.getByLabelText('Client'))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(onCreate).toHaveBeenCalledWith({ name: 'Acme Co', kind: 'client' })
  })
})
