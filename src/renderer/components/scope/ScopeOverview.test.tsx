/**
 * @vitest-environment jsdom
 */

import type { Scope, SessionMeta } from '@shared/types'
import { cleanup, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import en from '@/i18n/locales/en/translation.json'
import { ScopeOverview } from './ScopeOverview'

beforeAll(async () => {
  await createInstance()
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
})

afterEach(cleanup)

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
})
