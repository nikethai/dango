// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { GEMINI_ANTIGRAVITY_DEFAULT_MODELS, OPENAI_CODEX_DEFAULT_MODELS } from '@shared/providers/oauth'
import type { ProviderSettings } from '@shared/types'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDangoMantineTheme } from '@/theme/mantineTheme'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/platform', () => ({ default: { openLink: vi.fn() } }))
vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))
vi.mock('@/utils/oauth-local-callback', () => ({
  cancelLocalOAuthCallback: vi.fn(async () => {}),
  canUseLocalOAuthCallback: () => true,
  waitForLocalOAuthCallback: vi.fn(),
}))

import { GeminiAntigravityAuthSection, geminiAntigravityOAuthModePatch } from './GeminiAntigravityAuthSection'
import { OpenAICodexAuthSection, openAICodexOAuthModePatch } from './OpenAICodexAuthSection'

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

afterEach(cleanup)

function renderIn(node: React.ReactNode) {
  return render(<MantineProvider theme={createDangoMantineTheme()}>{node}</MantineProvider>)
}

describe('openAICodexOAuthModePatch', () => {
  it('seeds the Codex models when the list is empty', () => {
    expect(openAICodexOAuthModePatch(undefined)).toEqual({ authMode: 'oauth', models: OPENAI_CODEX_DEFAULT_MODELS })
  })

  it('replaces an API catalog list', () => {
    const ps = { models: [{ modelId: 'gpt-4o' }] } as ProviderSettings
    expect(openAICodexOAuthModePatch(ps)).toEqual({ authMode: 'oauth', models: OPENAI_CODEX_DEFAULT_MODELS })
  })

  it('keeps a list that is not the API catalog', () => {
    const ps = { models: [{ modelId: 'gpt-5-codex' }] } as ProviderSettings
    expect(openAICodexOAuthModePatch(ps)).toEqual({ authMode: 'oauth' })
  })
})

describe('geminiAntigravityOAuthModePatch', () => {
  it('always seeds a fresh copy of the Antigravity models', () => {
    const patch = geminiAntigravityOAuthModePatch()
    expect(patch.authMode).toBe('oauth')
    expect(patch.models).toEqual(GEMINI_ANTIGRAVITY_DEFAULT_MODELS)
    expect(patch.models?.[0]).not.toBe(GEMINI_ANTIGRAVITY_DEFAULT_MODELS[0])
  })
})

describe('hideModeSwitch', () => {
  const oauth = { authMode: 'oauth' } as ProviderSettings

  it('OpenAI: shows "How do you connect?" by default and hides only that row', () => {
    const { rerender } = renderIn(<OpenAICodexAuthSection providerSettings={oauth} setProviderSettings={() => {}} />)
    expect(screen.queryByText('How do you connect?')).toBeTruthy()
    rerender(
      <MantineProvider theme={createDangoMantineTheme()}>
        <OpenAICodexAuthSection providerSettings={oauth} setProviderSettings={() => {}} hideModeSwitch />
      </MantineProvider>
    )
    expect(screen.queryByText('How do you connect?')).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign in with ChatGPT' })).toBeTruthy()
  })

  it('Gemini: hides the switch row but keeps the experimental risk notice and its checkbox', () => {
    renderIn(<GeminiAntigravityAuthSection providerSettings={oauth} setProviderSettings={() => {}} hideModeSwitch />)
    expect(screen.queryByText('How do you connect?')).toBeNull()
    expect(screen.getByText('Experimental · account risk')).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'I understand the risk and want to continue' })).toBeTruthy()
  })

  it('Gemini: shows the switch row by default', () => {
    renderIn(<GeminiAntigravityAuthSection providerSettings={oauth} setProviderSettings={() => {}} />)
    expect(screen.getByText('How do you connect?')).toBeTruthy()
  })
})
