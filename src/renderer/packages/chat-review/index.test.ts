import { describe, expect, it } from 'vitest'
import { scopeIdForSession } from './index'

describe('scopeIdForSession', () => {
  it("returns the chat's project", () => {
    expect(scopeIdForSession({ projectId: 'p1' })).toBe('p1')
  })
  it('falls back to Everywhere', () => {
    expect(scopeIdForSession({})).toBe('everywhere')
  })
  it('reads a legacy folderId the way the rest of the chat does (getEffectiveProjectId)', () => {
    expect(scopeIdForSession({ folderId: 'f1' })).toBe('f1')
    expect(scopeIdForSession({ projectId: 'p1', folderId: 'f1' })).toBe('p1')
  })
})
