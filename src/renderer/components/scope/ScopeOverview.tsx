import type { Scope, SessionMeta } from '@shared/types'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { ChatRows } from './ScopeChatsTab'
import { ScopeEmpty } from './ScopeEmpty'
import type { ScopeTab } from './ScopePage'

const linkStyle = {
  border: 0,
  background: 'transparent',
  font: 'inherit',
  color: 'var(--dango-green-text)',
  cursor: 'pointer',
  padding: 0,
} as const

export function ScopeOverview(props: {
  scope: Scope
  chats: SessionMeta[]
  knowledgeCount: number
  onTabChange(tab: ScopeTab): void
  onNewChat(): void
  onOpenChat(id: string): void
}) {
  const { t } = useTranslation()
  const recentId = useId()
  const knowledgeId = useId()
  const { scope, chats, knowledgeCount } = props
  if (knowledgeCount === 0 && chats.length === 0) {
    return (
      <ScopeEmpty
        heading={t('Nothing known about {{name}} yet', { name: scope.name })}
        text={t(
          'Dango learns from the chats you have here and the sources you connect. Knowledge you approve shows up on this page.'
        )}
      >
        <button type="button" className="dg-btn dg-btn--primary" onClick={props.onNewChat}>
          {t('Start a chat')}
        </button>
        <button type="button" className="dg-btn" onClick={() => props.onTabChange('sources')}>
          {t('Add a source')}
        </button>
      </ScopeEmpty>
    )
  }
  const recent = [...chats].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, 5)
  return (
    <div className="flex flex-col gap-6 py-4">
      <section aria-labelledby={recentId}>
        <div className="flex items-baseline justify-between">
          <h2 id={recentId} className="dg-type-headline">
            {t('Recent chats')}
          </h2>
          <button
            type="button"
            className="dg-type-callout"
            style={linkStyle}
            onClick={() => props.onTabChange('chats')}
          >
            {t('All chats')}
          </button>
        </div>
        <ChatRows chats={recent} onOpenChat={props.onOpenChat} />
      </section>
      <section aria-labelledby={knowledgeId}>
        <div className="flex items-baseline justify-between">
          <h2 id={knowledgeId} className="dg-type-headline">
            {t('Knowledge')}
          </h2>
          <button
            type="button"
            className="dg-type-callout"
            style={linkStyle}
            onClick={() => props.onTabChange('knowledge')}
          >
            {t('Open knowledge')}
          </button>
        </div>
        <p style={{ margin: '8px 0 0', color: 'var(--dango-muted)' }}>
          {knowledgeCount === 0 ? t('No knowledge yet') : t('{{count}} approved items', { count: knowledgeCount })}
        </p>
      </section>
    </div>
  )
}
