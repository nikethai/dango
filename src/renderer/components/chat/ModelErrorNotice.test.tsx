/**
 * @vitest-environment jsdom
 */

import type { Message } from '@shared/types'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The real Trans over an empty English instance: keys render as themselves, tags become the given components.
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  const { default: i18next } = await import('i18next')
  const i18n = i18next.createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } }, interpolation: { escapeValue: false } })
  return {
    useTranslation: () => ({
      t: (key: string, options?: Record<string, string | number>) =>
        key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(options?.[name] ?? '')),
    }),
    Trans: (props: Parameters<typeof actual.Trans>[0]) => <actual.Trans {...props} i18n={i18n} />,
  }
})

const navigateToSettings = vi.hoisted(() => vi.fn())
vi.mock('@/modals/Settings', () => ({ navigateToSettings }))
const retryFailedMessage = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/stores/session/retry', () => ({ retryFailedMessage }))
const startNewChatWithSummary = vi.hoisted(() => vi.fn(async () => 'new-1'))
vi.mock('@/stores/session/new-chat-with-summary', () => ({ startNewChatWithSummary }))
const copyToClipboard = vi.hoisted(() => vi.fn())
vi.mock('@/packages/navigator', () => ({ copyToClipboard }))
const rateLimit = vi.hoisted(() => ({
  pending: false,
  cancelRateLimitRetry: vi.fn(),
  clearRateLimitAttempts: vi.fn(),
}))
vi.mock('@/stores/session/rate-limit-retry', () => ({
  isRateLimitRetryPending: () => rateLimit.pending,
  subscribeRateLimitRetries: () => () => {},
  cancelRateLimitRetry: rateLimit.cancelRateLimitRetry,
  clearRateLimitAttempts: rateLimit.clearRateLimitAttempts,
}))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (s: { customProviders: unknown[] }) => unknown) => selector({ customProviders: [] }),
}))

import { ModelErrorNotice } from './ModelErrorNotice'

const failed = (extra: Partial<Message> = {}, errorExtra: Record<string, unknown> = {}): Message => ({
  id: 'a1',
  role: 'assistant',
  contentParts: [],
  aiProvider: 'openai',
  model: 'GPT-5',
  error: 'API Error: Error from OpenAI',
  errorCode: 10001,
  ...extra,
  errorExtra: { aiProvider: 'openai', ...errorExtra },
})

const cases: Array<{ name: string; msg: Message; sentence: string; button: string }> = [
  {
    name: 'invalid key',
    msg: failed({}, { status: 401, responseBody: '{"error":"invalid_api_key"}' }),
    sentence: 'Your OpenAI key was rejected.',
    button: 'Update key',
  },
  {
    name: 'out of credit',
    msg: failed({}, { status: 402, responseBody: 'Payment required' }),
    sentence: 'Your OpenAI account is out of credit.',
    button: 'Add credit',
  },
  {
    name: 'too long',
    msg: failed({}, { status: 400, responseBody: 'prompt is too long' }),
    sentence: 'This chat is too long for GPT-5.',
    button: 'Start a new chat with a summary',
  },
  {
    name: 'network',
    msg: failed({ error: 'Network Error: fetch failed', errorCode: 10002 }, { host: 'api.openai.com' }),
    sentence: "Couldn't reach api.openai.com.",
    button: 'Retry',
  },
  {
    name: 'provider',
    msg: failed({}, { status: 500, responseBody: 'Internal server error' }),
    sentence: 'OpenAI returned an error.',
    button: 'Retry',
  },
]

const primaryButtons = (container: HTMLElement) => Array.from(container.querySelectorAll('.dg-btn--primary'))

beforeEach(() => {
  navigateToSettings.mockClear()
  retryFailedMessage.mockClear()
  startNewChatWithSummary.mockClear()
  copyToClipboard.mockClear()
})
afterEach(cleanup)

