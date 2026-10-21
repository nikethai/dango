// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => String(vars?.[name] ?? name)),
  }),
}))
vi.mock('@/components/brand/Mascot', () => ({ Mascot: () => <svg /> }))

const h = vi.hoisted(() => ({
  state: { trustLevel: undefined as unknown, firstRun: undefined as unknown, setSettings: vi.fn() },
  finishFirstRun: vi.fn(async () => {}),
  navigate: vi.fn(),
}))

vi.mock('@/stores/settingsStore', () => ({
  settingsStore: { getState: () => h.state },
  useSettingsStore: (sel: (s: typeof h.state) => unknown) => sel(h.state),
}))
vi.mock('@/packages/first-run/firstRun', () => ({ finishFirstRun: h.finishFirstRun }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => h.navigate }))

import { TrustStep } from './TrustStep'

beforeEach(() => {
  h.state.trustLevel = undefined
  h.state.firstRun = { step: 4, sourceSkipped: false, scopeId: 's1', firstReadJobId: 'j1' }
  h.state.setSettings.mockReset()
  h.finishFirstRun.mockClear()
  h.navigate.mockReset()
})
afterEach(cleanup)

describe('TrustStep (FR4)', () => {
  it('renders step 4 with the title, both options and the note', () => {
    render(<TrustStep />)
    expect(screen.getByRole('heading', { level: 1, name: 'How much should it do on its own?' })).toBeTruthy()
    expect(screen.getByText('(recommended)')).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Ask first/ })).toBeTruthy()
    const note = screen.getByText(/^Always asks, whatever you choose/)
    expect(note.textContent).toBe(
      'Always asks, whatever you choose: sending anything, deleting, editing files, changing a decision, saving knowledge. Change this later under Settings → Memory and privacy.'
    )
    expect(note.textContent).toContain('saving knowledge')
  })

  it('checks Auto by default even when trustLevel is unset', () => {
    render(<TrustStep />)
    expect((screen.getByRole('radio', { name: /Auto/ }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('radio', { name: /Ask first/ }) as HTMLInputElement).checked).toBe(false)
  })

  it('starts on the saved level', () => {
    h.state.trustLevel = 'ask'
    render(<TrustStep />)
    expect((screen.getByRole('radio', { name: /Ask first/ }) as HTMLInputElement).checked).toBe(true)
  })

  it('shows the Trust sheet’s lines; the Auto line says knowledge always waits', () => {
    render(<TrustStep />)
    const auto = screen.getByRole('radio', { name: /Auto/ }).closest('label') as HTMLElement
    expect(auto.textContent).toContain('Dango does safe things first and shows them in Review as Done, with Undo.')
    expect(auto.textContent).toContain('Knowledge always waits for you.')
    const ask = screen.getByRole('radio', { name: /Ask first/ }).closest('label') as HTMLElement
    expect(ask.textContent).toContain('The same items wait in Review until you approve them.')
    expect(ask.textContent).toContain('Nothing is applied until you press Approve.')
  })

  it('Ask first then Start writes trustLevel ask, finishes first run and goes to Review', async () => {
    render(<TrustStep />)
    fireEvent.click(screen.getByRole('radio', { name: /Ask first/ }))
    const start = screen.getByRole('button', { name: 'Start' })
    expect(start.className).toContain('dg-btn--primary')
    await act(() => {
      fireEvent.click(start)
      return Promise.resolve()
    })
    expect(h.state.setSettings).toHaveBeenCalledWith({ trustLevel: 'ask' })
    expect(h.finishFirstRun).toHaveBeenCalledTimes(1)
    expect(h.finishFirstRun).toHaveBeenCalledWith(h.state.firstRun, expect.any(Number))
    expect(h.navigate).toHaveBeenCalledWith({ to: '/', replace: true })
  })

  it('Start with Auto writes trustLevel auto', async () => {
    render(<TrustStep />)
    await act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Start' }))
      return Promise.resolve()
    })
    expect(h.state.setSettings).toHaveBeenCalledWith({ trustLevel: 'auto' })
  })

  it('ignores a second Start while finishing', async () => {
    let release: () => void = () => {}
    h.finishFirstRun.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          release = r
        })
    )
    render(<TrustStep />)
    const start = screen.getByRole('button', { name: 'Start' })
    fireEvent.click(start)
    fireEvent.click(start)
    expect(h.finishFirstRun).toHaveBeenCalledTimes(1)
    await act(() => {
      release()
      return Promise.resolve()
    })
    expect(h.navigate).toHaveBeenCalledTimes(1)
  })
})
