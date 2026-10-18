import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useKnowledgeList } from '@/packages/knowledge/hooks'
import { AddKnowledgeForm } from './AddKnowledgeForm'
import { KnowledgeRows } from './KnowledgeRows'

type Filter = 'all' | 'fact' | 'decision' | 'superseded'
const FILTERS: Filter[] = ['all', 'fact', 'decision', 'superseded']

/** KN1: a scope's knowledge, searchable and filterable, newest first. */
export function KnowledgeTab({ scopeId }: { scopeId: string }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [adding, setAdding] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  const items = useKnowledgeList(scopeId, {
    status: filter === 'superseded' ? ['superseded', 'removed'] : ['approved'],
    ...(filter === 'fact' || filter === 'decision' ? { kind: [filter] } : {}),
    query,
  })
  const label: Record<Filter, string> = {
    all: t('All'),
    fact: t('Facts'),
    decision: t('Decisions'),
    superseded: t('Superseded'),
  }

  return (
    <div className="dg flex flex-col gap-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={search}
          type="search"
          aria-label={t('Search knowledge')}
          placeholder={t('Search knowledge')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="dango-field"
          style={{ flex: 1, minWidth: 160, width: 'auto' }}
        />
        <button type="button" className="dg-btn" onClick={() => setAdding(true)} disabled={adding}>
          {t('Add knowledge')}
        </button>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('Filter')}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={f === filter ? 'dg-chip dg-chip--blue' : 'dg-chip'}
            aria-pressed={f === filter}
            onClick={() => setFilter(f)}
          >
            {label[f]}
          </button>
        ))}
      </div>
      {adding ? <AddKnowledgeForm scopeId={scopeId} onDone={() => setAdding(false)} /> : null}
      {items.length === 0 ? (
        <p className="dg-type-body" style={{ margin: 0, color: 'var(--dango-muted)' }}>
          {query.trim() ? t('Nothing matches that search.') : t('No knowledge yet')}
        </p>
      ) : (
        <KnowledgeRows items={items} onNoneLeft={() => search.current?.focus()} />
      )}
    </div>
  )
}
