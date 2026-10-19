import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ os: 'Mac' }))
vi.mock('@/packages/navigator', () => ({ getOS: () => h.os }))
vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))

async function label(os: string, key: string) {
  h.os = os
  vi.resetModules()
  const { formatShortcutLabel } = await import('./Shortcut')
  return formatShortcutLabel(key)
}

afterEach(() => {
  h.os = 'Mac'
})

describe('formatShortcutLabel', () => {
  it('shows CommandOrControl as ⌘ on macOS and Ctrl elsewhere', async () => {
    expect(await label('Mac', 'CommandOrControl')).toBe('⌘')
    expect(await label('Windows', 'CommandOrControl')).toBe('Ctrl')
    expect(await label('Linux', 'CommandOrControl')).toBe('Ctrl')
  })
})
