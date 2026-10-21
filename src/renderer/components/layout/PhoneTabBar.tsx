import { Link, useLocation } from '@tanstack/react-router'
import { Inbox, Layers, type LucideIcon, MessageCircle, Settings } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLayoutMode } from '@/hooks/useLayoutMode'
import { useReviewWaitingCount } from '@/packages/review/hooks'
import { useSessionList } from '@/stores/chatStore'

export type PhoneTabId = 'review' | 'chat' | 'scopes' | 'settings'

/**
 * The phone tab bar's tabs (RS3), in order. Labels are English i18n keys. Chat's `to` is the fallback: the bar sends it
 * to the last open session when there is one.
 */
export const PHONE_TABS: ReadonlyArray<{
  id: PhoneTabId
  label: string
  to: string
  match: (pathname: string) => boolean
}> = [
  { id: 'review', label: 'Review', to: '/', match: (p) => p === '/' },
  { id: 'chat', label: 'Chat', to: '/new', match: (p) => p.startsWith('/session/') || p === '/new' },
  { id: 'scopes', label: 'Scopes', to: '/scopes', match: (p) => p === '/scopes' || p.startsWith('/scope/') },
  { id: 'settings', label: 'Settings', to: '/settings', match: (p) => p === '/settings' || p.startsWith('/settings/') },
]

const ICONS: Record<PhoneTabId, LucideIcon> = {
  review: Inbox,
  chat: MessageCircle,
  scopes: Layers,
  settings: Settings,
}

// The chat this window showed last. Quick Chat also writes the shared currentSessionIdAtom (localStorage, synced across
// windows), so the Chat tab follows this window's own /session/ visits instead. It is seeded once, at startup, from the
// stored id (what the window reopens with), read the same way __root's startup redirect reads it.
let lastChatId: string | null | undefined

function seedLastChatId(): string | null {
  if (lastChatId === undefined) {
    try {
      const stored = JSON.parse(localStorage.getItem('_currentSessionIdCachedAtom') || 'null') as unknown
      lastChatId = typeof stored === 'string' && stored ? stored : null
    } catch {
      lastChatId = null
    }
  }
  return lastChatId
}

const SESSION_PATH = /^\/session\/([^/]+)/

/** Bottom tabs at phone width (< 760 px); renders nothing at medium and wide, where the sidebar or rail navigates. */
export function PhoneTabBar() {
  const { t } = useTranslation()
  const mode = useLayoutMode()
  const pathname = useLocation({ select: (l) => l.pathname })
  const waiting = useReviewWaitingCount()
  const [chatId, setChatId] = useState(seedLastChatId)
  const { sessionMetaList } = useSessionList()

  useEffect(() => {
    const id = SESSION_PATH.exec(pathname)?.[1]
    if (id) {
      lastChatId = id
      setChatId(id)
    }
  }, [pathname])

  // A deleted chat falls back to /new (the list is unknown until loaded).
  const lastSessionId = chatId && (!sessionMetaList || sessionMetaList.some((m) => m.id === chatId)) ? chatId : null

  if (mode !== 'phone') return null

  return (
    <nav className="dg-tabbar" aria-label={t('Main')}>
      {PHONE_TABS.map((tab) => {
        const Icon = ICONS[tab.id]
        const current = tab.match(pathname)
        // The accessible name carries the count, so the visible badge is hidden from screen readers.
        const badge = tab.id === 'review' && waiting > 0
        const linkProps =
          tab.id === 'chat' && lastSessionId
            ? ({ to: '/session/$sessionId', params: { sessionId: lastSessionId } } as const)
            : ({ to: tab.to } as { to: '/' })
        return (
          <Link
            key={tab.id}
            {...linkProps}
            className="dg-tabbar__tab"
            aria-current={current ? 'page' : undefined}
            aria-label={badge ? t('Review, {{count}} waiting', { count: waiting }) : undefined}
          >
            <span className="dg-tabbar__icon">
              <Icon size={18} strokeWidth={1.8} aria-hidden />
              {badge && (
                <span className="dg-badge" aria-hidden="true">
                  {waiting > 99 ? '99+' : waiting}
                </span>
              )}
            </span>
            <span className="dg-type-caption">{t(tab.label)}</span>
          </Link>
        )
      })}
    </nav>
  )
}

export default PhoneTabBar
