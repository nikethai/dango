// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import type { ProviderSettings } from '@shared/types'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDangoMantineTheme } from '@/theme/mantineTheme'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => String(vars?.[name] ?? name)),
  }),
}))
vi.mock('@/components/brand/Mascot', () => ({ Mascot: () => <svg /> }))

const h = vi.hoisted(() => {
  const providers: Record<string, unknown> = {}
  const setters: Record<string, ReturnType<typeof vi.fn>> = {}
  const state: Record<string, unknown> = { providers }
  return { providers, setters, state }
})

function setterFor(id: string) {
  if (!h.setters[id]) h.setters[id] = vi.fn()
  return h.setters[id]
}

vi.mock('@/stores/settingsStore', () => ({
  useProviderSettings: (id: string) => ({ providerSettings: h.providers[id], setProviderSettings: setterFor(id) }),
  useSettingsStore: (selector: (s: unknown) => unknown) => selector(h.state),
  settingsStore: { getState: () => h.state },
}))
const needEditSetting = vi.fn(() => true)
vi.mock('@/stores/settingActions', () => ({ needEditSetting: () => needEditSetting() }))
const checkProviderKey = vi.fn()
vi.mock('@/packages/first-run/checkProviderKey', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  checkProviderKey: (...args: unknown[]) => checkProviderKey(...args),
}))
const setFirstRun = vi.fn()
vi.mock('@/packages/first-run/firstRun', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  setFirstRun: (...args: unknown[]) => setFirstRun(...args),
}))
const navigate = vi.fn()
vi.mock('@/router', () => ({ router: { navigate: (...args: unknown[]) => navigate(...args) } }))
const navigateToSettings = vi.fn()
vi.mock('@/modals/Settings', () => ({ navigateToSettings: (...args: unknown[]) => navigateToSettings(...args) }))

const CODEX_PATCH = { authMode: 'oauth', models: [{ modelId: 'gpt-5-codex' }] }
const GEMINI_PATCH = { authMode: 'oauth', models: [{ modelId: 'gemini-3-pro' }] }
vi.mock('@/components/settings/OpenAICodexAuthSection', () => ({
  OpenAICodexAuthSection: (p: { hideModeSwitch?: boolean }) => (
    <div data-testid="codex-section" data-hide-mode-switch={String(Boolean(p.hideModeSwitch))} />
  ),
  openAICodexOAuthModePatch: () => CODEX_PATCH,
}))
vi.mock('@/components/settings/GeminiAntigravityAuthSection', () => ({
  GeminiAntigravityAuthSection: (p: {
    hideModeSwitch?: boolean
    setProviderSettings: (v: Partial<ProviderSettings>) => void
  }) => (
    <div data-testid="gemini-section" data-hide-mode-switch={String(Boolean(p.hideModeSwitch))}>
      <button type="button" onClick={() => p.setProviderSettings({ oauth: { accessToken: 'tok' } } as never)}>
        fake sign in
      </button>
    </div>
  ),
  geminiAntigravityOAuthModePatch: () => GEMINI_PATCH,
}))

import { ModelStep } from './ModelStep'

// jsdom lacks matchMedia and ResizeObserver, which Mantine reads.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
)
vi.stubGlobal(
  'matchMedia',
  vi.fn(() => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
)

function renderStep(props: { modelOnly?: boolean; from?: string } = {}) {
  return render(
    <MantineProvider theme={createDangoMantineTheme()}>
      <ModelStep modelOnly={props.modelOnly ?? false} from={props.from} />
    </MantineProvider>
  )
}

function radio(name: RegExp) {
  return screen.getByRole('radio', { name })
}

/** Clicks, then lets the mocked key check's promise settle. */
async function clickAndSettle(click: () => void) {
  await act(async () => {
    click()
    await Promise.resolve()
  })
}

function continueButton() {
  return screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement
}

async function enterAnthropicKey(key = 'sk-ant-test') {
  fireEvent.click(radio(/I have a key/))
  fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'claude' } })
  fireEvent.change(screen.getByLabelText('API key'), { target: { value: key } })
  await clickAndSettle(() => fireEvent.click(continueButton()))
}

