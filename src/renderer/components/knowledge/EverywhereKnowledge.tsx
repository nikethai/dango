import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useKnowledgeList } from '@/packages/knowledge/hooks'
import { AddKnowledgeForm } from './AddKnowledgeForm'
import { KnowledgeRows } from './KnowledgeRows'

/** EV1: the Everywhere list for one section. Preferences hold `preference`; Facts hold `fact` and `decision`. */
export function EverywhereKnowledge({ section }: { section: 'preferences' | 'facts' }) {
  const { t } = useTranslation()
  const [adding, setAdding] = useState(false)
  const items = useKnowledgeList(EVERYWHERE_SCOPE_ID, {
    kind: section === 'preferences' ? ['preference'] : ['fact', 'decision'],
  })

  return (
    <div className="dg flex flex-col gap-2">
      {items.length === 0 ? (
        section === 'facts' ? (
          <p style={{ margin: 0 }}>{t('Facts you apply to all scopes will appear here.')}</p>
        ) : null
      ) : (
        <KnowledgeRows items={items} />
      )}
      {adding ? (
        <AddKnowledgeForm
          scopeId={EVERYWHERE_SCOPE_ID}
          defaultKind={section === 'preferences' ? 'preference' : 'fact'}
          onDone={() => setAdding(false)}
        />
      ) : (
        <div>
          <button type="button" className="dg-btn dg-btn--ghost" onClick={() => setAdding(true)}>
            {t('Add knowledge')}
          </button>
        </div>
      )}
    </div>
  )
}
