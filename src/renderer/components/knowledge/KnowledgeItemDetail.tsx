import type { KnowledgeEvent, KnowledgeItem } from '@shared/types/knowledge'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useKnowledgeUses } from '@/packages/knowledge/hooks'
import { scopeName } from '@/packages/knowledge/scopes'

/** KN2: where an item came from, where it applies, what happened to it, and the chats that used it. */
export function KnowledgeItemDetail({ item }: { item: KnowledgeItem }) {
  const { t } = useTranslation()
  const uses = useKnowledgeUses(item.id).filter((u) => u.ref.type === 'chat')
  const by: Record<KnowledgeEvent['by'], string> = {
    user: t('You'),
    'background-review': t('Background review'),
    chat: t('Chat'),
    migration: t('Migration'),
  }
  const everywhere = item.scopeId === EVERYWHERE_SCOPE_ID
  const applies = everywhere
    ? [t('All scopes'), ...(item.kind === 'preference' ? [] : [t('Client scopes read it unless turned off')])]
    : [scopeName(item.scopeId), ...(item.condition ? [t('When {{condition}}', { condition: item.condition })] : [])]

  const heading = (text: string) => (
    <h4 className="dg-type-callout" style={{ margin: 0, fontWeight: 600 }}>
      {text}
    </h4>
  )
  const list = { listStyle: 'none', margin: 0, padding: 0 } as const

  return (
    <div className="dg flex flex-col gap-3 dg-type-body" style={{ paddingTop: 'var(--dango-space-2)' }}>
      <section className="flex flex-col gap-1">
        {heading(t('Sources'))}
        <ul style={list}>
          {item.sources.map((s) => (
            <li key={s.id}>{s.removed ? t('{{label}} (source removed)', { label: s.label }) : s.label}</li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-1">
        {heading(t('Applies to'))}
        <ul style={list}>
          {applies.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-1">
        {heading(t('History'))}
        <ul style={list}>
          {item.history.map((e, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: events are append-only and have no id
            <li key={i}>
              {[new Date(e.at).toLocaleDateString(), by[e.by], e.action].join(' · ')}
              {e.note ? <span className="dg-item__meta"> {e.note}</span> : null}
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-1">
        {heading(t('Used in chats'))}
        {uses.length === 0 ? (
          <span className="dg-item__meta">{t('No chats yet')}</span>
        ) : (
          <ul style={list}>
            {uses.map((u) => (
              <li key={`${u.ref.id}:${u.at}`}>
                <Link to="/session/$sessionId" params={{ sessionId: u.ref.id }} className="dg-link">
                  {u.ref.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
