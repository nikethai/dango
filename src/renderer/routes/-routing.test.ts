import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isRedirect } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { Route } from '@/routes/index'

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')

describe('/ redirect', () => {
  it('redirects to /new keeping the search', () => {
    const beforeLoad = Route.options.beforeLoad as (ctx: unknown) => void
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
    expect(src('routes/copilots.tsx')).toContain("to: '/new'")
  })
})
