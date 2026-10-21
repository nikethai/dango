/**
 * @vitest-environment jsdom
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COMPOSER_TOOLBAR_ICON_CLASS, composerToolbarButtonClass } from './composerToolbar'
import DictateButton from './DictateButton'
import type { VoiceHoldButtonProps } from './VoiceHoldButton'

const { navigateToSettings } = vi.hoisted(() => ({ navigateToSettings: vi.fn() }))

vi.mock('@/modals/Settings', () => ({ navigateToSettings }))
vi.mock('./VoiceHoldButton', () => ({
  default: () => <button type="button">Hold to talk</button>,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

// small screen or not, for the media queries this file used to drive
let smallScreen = false

// useIsSmallScreen follows the window width (phone < 760 px, slice 9 useLayoutMode)
const setWindowWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  window.dispatchEvent(new Event('resize'))
}

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: smallScreen,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

const baseProps = (enabled: boolean): VoiceHoldButtonProps => ({
  enabled,
  config: {} as VoiceHoldButtonProps['config'],
  shortcut: '',
  toolbarButtonClass: 'toolbar-button',
  toolbarIconSize: 18,
  onTranscript: vi.fn(),
})

const renderButton = (enabled: boolean) =>
  render(
    <MantineProvider>
      <DictateButton {...baseProps(enabled)} />
    </MantineProvider>
  )

beforeEach(() => {
  navigateToSettings.mockClear()
  smallScreen = false
  setWindowWidth(1280)
})

describe('DictateButton', () => {
  it('stays visible when voice is not set up and leads to Settings > Voice', () => {
    renderButton(false)

    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }))

    expect(navigateToSettings).toHaveBeenCalledTimes(1)
    expect(navigateToSettings).toHaveBeenCalledWith('/voice')
    expect(screen.queryByRole('button', { name: 'Hold to talk' })).toBeNull()
  })

  it('uses the same button and icon classes as the Tools button, from one shared constant', () => {
    renderButton(false)

    const button = screen.getByRole('button', { name: 'Dictate' })
    for (const name of composerToolbarButtonClass(false).split(' ')) {
      expect(button.classList.contains(name), name).toBe(true)
    }
    expect(button.classList.contains('toolbar-button')).toBe(true)
    const icon = button.querySelector('svg')
    expect(icon?.getAttribute('class') ?? '').toContain(COMPOSER_TOOLBAR_ICON_CLASS)

    const tools = readFileSync(resolve(process.cwd(), 'src/renderer/components/InputBox/ComposerToolsMenu.tsx'), 'utf8')
    expect(tools).toContain('composerToolbarButtonClass(isSmallScreen)')
    expect(tools).toContain('COMPOSER_TOOLBAR_ICON_CLASS')
  })

  it('gets the 44px mobile touch target on small screens, like the Tools button', () => {
    smallScreen = true
    setWindowWidth(390)
    renderButton(false)

    const button = screen.getByRole('button', { name: 'Dictate' })
    for (const name of ['mobile-touch-target', 'min-w-11', 'min-h-11']) {
      expect(button.classList.contains(name), name).toBe(true)
    }
    // the desktop 36px minimums are utilities and would beat .mobile-touch-target (a components-layer class)
    expect(button.classList.contains('min-w-9')).toBe(false)
    expect(button.classList.contains('min-h-9')).toBe(false)
  })

  it('renders the hold-to-talk control, not the fallback, when voice is enabled', () => {
    renderButton(true)

    expect(screen.getByRole('button', { name: 'Hold to talk' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Dictate' })).toBeNull()
  })
})

describe('composer order', () => {
  it('places the dictate button after the model picker and before Send', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/components/InputBox/InputBox.tsx'), 'utf8')
    const model = source.indexOf('<ModelSelector')
    const dictate = source.indexOf('<DictateButton')
    const send = source.indexOf('aria-label={isSamplingVideoFrames')
    expect(model).toBeGreaterThan(-1)
    expect(dictate).toBeGreaterThan(model)
    expect(send).toBeGreaterThan(dictate)
  })
})