beforeEach(() => {
  for (const k of Object.keys(h.providers)) delete h.providers[k]
  for (const k of Object.keys(h.setters)) delete h.setters[k]
  h.state.defaultChatModel = undefined
  h.state.firstRun = { step: 1, sourceSkipped: false }
  h.state.setSettings = vi.fn()
  needEditSetting.mockReturnValue(true)
  checkProviderKey.mockReset()
  setFirstRun.mockReset()
  navigate.mockReset()
  navigateToSettings.mockReset()
})
afterEach(cleanup)

describe('ModelStep', () => {
  it('renders the title, lead and three choices with their exact lines, and no skip', () => {
    renderStep()
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in to a model' })).toBeTruthy()
    expect(
      screen.getByText('Dango uses providers you already have. Nothing is sent anywhere until you ask a question.')
    ).toBeTruthy()
    const group = screen.getByRole('radiogroup')
    const radios = Array.from(group.querySelectorAll('[role="radio"]'))
    expect(radios).toHaveLength(3)
    expect(radio(/Continue with Google/).textContent).toContain(
      'Gemini. Google receives your questions when you ask them.'
    )
    expect(radio(/Continue with ChatGPT/).textContent).toContain(
      'Codex models. OpenAI receives your questions when you ask them.'
    )
    expect(radio(/I have a key/).textContent).toContain('OpenAI, Anthropic, Gemini, OpenRouter, Ollama and more.')
    expect(screen.queryByRole('button', { name: /skip/i })).toBeNull()
    expect(continueButton().disabled).toBe(true)
  })

  it('radio keys: arrows move focus, Space selects', () => {
    renderStep()
    const google = radio(/Continue with Google/)
    act(() => google.focus())
    fireEvent.keyDown(google, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(radio(/Continue with ChatGPT/))
    expect(radio(/Continue with ChatGPT/).getAttribute('aria-checked')).toBe('false')
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' })
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(radio(/I have a key/))
    fireEvent.keyDown(document.activeElement as Element, { key: ' ' })
    expect(radio(/I have a key/).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByLabelText('API key')).toBeTruthy()
  })

  it('Continue with ChatGPT seeds OpenAI OAuth and shows the Codex section without its mode switch', () => {
    renderStep()
    fireEvent.click(radio(/Continue with ChatGPT/))
    expect(setterFor('openai')).toHaveBeenCalledWith(
      expect.objectContaining({ authMode: 'oauth', models: expect.any(Array) })
    )
    expect(screen.getByTestId('codex-section').getAttribute('data-hide-mode-switch')).toBe('true')
    expect(radio(/Continue with ChatGPT/).getAttribute('aria-checked')).toBe('true')
  })

  it('Continue with Google seeds Gemini OAuth and shows the Gemini section without its mode switch', () => {
    renderStep()
    fireEvent.click(radio(/Continue with Google/))
    expect(setterFor('gemini')).toHaveBeenCalledWith(
      expect.objectContaining({ authMode: 'oauth', models: expect.any(Array) })
    )
    expect(screen.getByTestId('gemini-section').getAttribute('data-hide-mode-switch')).toBe('true')
  })

  it('OAuth Continue is disabled while needEditSetting() is true, enabled once signed in', () => {
    renderStep()
    fireEvent.click(radio(/Continue with ChatGPT/))
    expect(continueButton().disabled).toBe(true)
    cleanup()
    needEditSetting.mockReturnValue(false)
    renderStep()
    fireEvent.click(radio(/Continue with ChatGPT/))
    expect(continueButton().disabled).toBe(false)
  })

  it('OAuth Continue sets the default model to the seeded first model and saves the next step', () => {
    needEditSetting.mockReturnValue(false)
    h.providers.openai = CODEX_PATCH
    renderStep()
    fireEvent.click(radio(/Continue with ChatGPT/))
    fireEvent.click(continueButton())
    expect(h.state.setSettings).toHaveBeenCalledWith({ defaultChatModel: { provider: 'openai', model: 'gpt-5-codex' } })
    expect(setFirstRun).toHaveBeenCalledWith({ step: 2 })
  })

  it('a completed sign-in in the auth section finishes the step at once', () => {
    h.providers.gemini = GEMINI_PATCH
    renderStep()
    fireEvent.click(radio(/Continue with Google/))
    fireEvent.click(screen.getByRole('button', { name: 'fake sign in' }))
    expect(setterFor('gemini')).toHaveBeenLastCalledWith({ oauth: { accessToken: 'tok' } })
    expect(h.state.setSettings).toHaveBeenCalledWith({
      defaultChatModel: { provider: 'gemini', model: 'gemini-3-pro' },
    })
    expect(setFirstRun).toHaveBeenCalledWith({ step: 2 })
  })

  it('I have a key shows the provider select, the API key field and the link to other providers', () => {
    renderStep()
    fireEvent.click(radio(/I have a key/))
    expect(screen.getByLabelText('API key')).toBeTruthy()
    const select = screen.getByLabelText('Provider') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'OpenAI',
      'Anthropic',
      'Gemini',
      'OpenRouter',
    ])
    expect(continueButton().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Ollama and other providers' }))
    expect(navigateToSettings).toHaveBeenCalledWith('/provider')
  })

  it('key Continue is enabled by a non-empty field even while needEditSetting() is true', () => {
    renderStep()
    fireEvent.click(radio(/I have a key/))
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: '   ' } })
    expect(continueButton().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-1' } })
    expect(continueButton().disabled).toBe(false)
  })

  it('a rejected key shows the error, saves nothing, and Update key focuses the field', async () => {
    checkProviderKey.mockResolvedValue('rejected')
    renderStep()
    await enterAnthropicKey()
    expect(screen.getByText('Your Anthropic key was rejected.')).toBeTruthy()
    expect(setterFor('claude')).not.toHaveBeenCalled()
    expect(setFirstRun).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Update key' }))
    expect(document.activeElement).toBe(screen.getByLabelText('API key'))
  })

  it('an unreachable provider shows the error with Try again, which checks again', async () => {
    checkProviderKey.mockResolvedValue('unreachable')
    renderStep()
    await enterAnthropicKey()
    expect(screen.getByText('Dango could not reach Anthropic.')).toBeTruthy()
    checkProviderKey.mockResolvedValue('ok')
    await clickAndSettle(() => fireEvent.click(screen.getByRole('button', { name: 'Try again' })))
    expect(document.activeElement).toBe(continueButton())
    expect(checkProviderKey).toHaveBeenCalledTimes(2)
    expect(setterFor('claude')).toHaveBeenCalledWith({ apiKey: 'sk-ant-test' })
  })

  it('checks the key on a settings copy, then saves it, sets the default model and the next step on ok', async () => {
    checkProviderKey.mockResolvedValue('ok')
    renderStep()
    await enterAnthropicKey()
    const [providerId, modelId, candidate] = checkProviderKey.mock.calls[0] as [string, string, Record<string, never>]
    expect(providerId).toBe('claude')
    expect(modelId).toBe('claude-opus-4-1')
    expect((candidate.providers as Record<string, ProviderSettings>).claude.apiKey).toBe('sk-ant-test')
    expect(candidate).not.toBe(h.state)
    expect(h.providers.claude).toBeUndefined()
    expect(setterFor('claude')).toHaveBeenCalledWith({ apiKey: 'sk-ant-test' })
    expect(h.state.setSettings).toHaveBeenCalledWith({
      defaultChatModel: { provider: 'claude', model: 'claude-opus-4-1' },
    })
    expect(setFirstRun).toHaveBeenCalledWith({ step: 2 })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('keeps an existing default model whose provider still has credentials', async () => {
    checkProviderKey.mockResolvedValue('ok')
    h.providers.openai = { apiKey: 'sk-still-there' }
    h.state.defaultChatModel = { provider: 'openai', model: 'gpt-4o' }
    renderStep()
    await enterAnthropicKey()
    expect(h.state.setSettings).not.toHaveBeenCalled()
  })

  it('with modelOnly, replaces a stale default model whose provider has no credentials', async () => {
    checkProviderKey.mockResolvedValue('ok')
    h.state.defaultChatModel = { provider: 'openai', model: 'gpt-5' }
    renderStep({ modelOnly: true })
    await enterAnthropicKey()
    expect(h.state.setSettings).toHaveBeenCalledWith({
      defaultChatModel: { provider: 'claude', model: 'claude-opus-4-1' },
    })
    expect(navigate).toHaveBeenCalledWith({ href: '/', replace: true })
  })

  it('checks Gemini with its first non-preview model and makes it the default', async () => {
    checkProviderKey.mockResolvedValue('ok')
    renderStep()
    fireEvent.click(radio(/I have a key/))
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'gemini' } })
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'AIza-test' } })
    await clickAndSettle(() => fireEvent.click(continueButton()))
    expect(checkProviderKey.mock.calls[0][1]).toBe('gemini-2.5-flash')
    expect(h.state.setSettings).toHaveBeenCalledWith({
      defaultChatModel: { provider: 'gemini', model: 'gemini-2.5-flash' },
    })
  })

  it('leaving an unfinished ChatGPT or Google choice restores the provider settings it seeded', () => {
    h.providers.openai = { models: [{ modelId: 'gpt-4o' }] }
    renderStep()
    fireEvent.click(radio(/Continue with ChatGPT/))
    fireEvent.click(radio(/Continue with Google/))
    expect(setterFor('openai')).toHaveBeenLastCalledWith({ authMode: undefined, models: [{ modelId: 'gpt-4o' }] })
    fireEvent.click(radio(/I have a key/))
    expect(setterFor('gemini')).toHaveBeenLastCalledWith({ authMode: undefined, models: undefined })
  })

  it('unmounting with an unfinished OAuth choice restores the provider, but not after sign-in', () => {
    const { unmount } = renderStep()
    fireEvent.click(radio(/Continue with Google/))
    unmount()
    expect(setterFor('gemini')).toHaveBeenLastCalledWith({ authMode: undefined, models: undefined })

    cleanup()
    const second = renderStep()
    fireEvent.click(radio(/Continue with ChatGPT/))
    const calls = setterFor('openai').mock.calls.length
    h.providers.openai = { ...CODEX_PATCH, oauth: { accessToken: 'tok' } }
    second.unmount()
    expect(setterFor('openai').mock.calls.length).toBe(calls)
  })

  it('changing the choice cancels a check in flight', async () => {
    let resolveCheck: (v: string) => void = () => {}
    checkProviderKey.mockImplementation(
      () =>
        new Promise((r) => {
          resolveCheck = r
        })
    )
    renderStep()
    await enterAnthropicKey()
    fireEvent.click(radio(/Continue with ChatGPT/))
    await clickAndSettle(() => resolveCheck('ok'))
    expect(setterFor('claude')).not.toHaveBeenCalled()
    expect(setFirstRun).not.toHaveBeenCalled()
    expect(h.state.setSettings).not.toHaveBeenCalled()
  })

  it('Continue keeps focus while the key is checked', async () => {
    checkProviderKey.mockImplementation(() => new Promise(() => {}))
    renderStep()
    fireEvent.click(radio(/I have a key/))
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-1' } })
    act(() => continueButton().focus())
    await clickAndSettle(() => fireEvent.click(continueButton()))
    expect(continueButton().disabled).toBe(false)
    expect(continueButton().getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(continueButton())
  })

  it('a key for a provider left in OAuth mode switches it back to the API key and its default models', async () => {
    checkProviderKey.mockResolvedValue('ok')
    h.providers.openai = CODEX_PATCH
    renderStep()
    fireEvent.click(radio(/I have a key/))
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-openai' } })
    await clickAndSettle(() => fireEvent.click(continueButton()))
    const saved = setterFor('openai').mock.calls.at(-1)?.[0] as ProviderSettings
    expect(saved.apiKey).toBe('sk-openai')
    expect(saved.authMode).toBe('api_key')
    expect(saved.models?.[0]?.modelId).not.toBe('gpt-5-codex')
    expect(checkProviderKey.mock.calls[0][1]).toBe(saved.models?.[0]?.modelId)
  })

  it('with modelOnly, Continue returns to from and does not change the step', async () => {
    checkProviderKey.mockResolvedValue('ok')
    renderStep({ modelOnly: true, from: '/session/s1?thread=t1' })
    await enterAnthropicKey()
    expect(navigate).toHaveBeenCalledWith({ href: '/session/s1?thread=t1', replace: true })
    expect(setFirstRun).not.toHaveBeenCalled()
  })

  it("with modelOnly and no from, Continue goes to '/'", () => {
    needEditSetting.mockReturnValue(false)
    renderStep({ modelOnly: true })
    fireEvent.click(radio(/Continue with ChatGPT/))
    fireEvent.click(continueButton())
    expect(navigate).toHaveBeenCalledWith({ href: '/', replace: true })
    expect(setFirstRun).not.toHaveBeenCalled()
  })
})