describe('ModelErrorNotice', () => {
  it('is a Dango notice: its own classes, not the legacy msg-error card', () => {
    const { container } = render(<ModelErrorNotice msg={cases[0].msg} sessionId="s1" />)
    const notice = screen.getByRole('alert')
    expect(notice.className).toBe('dg-model-error')
    expect(container.querySelector('[class*="msg-error"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }))
    expect(container.querySelector('.dg-model-error__detail')?.textContent).toContain('invalid_api_key')
  })

  it("names the provider of the failed call (a Redo ▾ to another provider), not the chat's", () => {
    render(
      <ModelErrorNotice
        msg={failed({}, { aiProvider: 'claude', status: 401, responseBody: 'invalid x-api-key' })}
        sessionId="s1"
      />
    )
    expect(screen.getByText(/Your .* key was rejected\./).textContent).not.toContain('OpenAI')
    fireEvent.click(screen.getByRole('button', { name: 'Update key' }))
    expect(navigateToSettings).toHaveBeenCalledWith('/provider/claude')
  })

  for (const c of cases) {
    it(`${c.name}: the sentence and one button that names the fix`, () => {
      const { container } = render(<ModelErrorNotice msg={c.msg} sessionId="s1" />)
      expect(screen.getByText(c.sentence)).toBeTruthy()
      const primary = primaryButtons(container)
      expect(primary).toHaveLength(1)
      expect(primary[0].textContent).toBe(c.button)
      expect(container.textContent).not.toMatch(/something went wrong|sorry/i)
    })
  }

  it('Update key opens the provider settings', () => {
    render(<ModelErrorNotice msg={cases[0].msg} sessionId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Update key' }))
    expect(navigateToSettings).toHaveBeenCalledWith('/provider/openai')
  })

  it('Add credit opens the provider settings', () => {
    render(<ModelErrorNotice msg={cases[1].msg} sessionId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Add credit' }))
    expect(navigateToSettings).toHaveBeenCalledWith('/provider/openai')
  })

  it('Retry retries the failed answer', async () => {
    const msg = cases[4].msg
    render(<ModelErrorNotice msg={msg} sessionId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(retryFailedMessage).toHaveBeenCalledWith('s1', msg))
  })

  it('Start a new chat with a summary starts it from this chat', async () => {
    render(<ModelErrorNotice msg={cases[2].msg} sessionId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Start a new chat with a summary' }))
    await waitFor(() => expect(startNewChatWithSummary).toHaveBeenCalledWith('s1'))
  })

  it('keeps the raw detail behind Show details, with Copy', () => {
    render(<ModelErrorNotice msg={cases[4].msg} sessionId="s1" />)
    expect(screen.queryByText(/Internal server error/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }))
    expect(screen.getByText(/Internal server error/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(copyToClipboard).toHaveBeenCalledWith(expect.stringContaining('Internal server error'))
    fireEvent.click(screen.getByRole('button', { name: 'Hide details' }))
    expect(screen.queryByText(/Internal server error/)).toBeNull()
  })

  it('a failed plan run offers no Retry: Continue on the plan card is the fix', () => {
    const msg = failed(
      { contentParts: [{ type: 'plan', status: 'approved', steps: [] } as unknown as Message['contentParts'][number]] },
      { status: 500 }
    )
    const { container } = render(<ModelErrorNotice msg={msg} sessionId="s1" />)
    expect(screen.getByText('OpenAI returned an error.')).toBeTruthy()
    expect(primaryButtons(container)).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Show details' })).toBeTruthy()
  })

  it('a send blocked by the usage budget opens Usage and offers no Retry', () => {
    const msg = failed(
      {
        error: 'Send blocked: Monthly cap reached. Disable hard-stop in Settings → Usage, or raise your monthly cap.',
        errorCode: undefined,
      },
      { kind: 'budget' }
    )
    const { container } = render(<ModelErrorNotice msg={msg} sessionId="s1" />)
    expect(screen.getByText("You've reached your usage budget.")).toBeTruthy()
    expect(primaryButtons(container).map((b) => b.textContent)).toEqual(['Open Usage'])
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open Usage' }))
    expect(navigateToSettings).toHaveBeenCalledWith('/usage')
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }))
    expect(screen.getByText(/Send blocked: Monthly cap reached/)).toBeTruthy()
  })

  it('a model name is text, never markup, in a known Dango error', () => {
    // 20014 has component tags (Trans), 20022 has none (t).
    for (const errorCode of [20014, 20022]) {
      const { container } = render(
        <ModelErrorNotice msg={failed({ errorCode, model: '<strong>x</strong>' })} sessionId="s1" />
      )
      expect(container.querySelector('strong')).toBeNull()
      cleanup()
    }
    const { container } = render(
      <ModelErrorNotice msg={failed({ errorCode: 20022, model: '<strong>x</strong>' })} sessionId="s1" />
    )
    expect(container.textContent).toContain('<strong>x</strong>')
  })

  it('errors that would only repeat offer no Retry', () => {
    for (const errorCode of [10003, 10005, 20014, 20025]) {
      const { container } = render(<ModelErrorNotice msg={failed({ errorCode })} sessionId="s1" />)
      expect(primaryButtons(container)).toHaveLength(0)
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
      cleanup()
    }
  })

  it('renders nothing without an error', () => {
    const { container } = render(<ModelErrorNotice msg={failed({ error: undefined })} sessionId="s1" />)
    expect(container.textContent).toBe('')
  })
})

describe('ModelErrorNotice: rate limits (ER3)', () => {
  const limited = (errorExtra: Record<string, unknown> = {}) =>
    failed({}, { status: 429, responseBody: '{}', ...errorExtra })

  beforeEach(() => {
    rateLimit.pending = false
    rateLimit.cancelRateLimitRetry.mockClear()
    rateLimit.clearRateLimitAttempts.mockClear()
  })

  it('while a retry waits: the countdown and Retry now', async () => {
    rateLimit.pending = true
    const msg = limited({ rateLimitAttempt: 1, retryAt: Date.now() + 10_000 })
    const { container } = render(<ModelErrorNotice msg={msg} sessionId="s1" />)
    expect(screen.getByText('OpenAI is limiting requests. Trying again in 10 s.')).toBeTruthy()
    const buttons = primaryButtons(container)
    expect(buttons).toHaveLength(1)
    expect(buttons[0].textContent).toBe('Retry now')
    expect(container.textContent).not.toMatch(/returned an error/)
    fireEvent.click(buttons[0])
    expect(rateLimit.cancelRateLimitRetry).toHaveBeenCalledWith('s1')
    await waitFor(() => expect(retryFailedMessage).toHaveBeenCalledWith('s1', msg))
  })

  it('after the last retry: it waits in Review, and Retry starts the schedule again', async () => {
    const msg = limited({ rateLimitAttempt: 3, rateLimitGaveUp: true })
    const { container } = render(<ModelErrorNotice msg={msg} sessionId="s1" />)
    expect(screen.getByText("OpenAI is still limiting requests. It's waiting in Review.")).toBeTruthy()
    const buttons = primaryButtons(container)
    expect(buttons).toHaveLength(1)
    expect(buttons[0].textContent).toBe('Retry')
    fireEvent.click(buttons[0])
    expect(rateLimit.clearRateLimitAttempts).toHaveBeenCalledWith('a1')
    await waitFor(() => expect(retryFailedMessage).toHaveBeenCalledWith('s1', msg))
  })

  it('a retry cancelled by Stop or a new send shows no countdown, only Retry', () => {
    const msg = limited({ rateLimitAttempt: 1, retryAt: Date.now() + 10_000 })
    const { container } = render(<ModelErrorNotice msg={msg} sessionId="s1" />)
    expect(screen.getByText('OpenAI is limiting requests.')).toBeTruthy()
    expect(container.textContent).not.toMatch(/Trying again|returned an error/)
    expect(primaryButtons(container)[0].textContent).toBe('Retry')
  })
})
