/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDangoMantineTheme } from '@/theme/mantineTheme'

const h = vi.hoisted(() => ({ setSettings: vi.fn(), navigate: vi.fn(), smallScreen: false }))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => h.navigate }))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => h.smallScreen }))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (pick: (s: unknown) => unknown) => pick({ setSettings: h.setSettings, customProviders: [] }),
}))

import { AddProviderModal } from './AddProviderModal'

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }))
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  h.setSettings.mockReset()
  h.navigate.mockReset()
  h.smallScreen = false
})

function renderModal() {
  const onClose = vi.fn()
  render(
    <MantineProvider theme={createDangoMantineTheme()}>
      <AddProviderModal opened onClose={onClose} />
    </MantineProvider>
  )
  return { onClose }
}

describe('AddProviderModal', () => {
  it('labels Name and API Mode, and focuses Name', async () => {
    renderModal()
    const name = await screen.findByRole('textbox', { name: /Name/ })
    expect(screen.getByRole('textbox', { name: 'API Mode' })).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(name))
  })

  it('shows "Name is required" only after Add with an empty name', async () => {
    renderModal()
    await screen.findByRole('textbox', { name: /Name/ })
    expect(screen.queryByText('Name is required')).toBeNull()
    const add = screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement
    expect(add.disabled).toBe(false)
    fireEvent.click(add)
    expect(await screen.findByText('Name is required')).toBeTruthy()
    expect(h.setSettings).not.toHaveBeenCalled()
  })

  it('Enter in Name saves the provider', async () => {
    const { onClose } = renderModal()
    const name = await screen.findByRole('textbox', { name: /Name/ })
    fireEvent.change(name, { target: { value: 'Fake W' } })
    fireEvent.keyDown(name, { key: 'Enter' })
    expect(h.setSettings).toHaveBeenCalledWith({
      customProviders: [expect.objectContaining({ name: 'Fake W', isCustom: true })],
    })
    expect(onClose).toHaveBeenCalled()
    expect(h.navigate).toHaveBeenCalled()
  })
})
