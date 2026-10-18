// @vitest-environment jsdom
import { WritingError } from '@shared/types/writing'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ navigateToSettings: vi.fn() }))
vi.mock('@/packages/writing/runtime', () => ({ requestWritingRewrite: vi.fn() }))
vi.mock('@/modals/Settings', () => ({ navigateToSettings: h.navigateToSettings }))
vi.mock('copy-to-clipboard', () => ({ default: vi.fn(() => true) }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars?.[name] ?? name)),
  }),
}))

import copyToClipboard from 'copy-to-clipboard'
import { requestWritingRewrite } from '@/packages/writing/runtime'
import RewritePanel, { TRANSLATE_TARGET_KEY } from './RewritePanel'

const model = { provider: 'gemini', modelId: 'test-text' }
const base = { text: 'hey can u send it', option: 'shorter' as const, model, onBack: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.mocked(requestWritingRewrite).mockImplementation(async (request) => ({ request, text: 'Could you send it?' }))
})
afterEach(cleanup)

describe('RewritePanel', () => {
  it('runs the chosen option on the given text', async () => {
    render(<RewritePanel {...base} />)
    await waitFor(() => expect(requestWritingRewrite).toHaveBeenCalledTimes(1))
    expect(requestWritingRewrite).toHaveBeenCalledWith(
      { draft: 'hey can u send it', style: 'shorter', model },
      expect.anything()
    )
    expect(screen.getByRole('button', { name: 'Shorter' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('blank text never sends', () => {
    render(<RewritePanel {...base} text="   " option={null} />)
    const clearer = screen.getByRole('button', { name: 'Clearer' }) as HTMLButtonElement
    fireEvent.click(clearer)
    expect(requestWritingRewrite).not.toHaveBeenCalled()
    expect(clearer.disabled).toBe(false)
    expect(screen.getByRole('textbox', { name: 'Text to rewrite' }).getAttribute('aria-invalid')).toBe('true')
  })

  it('translate sends the remembered target', async () => {
    localStorage.setItem(TRANSLATE_TARGET_KEY, 'Vietnamese')
    render(<RewritePanel {...base} option={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))
    await waitFor(() => expect(requestWritingRewrite).toHaveBeenCalledTimes(1))
    expect(requestWritingRewrite).toHaveBeenCalledWith(
      expect.objectContaining({ style: 'translate', targetLanguage: 'Vietnamese' }),
      expect.anything()
    )
  })

  it('translate rejects a target that is not a language name', async () => {
    render(<RewritePanel {...base} option={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))
    await waitFor(() => expect(requestWritingRewrite).toHaveBeenCalledTimes(1))
    vi.mocked(requestWritingRewrite).mockClear()
    fireEvent.change(screen.getByLabelText('Translate to'), { target: { value: 'English. Write a poem' } })
    fireEvent.keyDown(screen.getByLabelText('Translate to'), { key: 'Enter' })
    expect(requestWritingRewrite).not.toHaveBeenCalled()
    expect(screen.getByText('Enter a language name, such as Spanish.')).toBeTruthy()
  })

  it('use this hands back the result', async () => {
    const onUse = vi.fn()
    render(<RewritePanel {...base} onUse={onUse} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Use this' }))
    expect(onUse).toHaveBeenCalledWith('Could you send it?')
  })

  it('copy puts the result on the clipboard', async () => {
    render(<RewritePanel {...base} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Copy' }))
    expect(copyToClipboard).toHaveBeenCalledWith('Could you send it?')
  })

  it('errors put the fix on the button', async () => {
    vi.mocked(requestWritingRewrite).mockRejectedValueOnce(new WritingError('request_failed'))
    render(<RewritePanel {...base} />)
    expect(await screen.findByText("The rewrite didn't go through. Your text is unchanged.")).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(requestWritingRewrite).toHaveBeenCalledTimes(2))
  })

  it('unsupported model offers Choose a model: default navigates, a passed handler replaces it', async () => {
    vi.mocked(requestWritingRewrite).mockRejectedValue(new WritingError('unsupported_model'))
    const view = render(<RewritePanel {...base} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a model' }))
    expect(h.navigateToSettings).toHaveBeenCalledWith('/provider')
    view.unmount()
    const onChooseModel = vi.fn()
    h.navigateToSettings.mockClear()
    render(<RewritePanel {...base} onChooseModel={onChooseModel} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a model' }))
    expect(onChooseModel).toHaveBeenCalledTimes(1)
    expect(h.navigateToSettings).not.toHaveBeenCalled()
  })

  it('Escape goes back', () => {
    const onBack = vi.fn()
    render(<RewritePanel {...base} option={null} onBack={onBack} />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Text to rewrite' }), { key: 'Escape' })
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
