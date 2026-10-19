/**
 * @vitest-environment jsdom
 */

import type { Scope, SessionMeta } from '@shared/types'
import type { BackgroundJob } from '@shared/types/background'
import { cleanup, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import en from '@/i18n/locales/en/translation.json'

const h = vi.hoisted(() => ({ jobs: [] as BackgroundJob[] }))

vi.mock('@/packages/background', () => ({
  useBackgroundJobs: (scopeId?: string) => h.jobs.filter((j) => scopeId === undefined || j.scopeId === scopeId),
  useBackgroundJobsLoaded: () => true,
  startJob: vi.fn(),
  stopJob: vi.fn(async () => undefined),
  runJobFix: vi.fn(async () => undefined),
}))

import { ScopeOverview } from './ScopeOverview'

beforeAll(async () => {
  await createInstance()
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
})

afterEach(() => {
  cleanup()
  h.jobs = []
})

const scope = { id: 's1', name: 'Acme Co', kind: 'client' } as Scope
const chat = { id: 'c1', name: 'Pricing call', updatedAt: Date.now() - 60_000 } as SessionMeta

function overview(knowledgeCount: number, chats: SessionMeta[] = [chat]) {
  render(
    <ScopeOverview
      scope={scope}
      chats={chats}
      knowledgeCount={knowledgeCount}
      onTabChange={vi.fn()}
      onNewChat={vi.fn()}
      onOpenChat={vi.fn()}
    />
  )
}

describe('ScopeOverview', () => {
  it('says "1 approved item" for one item', () => {
    overview(1)
    expect(screen.getByText('1 approved item')).toBeTruthy()
  })

  it('says "3 approved items" for several', () => {
    overview(3)
    expect(screen.getByText('3 approved items')).toBeTruthy()
  })

  it('section headings use the headline type style', () => {
    overview(1)
    expect(screen.getByRole('heading', { name: 'Recent chats' }).className).toContain('dg-type-headline')
    expect(screen.getByRole('heading', { name: 'Knowledge' }).className).toContain('dg-type-headline')
  })

  it('R12: with nothing known yet, a running job shows Background work above EM1', () => {
    h.jobs = [
      { id: 'j1', scopeId: 's1', kind: 'sync', label: 'Folder sync', status: 'running', attempts: 0, startedAt: 1 },
    ]
    overview(0, [])
    const work = screen.getByRole('heading', { name: 'Background work' })
    const em1 = screen.getByText('Nothing known about Acme Co yet')
    expect(work.compareDocumentPosition(em1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('R12: with no jobs, EM1 is unchanged and Background work shows nothing', () => {
    overview(0, [])
    expect(screen.queryByRole('heading', { name: 'Background work' })).toBeNull()
    expect(screen.getByText('Nothing known about Acme Co yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start a chat' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add a source' })).toBeTruthy()
  })
})
