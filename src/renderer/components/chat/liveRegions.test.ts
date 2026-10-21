// A11Y1 rule 1 (slice 09 Task 9): one polite live region per turn. Chat, message-part and composer components show
// status visually; only TurnAnnouncer speaks the turn.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const RENDERER = resolve(process.cwd(), 'src/renderer')
// The chat page: the thread, its message parts, the composer and the session route.
const ROOTS = ['components/chat', 'components/message-parts', 'components/InputBox', 'routes/session']

/**
 * Composer notices that are role="status" on purpose. Each is a one-shot line that appears once on a user action or a
 * threshold, never per token or per turn, so none of them repeats what TurnAnnouncer says. A new region here needs a
 * reason, or should go through TurnAnnouncer instead.
 */
const ALLOWED: Record<string, string> = {
  // The turn's own status: the one polite region per turn.
  'components/chat/TurnAnnouncer.tsx': 'the turn announcer',
  // "This chat is N% full": appears once when the chat crosses 80% of the context window, between turns.
  'components/InputBox/ContextNearFullNotice.tsx': 'one-shot context-full notice',
  // ER4 "Model can't use tools": checked before sending, never during a turn.
  'components/InputBox/ModelReadinessNotice.tsx': 'one-shot pre-send readiness notice',
  // "Sampling video frames…": while an attached video is prepared, before the message is sent.
  'components/InputBox/InputBox.tsx': 'one-shot attachment preparation line',
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (name.endsWith('.tsx') && !name.endsWith('.test.tsx')) out.push(full)
  }
  return out
}

const LIVE = /aria-live=["']polite["']|role=["']status["']/g

describe('live regions on the chat page', () => {
  const files = ROOTS.flatMap((root) => walk(resolve(RENDERER, root)))
  const regions = Object.fromEntries(
    files
      .map((full) => [relative(RENDERER, full).split(sep).join('/'), readFileSync(full, 'utf8')] as const)
      .map(([path, src]) => [path, src.match(LIVE)?.length ?? 0] as const)
      .filter(([, count]) => count > 0)
  )

  it('scans the thread, the message parts and the composer', () => {
    expect(files.length).toBeGreaterThan(40)
    expect(files.some((f) => f.endsWith('InputBox.tsx'))).toBe(true)
  })

  it('only TurnAnnouncer and the allow-listed one-shot composer notices have a polite region', () => {
    expect(Object.keys(regions).sort()).toEqual(Object.keys(ALLOWED).sort())
  })

  it('the composer notices keep to one region each (InputBox: role and aria-live on the same line)', () => {
    expect(regions['components/InputBox/ContextNearFullNotice.tsx']).toBe(1)
    expect(regions['components/InputBox/ModelReadinessNotice.tsx']).toBe(1)
    expect(regions['components/InputBox/InputBox.tsx']).toBe(2)
  })
})
