import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import type { ConnectedSource } from '@shared/types/sources'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useScopes } from '@/hooks/useScopes'
import { useSources, useSourcesLoaded } from '@/packages/sources'
import { openAddSourceSheet } from './AddSourceSheet'
import { SourceRow, useHiddenSourceIds } from './SourceRow'

type Group = { scopeId: string; name: string; sources: ConnectedSource[] }

/** Opens the sheet with no scope; the new source's row gets focus once it is listed. */
async function addSource(): Promise<void> {
  const result = await openAddSourceSheet({})
  if (!result) return
  requestAnimationFrame(() => {
    const row = Array.from(document.querySelectorAll('[data-source-id]')).find(
      (el): el is HTMLElement => el instanceof HTMLElement && el.dataset.sourceId === result.sourceId
    )
    row?.querySelector<HTMLElement>('button')?.focus()
  })
}

/**
 * Settings › Sources body: "Add a source" and the connected sources grouped by scope (Everywhere first, then scopes in
 * their order); the empty state otherwise. Nothing renders until the stored sources have been read.
 */
export function SourcesSettings() {
  const { t } = useTranslation()
  const loaded = useSourcesLoaded()
  const sources = useSources()
  const hidden = useHiddenSourceIds()
  const { scopes } = useScopes()

  const groups = useMemo<Group[]>(() => {
    const visible = sources.filter((s) => !hidden.has(s.id))
    const order = [EVERYWHERE_SCOPE_ID, ...scopes.map((s) => s.id)]
    const ids = [...order, ...visible.map((s) => s.scopeId).filter((id) => !order.includes(id))]
    const nameOf = (id: string) =>
      id === EVERYWHERE_SCOPE_ID ? t('Everywhere') : (scopes.find((s) => s.id === id)?.name ?? t('Unknown scope'))
    return [...new Set(ids)]
      .map((scopeId) => ({ scopeId, name: nameOf(scopeId), sources: visible.filter((s) => s.scopeId === scopeId) }))
      .filter((g) => g.sources.length > 0)
  }, [sources, hidden, scopes, t])

  if (!loaded) return null

  const addButton = (
    <button type="button" className="dg-btn dg-btn--primary" onClick={() => void addSource()}>
      {t('Add a source')}
    </button>
  )

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2">
        <h3 className="dg-type-headline">{t('No sources yet.')}</h3>
        <p className="dg-type-callout dg-item__meta" style={{ margin: 0 }}>
          {t('Connect a folder, Gmail, Asana, Codex threads or documents so Dango can learn about your work.')}
        </p>
        {addButton}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div>{addButton}</div>
      {groups.map((group) => (
        <section key={group.scopeId} className="flex flex-col gap-2" aria-label={group.name}>
          {/* Scope names are user text: rendered as children. */}
          <h3 className="dg-type-headline">{group.name}</h3>
          <ul className="flex flex-col gap-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {group.sources.map((source) => (
              <SourceRow key={source.id} source={source} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
