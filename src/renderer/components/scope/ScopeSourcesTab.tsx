import type { Scope } from '@shared/types'
import { useTranslation } from 'react-i18next'
import { ScopeEmpty } from './ScopeEmpty'

/** Placeholder: slice 7 owns the body. */
export function ScopeSourcesTab({ scope }: { scope: Scope }) {
  const { t } = useTranslation()
  return (
    <ScopeEmpty
      text={t(
        'Folders, Gmail, Asana and documents connected to {{name}} will appear here. Dango reads only the sources you connect.',
        { name: scope.name }
      )}
    />
  )
}
