import { registerBuiltInSearchProviders } from './registry'

// The four built-in providers register on import, like the source kinds; slices 7 and 10 add theirs with
// `registerSearchProvider`.
registerBuiltInSearchProviders()

export { attachPrefill } from './attach'
export { openChatHit } from './providers/chats'
export { listSearchProviders, registerBuiltInSearchProviders, registerSearchProvider } from './registry'
export {
  SEARCH_GROUP_LIMIT,
  SEARCH_GROUPS,
  type SearchGroup,
  type SearchHit,
  type SearchProvider,
  type SearchQuery,
} from './types'
export { SEARCH_DEBOUNCE_MS, useSearch } from './useSearch'
