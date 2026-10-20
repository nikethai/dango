import { chatsProvider } from './providers/chats'
import { importedThreadsProvider } from './providers/importedThreads'
import { knowledgeProvider } from './providers/knowledge'
import { workspaceFilesProvider } from './providers/workspaceFiles'
import type { SearchProvider } from './types'

// Providers by id, in registration order (a replacement keeps its place). Slice 7 sources and slice 10 add their own.
const providers = new Map<string, SearchProvider>()

/** Adds a provider; one with the same id is replaced. Returns the unregister (a no-op once it was replaced). */
export function registerSearchProvider(p: SearchProvider): () => void {
  providers.set(p.id, p)
  return () => {
    if (providers.get(p.id) === p) providers.delete(p.id)
  }
}

export function listSearchProviders(): SearchProvider[] {
  return [...providers.values()]
}

/** Registers chats, knowledge, workspace files and imported threads. Idempotent. */
export function registerBuiltInSearchProviders(): void {
  for (const p of [chatsProvider, knowledgeProvider, workspaceFilesProvider, importedThreadsProvider]) {
    registerSearchProvider(p)
  }
}

export function _resetSearchProvidersForTests(): void {
  providers.clear()
}
