/**
 * EM3: three things to ask in a first chat. A named scope gets questions about it; otherwise general ones.
 * Callers pass a translator that leaves `{{scope}}` alone (t with skipInterpolation); the name is filled in here
 * with a function replacer, so quotes, `$&` or `{{x}}` in a scope name are inserted verbatim.
 */

export type FirstChatScopeKind = 'project' | 'client' | null

const GENERAL = ['What needs me today?', 'What changed this week?', 'Help me write a reply'] as const

const BY_KIND = {
  project: [
    'What changed in {{scope}} since I last looked?',
    'Summarise what we know about {{scope}}',
    "What's still open in {{scope}}?",
  ],
  client: ['What did we promise {{scope}} last?', 'Draft a reply to {{scope}}', "What's still open with {{scope}}?"],
} as const

const identity = (key: string) => key

export function firstChatSuggestions(
  input: { scopeName?: string; scopeKind: FirstChatScopeKind },
  translate: (key: string) => string = identity
): string[] {
  const name = input.scopeName?.trim()
  if (!name || !input.scopeKind) return GENERAL.map((key) => translate(key))
  return BY_KIND[input.scopeKind].map((key) => translate(key).replace(/\{\{scope\}\}/g, () => name))
}
