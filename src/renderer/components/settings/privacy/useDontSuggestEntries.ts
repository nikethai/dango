import { useCallback, useMemo } from 'react'
import { getLogger } from '@/lib/utils'
import { allowSuggestAgain, scopeName, useDontSuggestList } from '@/packages/knowledge'

const log = getLogger('privacy')

export type DontSuggestRow = { id: string; text: string; scopeLabel: string; at: number }

/** The Don't suggest again list as view rows (newest first), and the action that takes a text off it. */
export function useDontSuggestEntries(): { items: DontSuggestRow[]; restore(id: string): Promise<void> } {
  const entries = useDontSuggestList()
  const items = useMemo(
    () => entries.map((e) => ({ id: e.id, text: e.text, scopeLabel: scopeName(e.scopeId), at: e.addedAt })),
    [entries]
  )
  const restore = useCallback(async (id: string) => {
    try {
      await allowSuggestAgain(id)
    } catch (error) {
      log.error('Suggest again failed:', error)
    }
  }, [])
  return { items, restore }
}
