import { afterEach, describe, expect, it } from 'vitest'
import {
  _resetSearchProvidersForTests,
  listSearchProviders,
  registerBuiltInSearchProviders,
  registerSearchProvider,
} from './registry'
import type { SearchProvider } from './types'

const provider = (id: string, group: SearchProvider['group'] = 'chats'): SearchProvider => ({
  id,
  group,
  search: async () => [],
})

afterEach(() => _resetSearchProvidersForTests())

describe('search provider registry', () => {
  it('registering the same id twice keeps one, the newer one', () => {
    const first = provider('docs', 'sources')
    const second = provider('docs', 'sources')
    registerSearchProvider(first)
    registerSearchProvider(second)
    expect(listSearchProviders()).toEqual([second])
  })

  it('the returned function unregisters', () => {
    const off = registerSearchProvider(provider('a'))
    registerSearchProvider(provider('b'))
    off()
    expect(listSearchProviders().map((p) => p.id)).toEqual(['b'])
  })

  it('a stale unregister leaves the provider that replaced it', () => {
    const off = registerSearchProvider(provider('a'))
    const replacement = provider('a')
    registerSearchProvider(replacement)
    off()
    expect(listSearchProviders()).toEqual([replacement])
  })

  it('registerBuiltInSearchProviders twice gives four providers', () => {
    registerBuiltInSearchProviders()
    registerBuiltInSearchProviders()
    const providers = listSearchProviders()
    expect(providers).toHaveLength(4)
    expect(providers.map((p) => [p.id, p.group])).toEqual([
      ['chats', 'chats'],
      ['knowledge', 'knowledge'],
      ['workspaceFiles', 'sources'],
      ['importedThreads', 'sources'],
    ])
    expect(providers.find((p) => p.id === 'workspaceFiles')?.minChars).toBe(2)
  })
})
