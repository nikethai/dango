export type SearchGroup = 'chats' | 'knowledge' | 'sources'

export const SEARCH_GROUPS: readonly SearchGroup[] = ['chats', 'knowledge', 'sources']

/** Hits shown per group in the overlay. */
export const SEARCH_GROUP_LIMIT = 8

/**
 * One result. `title`, `excerpt` and `sourceLabel` hold external text (chat titles, knowledge text, file paths): render
 * them as plain React children, never inside `<Trans>`.
 */
export type SearchHit = {
  id: string
  group: SearchGroup
  title: string
  excerpt?: string
  /** The scope the hit belongs to (may be Everywhere); unset for hits outside any scope. */
  scopeId?: string
  sourceLabel: string
  open(): void | Promise<void>
}

export type SearchQuery = { text: string; scopeIds: string[] | 'all' }

export type SearchProvider = {
  id: string
  group: SearchGroup
  /** Characters the trimmed text needs before this provider runs (default 1). */
  minChars?: number
  search(q: SearchQuery, signal: AbortSignal): Promise<SearchHit[]>
}

/** Collapses whitespace runs (including newlines) to single spaces, for one-line excerpts. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Whether `scopeId` passes the query's scope filter. */
export function inScopes(scopeId: string | undefined, scopeIds: SearchQuery['scopeIds']): boolean {
  return scopeIds === 'all' || (scopeId !== undefined && scopeIds.includes(scopeId))
}
