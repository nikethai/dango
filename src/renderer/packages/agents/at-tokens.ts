/**
 * @ agent mention helpers for composer text (Slack-style inline tags).
 * Completed tokens stay in the message so users can direct agents in natural language.
 * Reserved: @mem / @memory (memory picker, not agents).
 */

const RESERVED_AGENT_SLUGS = new Set(['mem', 'memory'])

/** Matches completed @agent-slug tokens (kebab-case). */
export const AGENT_AT_TOKEN_RE = /@([a-z][a-z0-9]*(?:-[a-z0-9]+)*)/gi

export function slugifyAgentName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

/** Active @ partial at end of text / caret — returns query without @ (may be empty). */
export function getActiveAgentAtQuery(text: string, caret?: number): string | null {
  const pos = caret ?? text.length
  const before = text.slice(0, pos)
  // @name or bare @; require boundary so email-ish middle isn't triggered too aggressively
  const match = before.match(/(?:^|[\s([{])@([^\s@]*)$/)
  if (!match) return null
  const partial = match[1].toLowerCase()
  // Let @mem / @memory hand off to memory picker (partial prefixes included)
  if (partial === 'mem' || partial === 'memory' || partial.startsWith('mem ') || partial.startsWith('memory ')) {
    return null
  }
  // Typing @me… still agents until it becomes mem|memory exactly for memory trigger
  return partial
}

/** Strip trailing incomplete @query being typed (picker active). Prefer replaceActiveAgentAtWithToken on select. */
export function stripActiveAgentAtToken(text: string, caret?: number): string {
  const pos = caret ?? text.length
  const before = text.slice(0, pos)
  const after = text.slice(pos)
  const cleaned = before.replace(/(?:^|[\s([{])@[^\s@]*$/, (m) => {
    if (m.length > 0 && /[\s([{]/.test(m[0])) return m[0]
    return ''
  })
  return (cleaned + after)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()
}

/**
 * Replace active @partial with completed @slug, keeping the token in the draft.
 * Adds a trailing space when the caret is at end so the user can keep typing.
 */
export function replaceActiveAgentAtWithToken(text: string, slug: string, caret?: number): string {
  const token = slugifyAgentName(slug) || slug.toLowerCase().replace(/[^a-z0-9-]/g, '')
  if (!token) return text
  const pos = caret ?? text.length
  const before = text.slice(0, pos)
  const after = text.slice(pos)
  const replaced = before.replace(/(?:^|[\s([{])@[^\s@]*$/, (m) => {
    const boundary = m.length > 0 && /[\s([{]/.test(m[0]) ? m[0] : ''
    return `${boundary}@${token}`
  })
  const needsSpace = after.length === 0 || !/^\s/.test(after)
  return replaced + (needsSpace ? ' ' : '') + after
}

/** Completed @agent-slug tokens in text (excludes @mem / @memory). */
export function extractAgentSlugsFromText(text: string): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(AGENT_AT_TOKEN_RE)) {
    const name = match[1].toLowerCase()
    if (RESERVED_AGENT_SLUGS.has(name)) continue
    if (!seen.has(name)) {
      seen.add(name)
      names.push(name)
    }
  }
  return names
}

/**
 * Slugs of the @agent tokens already written in `text`, without the one still being typed at the end: a partial
 * `@Task` would otherwise prefix-match Task Planner and drop it from the picker as already mentioned.
 */
export function extractSettledAgentSlugsFromText(text: string): string[] {
  return extractAgentSlugsFromText(getActiveAgentAtQuery(text) === null ? text : stripActiveAgentAtToken(text))
}

/**
 * Remove a completed @agent token (by slug or agent id) from draft text.
 * Used when the user removes a room member so the composer chip does not linger.
 */
export function stripAgentTokenFromText(text: string, agent: { id: string; name: string }): string {
  const slugs = new Set<string>()
  const nameSlug = slugifyAgentName(agent.name)
  if (nameSlug) slugs.add(nameSlug.toLowerCase())
  const idSlug = agent.id.trim().toLowerCase()
  if (idSlug) slugs.add(idSlug)
  if (slugs.size === 0) return text

  // Reset lastIndex — AGENT_AT_TOKEN_RE is global
  AGENT_AT_TOKEN_RE.lastIndex = 0
  return text
    .replace(AGENT_AT_TOKEN_RE, (full, slug: string) => {
      if (slugs.has(String(slug).toLowerCase())) return ' '
      return full
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()
}

export type AgentMatchable = {
  id: string
  name: string
}

/** Resolve slug → agent by name slug or id. */
export function matchAgentBySlug(agents: AgentMatchable[], slug: string): AgentMatchable | undefined {
  const q = slug.toLowerCase()
  const exact = agents.find((a) => slugifyAgentName(a.name) === q || a.id.toLowerCase() === q)
  if (exact) return exact
  return agents.find((a) => {
    const s = slugifyAgentName(a.name)
    return s.startsWith(q) || a.id.toLowerCase().startsWith(q)
  })
}

export function fuzzyScoreAgent(value: string, query: string): number {
  if (!query) return 1
  const source = value.toLowerCase()
  const target = query.toLowerCase()
  if (source.includes(target)) return target.length + 100
  // also score slug form
  const sourceSlug = slugifyAgentName(value)
  if (sourceSlug.includes(target)) return target.length + 80
  let score = 0
  let ti = 0
  for (let si = 0; si < source.length && ti < target.length; si++) {
    if (source[si] === target[ti]) {
      score += 1
      ti += 1
    }
  }
  return ti === target.length ? score : 0
}
