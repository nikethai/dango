import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getLogger } from '@/lib/utils'
import { allowSuggestAgain, refreshScopes, scopeName, useDontSuggestList } from '@/packages/knowledge'

const log = getLogger('privacy')

export type DontSuggestRow = { id: string; text: string; scopeLabel: string; at: number }

/** The Don't suggest again list as view rows (newest first), and the action that takes a text off it. */
export function useDontSuggestEntries(): { items: DontSuggestRow[]; restore(id: string): Promise<void> } {
  const { t } = useTranslation()
  const entries = useDontSuggestList()
  // scopeName reads a scope snapshot that refreshes after the knowledge state loads: re-derive once it has.
  const [scopesAt, setScopesAt] = useState(0)
  useEffect(() => {
    let live = true
    refreshScopes()
      .then(() => live && setScopesAt((n) => n + 1))
      .catch((error) => log.error('Scope refresh failed:', error))
    return () => {
      live = false
    }
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: scopesAt invalidates the scope-name snapshot
  const items = useMemo(
    () => entries.map((e) => ({ id: e.id, text: e.text, scopeLabel: scopeName(e.scopeId), at: e.addedAt })),
    [entries, scopesAt]
  )
  const restore = useCallback(
    async (id: string) => {
      try {
        await allowSuggestAgain(id)
      } catch (error) {
        log.error('Suggest again failed:', error)
        const toastActions = await import('@/stores/toastActions')
        toastActions.add(t("Couldn't turn this back on. Try again."))
      }
    },
    [t]
  )
  return { items, restore }
}
