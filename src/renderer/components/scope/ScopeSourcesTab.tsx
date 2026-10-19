import type { Scope } from '@shared/types'
import { useTranslation } from 'react-i18next'
import { openAddSourceSheet } from '@/components/sources/AddSourceSheet'
import { BackgroundWork } from '@/components/sources/BackgroundWork'
import { focusSourceRow, SourceRow, useHiddenSourceIds } from '@/components/sources/SourceRow'
import { useSources, useSourcesLoaded } from '@/packages/sources'
import { ScopeEmpty } from './ScopeEmpty'

/**
 * The scope's Sources tab: its connected sources (a source waiting out its 5 s undo is left out), "Add a source…" with
 * this scope preselected, and Background work. Empty: "No sources yet.".
 */
export function ScopeSourcesTab({ scope }: { scope: Scope }) {
  const { t } = useTranslation()
  const loaded = useSourcesLoaded()
  const hidden = useHiddenSourceIds()
  const sources = useSources({ scopeId: scope.id }).filter((s) => !hidden.has(s.id))

  const add = async () => {
    const result = await openAddSourceSheet({ scopeId: scope.id })
    if (result) focusSourceRow(result.sourceId)
  }
  const addButton = (
    <button type="button" className="dg-btn dg-btn--primary" onClick={() => void add()}>
      {t('Add a source…')}
    </button>
  )

  return (
    <div className="flex flex-col gap-6 py-4">
      {!loaded ? null : sources.length === 0 ? (
        <ScopeEmpty
          heading={t('No sources yet.')}
          text={t(
            'Folders, Gmail, Asana and documents connected to {{name}} will appear here. Dango reads only the sources you connect.',
            { name: scope.name }
          )}
        >
          {addButton}
        </ScopeEmpty>
      ) : (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col gap-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {sources.map((source) => (
              <SourceRow key={source.id} source={source} scopeName={scope.name} />
            ))}
          </ul>
          <div>{addButton}</div>
        </div>
      )}
      <BackgroundWork scopeId={scope.id} />
    </div>
  )
}
