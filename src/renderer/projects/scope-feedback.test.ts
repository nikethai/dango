import type { Scope } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const add = vi.fn()
const logError = vi.fn()
const deleteScopeWithUndo = vi.fn()

vi.mock('@/stores/toastActions', () => ({ add: (...args: unknown[]) => add(...args) }))
vi.mock('i18next', () => ({
  t: (key: string, vars?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars?.[name] ?? '')),
}))
vi.mock('@/lib/utils', () => ({ getLogger: () => ({ error: (...args: unknown[]) => logError(...args) }) }))
vi.mock('./scope-delete', () => ({ deleteScopeWithUndo: (...args: unknown[]) => deleteScopeWithUndo(...args) }))

import { deleteScopeOrToast } from './scope-feedback'

const scope = { id: 's1', name: 'Acme Co', kind: 'client' } as Scope
const deps = { removeScope: vi.fn(), putScope: vi.fn() }

beforeEach(() => {
  add.mockClear()
  logError.mockClear()
  deleteScopeWithUndo.mockReset()
})

describe('deleteScopeOrToast', () => {
  it('returns true when the delete works', async () => {
    deleteScopeWithUndo.mockResolvedValue(undefined)
    expect(await deleteScopeOrToast(scope, [], deps)).toBe(true)
    expect(deleteScopeWithUndo).toHaveBeenCalledWith(scope, [], deps)
    expect(add).not.toHaveBeenCalled()
  })

  it('shows a toast naming the scope and returns false when the delete fails', async () => {
    deleteScopeWithUndo.mockRejectedValue(new Error('nope'))
    expect(await deleteScopeOrToast(scope, [], deps)).toBe(false)
    expect(add).toHaveBeenCalledWith("Couldn't delete Acme Co. Try again.")
  })
})
