/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ReviewEntry } from '@shared/types/review'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reviewStore, setReviewStorageForTests } from '@/packages/review/store'
import { SidebarReviewRow } from './SidebarReviewRow'

const navigate = vi.hoisted(() => vi.fn())
const pathname = vi.hoisted(() => ({ value: '/settings' }))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ pathname: pathname.value }),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(opts?.[k] ?? '')),
  }),
}))

let data: Record<string, unknown>
const row = (i: number, over: Partial<ReviewEntry> = {}): ReviewEntry => ({
  id: `r${i}`,
  kind: 'change',
  scopeId: 's',
  text: 't',
  ref: { type: 'change', id: `c${i}` },
  state: 'open',
  createdAt: 1000 + i,
  ...over,
})
const seed = (entries: ReviewEntry[]) => {
  data['review-entries'] = { entries }
}

beforeEach(() => {
  data = {}
  navigate.mockReset()
  pathname.value = '/settings'
  setReviewStorageForTests({
    getItem: <T,>(k: string, fb: T) => Promise.resolve(k in data ? (JSON.parse(JSON.stringify(data[k])) as T) : fb),
    setItemNow: vi.fn((k: string, v: unknown) => {
      data[k] = JSON.parse(JSON.stringify(v))
      return Promise.resolve()
    }),
  })
  reviewStore.setState({ entries: [], lastCheckedAt: undefined, loaded: false })
})
afterEach(() => {
  cleanup()
  setReviewStorageForTests(null)
})

describe('SidebarReviewRow', () => {
  it('shows no badge and the plain name with nothing waiting', async () => {
    render(<SidebarReviewRow variant="expanded" onNavigate={() => {}} />)
    await waitFor(() => expect(reviewStore.getState().loaded).toBe(true))
    expect(screen.getByRole('button', { name: 'Review' })).toBeTruthy()
    expect(document.querySelector('.dg-badge')).toBeNull()
  })

  it('counts open proposals, needs-you, conflicts and changes but not done rows', async () => {
    seed([
      row(1, { kind: 'proposal', ref: { type: 'proposal', id: 'p1' } }),
      row(2, { kind: 'proposal', ref: { type: 'proposal', id: 'p2' } }),
      row(3, { kind: 'needs-you', ref: { type: 'question', id: 'n1' } }),
      row(4, { kind: 'conflict', ref: { type: 'conflict', id: 'x1' } }),
      row(5),
      row(6, { state: 'done' }),
    ])
    render(<SidebarReviewRow variant="expanded" onNavigate={() => {}} />)
    const btn = await screen.findByRole('button', { name: 'Review, 4 waiting' })
    const badge = btn.querySelector('.dg-badge') as HTMLElement
    expect(badge.textContent).toBe('4')
    expect(badge.getAttribute('aria-hidden')).toBe('true')
  })

  it('reads 99+ above 99', async () => {
    seed(Array.from({ length: 120 }, (_v, i) => row(i, { kind: 'proposal', ref: { type: 'proposal', id: `p${i}` } })))
    render(<SidebarReviewRow variant="expanded" onNavigate={() => {}} />)
    await screen.findByRole('button', { name: 'Review, 120 waiting' })
    expect(document.querySelector('.dg-badge')?.textContent).toBe('99+')
  })

  it('is the current page at /', () => {
    pathname.value = '/'
    render(<SidebarReviewRow variant="rail" onNavigate={() => {}} />)
    const btn = screen.getByRole('button', { name: 'Review' })
    expect(btn.getAttribute('aria-current')).toBe('page')
    expect(btn.className).toContain('studio-rail-row-active')
  })

  it('is not current elsewhere', () => {
    render(<SidebarReviewRow variant="expanded" onNavigate={() => {}} />)
    expect(screen.getByRole('button', { name: 'Review' }).getAttribute('aria-current')).toBeNull()
  })

  it('navigates to / and calls onNavigate on click', () => {
    const onNavigate = vi.fn()
    render(<SidebarReviewRow variant="expanded" onNavigate={onNavigate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(navigate).toHaveBeenCalledWith({ to: '/' })
    expect(onNavigate).toHaveBeenCalled()
  })

  it('rail variant is an icon button and its badge is absolutely positioned inside the rail', () => {
    render(<SidebarReviewRow variant="rail" onNavigate={() => {}} />)
    expect(screen.getByRole('button', { name: 'Review' }).className).toContain('rail-icon-btn')
    const css = readFileSync(resolve(__dirname, '../../static/globals.css'), 'utf8')
    const rule = css.match(/\.rail-icon-btn \.dg-badge\s*\{([^}]*)\}/)
    expect(rule?.[1]).toMatch(/position:\s*absolute/)
  })
})
