import type { ScopeKind } from '@shared/types'

// Second-level labels under a country code (`acme.co.uk`): skipped so the organisation's own label is used.
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'ltd', 'plc'])

function lastPathSegment(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

function capitalise(word: string): string {
  return word ? word[0].toUpperCase() + word.slice(1) : ''
}

/** The organisation in an address's domain: `pm@mail.acme.co.uk` → `Acme`. Empty when it is not an address. */
function domainName(address: string): string {
  const at = address.lastIndexOf('@')
  if (at < 0) return ''
  const labels = address
    .slice(at + 1)
    .toLowerCase()
    .split('.')
    .filter(Boolean)
  if (labels.length < 2) return ''
  labels.pop()
  if (labels.length > 1 && SECOND_LEVEL.has(labels[labels.length - 1])) labels.pop()
  return capitalise(labels[labels.length - 1])
}

/**
 * FR3's suggested scope name for a picked source. Folder and documents: the last path segment (a collection name has
 * none, so it is the name itself). Gmail: the address's domain without its TLD, capitalised. Asana: the label.
 * Codex threads: nothing (they are not about one project).
 */
export function suggestScopeName(draft: { kind: string; label: string; ref?: string }): string {
  switch (draft.kind) {
    case 'folder':
    case 'documents':
      return lastPathSegment(draft.ref ?? draft.label).trim()
    case 'gmail':
      return domainName(draft.ref ?? draft.label)
    case 'asana':
      return draft.label.trim()
    default:
      return ''
  }
}

/** FR3's preselected scope kind: mail and task accounts are usually a client; anything else a project. */
export function defaultScopeKind(kind: string): ScopeKind {
  return kind === 'gmail' || kind === 'asana' ? 'client' : 'project'
}
