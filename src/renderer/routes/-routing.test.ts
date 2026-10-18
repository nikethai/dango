import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isRedirect } from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import { Route } from '@/routes/index'

// The route module is imported in node; its components pull in storage (localStorage).
vi.mock('@/components/review/ReviewHome', () => ({ ReviewHome: () => null }))
vi.mock('@/components/layout/Page', () => ({ default: () => null }))

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')

describe('default question opener', () => {
  it('is registered once at app init next to initKnowledge, not by ReviewHome (M3)', () => {
    const root = src('routes/__root.tsx')
    expect(root).toMatch(/initKnowledge\(\)[\s\S]{0,200}registerDefaultQuestionOpener\(\)/)
    expect(src('components/review/ReviewHome.tsx')).not.toContain('registerReviewOpener')
  })
})

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
  it('validateSearch is lenient', () => {
    const validate = Route.options.validateSearch as unknown as { parse?: unknown } | ((s: unknown) => unknown)
    const run = (s: unknown) =>
      (typeof validate === 'function' ? validate(s) : (validate as { parse: (x: unknown) => unknown }).parse(s)) as {
        scope?: string
        copilotId?: string
      }
    expect(run({ scope: 5 }).scope).toBe('5')
    expect(run({ scope: { a: 1 }, copilotId: [1] })).toEqual({})
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
