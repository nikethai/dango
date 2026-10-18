import type { Scope, SessionMeta } from '@shared/types'
import { useTranslation } from 'react-i18next'
import { formatRailRelativeTime } from '../session/session-list-helpers'
import { ScopeEmpty } from './ScopeEmpty'

export function ChatRows({ chats, onOpenChat }: { chats: SessionMeta[]; onOpenChat(id: string): void }) {
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {chats.map((chat) => (
        <li key={chat.id}>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 py-2"
            style={{
              border: 0,
              background: 'transparent',
              font: 'inherit',
              color: 'inherit',
              cursor: 'pointer',
              textAlign: 'left',
            }}
            onClick={() => onOpenChat(chat.id)}
          >
            <span className="truncate">{chat.name}</span>
            <span className="dg-type-caption" style={{ color: 'var(--dango-muted)' }}>
              {formatRailRelativeTime(chat.updatedAt)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function ScopeChatsTab(props: {
  scope: Scope
  chats: SessionMeta[]
  onNewChat(): void
  onOpenChat(id: string): void
}) {
  const { t } = useTranslation()
  if (props.chats.length === 0) {
    return (
      <ScopeEmpty text={t('No chats in {{name}} yet.', { name: props.scope.name })}>
        <button type="button" className="dg-btn dg-btn--primary" onClick={props.onNewChat}>
          {t('New chat')}
        </button>
      </ScopeEmpty>
    )
  }
  const sorted = [...props.chats].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  return <ChatRows chats={sorted} onOpenChat={props.onOpenChat} />
}
