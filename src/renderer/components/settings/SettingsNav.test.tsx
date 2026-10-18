/**
 * @vitest-environment jsdom
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsNav } from './SettingsNav'
import { SettingsTabs } from './SettingsTabs'
import { buildSettingsNav, findSettingsEntry } from './settingsNavModel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

const nav = buildSettingsNav({ agents: true, mcp: true, knowledgeBase: true, hotkeys: true, devTools: true })

afterEach(cleanup)

describe('SettingsNav', () => {
  it('lists the five sections in order and marks the current one', () => {
    render(<SettingsNav nav={nav} pathname="/settings/provider" compact={false} />)
    const names = ['Models and keys', 'Sources', 'Memory and privacy', 'Voice', 'General']
    const links = screen.getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual(names)
    expect(screen.getByRole('link', { name: 'Models and keys' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Sources' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('button', { name: 'Advanced' }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('link', { name: 'Usage' })).toBeNull()
  })

  it('keeps the full label readable when a long row is truncated', () => {
    render(<SettingsNav nav={nav} pathname="/settings/hooks" compact={false} />)
    const label = screen.getByText('Skills · Commands · Hooks')
    expect(label.getAttribute('title')).toBe('Skills · Commands · Hooks')
  })

  it('opens Advanced on a deep link into it', () => {
    render(<SettingsNav nav={nav} pathname="/settings/hooks" compact={false} />)
    expect(screen.getByRole('button', { name: 'Advanced' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('link', { name: 'Skills · Commands · Hooks' }).getAttribute('aria-current')).toBe('page')
  })

  it('toggles Advanced and links Image studio out of settings', () => {
    render(<SettingsNav nav={nav} pathname="/settings/provider" compact={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    expect(screen.getByRole('link', { name: 'Usage' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Image studio' }).getAttribute('href')).toBe('/image-creator')
  })

  it('points aria-controls at the Advanced list and keeps a manual collapse', () => {
    render(<SettingsNav nav={nav} pathname="/settings/usage" compact={false} />)
    const button = screen.getByRole('button', { name: 'Advanced' })
    const id = button.getAttribute('aria-controls')
    expect(id).toBeTruthy()
    expect(document.getElementById(id as string)?.contains(screen.getByRole('link', { name: 'Usage' }))).toBe(true)
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('navigation', { name: 'Settings' })).toBeTruthy()
  })

  it('opens Advanced when navigation lands inside it', () => {
    const { rerender } = render(<SettingsNav nav={nav} pathname="/settings/provider" compact={false} />)
    rerender(<SettingsNav nav={nav} pathname="/settings/usage" compact={false} />)
    expect(screen.getByRole('button', { name: 'Advanced' }).getAttribute('aria-expanded')).toBe('true')
  })
})

describe('SettingsTabs', () => {
  it('renders one link per page with the current one marked', () => {
    const found = findSettingsEntry(nav, '/settings/hooks')
    if (!found) throw new Error('hooks entry missing')
    render(<SettingsTabs entry={found.entry} pathname="/settings/hooks" />)
    expect(screen.getAllByRole('link')).toHaveLength(3)
    expect(screen.getByRole('link', { name: 'Hooks' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Skills' }).getAttribute('aria-current')).toBeNull()
  })

  it('renders nothing for a single page', () => {
    const voice = nav.sections.find((e) => e.id === 'voice')
    if (!voice) throw new Error('voice entry missing')
    const { container } = render(<SettingsTabs entry={voice} pathname="/settings/voice" />)
    expect(container.innerHTML).toBe('')
  })
})

describe('settings route source', () => {
  it('no longer carries the hard-coded ITEMS list', () => {
    const src = readFileSync(resolve(__dirname, '../../routes/settings/route.tsx'), 'utf8')
    expect(src).not.toContain('const ITEMS')
  })
})
