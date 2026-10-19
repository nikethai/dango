/**
 * @vitest-environment jsdom
 */

import type { Message } from '@shared/types'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string | number>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(options?.[name] ?? '')),
  }),
  Trans: (props: { i18nKey: string }) => <>{props.i18nKey}</>,
}))

const navigateToSettings = vi.hoisted(() => vi.fn())
vi.mock('@/modals/Settings', () => ({ navigateToSettings }))
const retryFailedMessage = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/stores/session/retry', () => ({ retryFailedMessage }))
const startNewChatWithSummary = vi.hoisted(() => vi.fn(async () => 'new-1'))
vi.mock('@/stores/session/new-chat-with-summary', () => ({ startNewChatWithSummary }))
const copyToClipboard = vi.hoisted(() => vi.fn())
vi.mock('@/packages/navigator', () => ({ copyToClipboard }))
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

  it('renders nothing without an error', () => {
    const { container } = render(<ModelErrorNotice msg={failed({ error: undefined })} sessionId="s1" />)
    expect(container.textContent).toBe('')
  })
})
