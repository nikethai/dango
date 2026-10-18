import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isRedirect } from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import { Route } from '@/routes/index'

// The route module is imported in node; its components pull in storage (localStorage).
vi.mock('@/components/review/ReviewHome', () => ({ ReviewHome: () => null }))
vi.mock('@/components/layout/Page', () => ({ default: () => null }))

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')

describe('/ is Review', () => {
  const beforeLoad = Route.options.beforeLoad as (ctx: unknown) => void
  it('renders ReviewHome', () => {
    expect(src('routes/index.tsx')).toContain('ReviewHome')
  })
  it('redirects old copilotId links to /new', () => {
    let thrown: unknown
    try {
      beforeLoad({ search: { copilotId: 'c1' } })
    } catch (e) {
      thrown = e
    }
    expect(isRedirect(thrown)).toBe(true)
    expect((thrown as { options: unknown }).options).toMatchObject({
      to: '/new',
      search: { copilotId: 'c1' },
      replace: true,
    })
  })
  it('does not redirect without copilotId', () => {
    expect(() => beforeLoad({ search: {} })).not.toThrow()
  })
})

describe('/new wiring', () => {
  it('new route seeds the session and passes projectId', () => {
    const t = src('routes/new.tsx')
    expect(t).toContain("createFileRoute('/new')")
    expect(t).toContain('seedDraftFromLink(')
    expect(t).toContain('projectId: session.projectId')
  })
  it('new route remounts the composer when a new prefill arrives', () => {
    expect(src('routes/new.tsx')).toContain('isNewPrefill(lastPrefill.current, prefill)')
  })
  it('route tree has /new', () => {
    expect(src('routeTree.gen.ts')).toContain("path: '/new'")
  })
  it('sidebar and shortcut use startNewChat', () => {
    for (const f of ['Sidebar.tsx', 'hooks/useShortcut.tsx']) {
      const t = src(f)
      expect(t).toContain('startNewChat(')
      expect(t).not.toContain("to: '/'")
      expect(t).not.toContain('to: `/`')
    }
  })
  it('copilots navigates to /new', () => {
    expect(src('components/settings/agents/AgentsSettings.tsx')).toContain("to: '/new'")
  })
})
