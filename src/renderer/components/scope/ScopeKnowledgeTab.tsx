import type { Scope } from '@shared/types'
import { useTranslation } from 'react-i18next'
import { ScopeEmpty } from './ScopeEmpty'

/** Placeholder: slice 4 owns the body. */
export function ScopeKnowledgeTab({ scope }: { scope: Scope }) {
  const { t } = useTranslation()
  return (
    <ScopeEmpty
      text={t(
        'Facts, decisions and preferences you approve for {{name}} will appear here, each with its sources and history.',
        {
          name: scope.name,
        }
      )}
    />
  )
}
