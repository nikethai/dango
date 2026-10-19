// @vitest-environment jsdom
import { WritingError } from '@shared/types/writing'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('a rejected choice clears an in-flight run', async () => {
    let finish: (v: { request: never; text: string }) => void = () => {}
    vi.mocked(requestWritingRewrite).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve as typeof finish
        })
    )
    render(<RewritePanel {...base} />)
    await waitFor(() => expect(requestWritingRewrite).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))
    fireEvent.change(screen.getByLabelText('Translate to'), { target: { value: 'Eng!ish' } })
    fireEvent.keyDown(screen.getByLabelText('Translate to'), { key: 'Enter' })
    finish({ request: {} as never, text: 'STALE' })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(screen.queryByText('STALE')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull()
  })

  it('clearing the text removes the old result and its actions', async () => {
    render(<RewritePanel {...base} onUse={vi.fn()} />)
    await screen.findByRole('button', { name: 'Copy' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Text to rewrite' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clearer' }))
    expect(screen.queryByText('Could you send it?')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Use this' })).toBeNull()
  })

  it('over-limit text shows a hint, is invalid and never sends', () => {
    render(<RewritePanel {...base} text={'a'.repeat(8001)} option={null} />)
    const box = screen.getByRole('textbox', { name: 'Text to rewrite' })
    expect(box.getAttribute('aria-invalid')).toBe('true')
    const hint = document.getElementById(box.getAttribute('aria-describedby') ?? '')
    expect(hint?.textContent).toBe('Use up to 8,000 characters.')
    fireEvent.click(screen.getByRole('button', { name: 'Clearer' }))
    expect(requestWritingRewrite).not.toHaveBeenCalled()
  })

  it('editing to valid text clears the invalid mark', () => {
    render(<RewritePanel {...base} text="" option={null} />)
    const box = screen.getByRole('textbox', { name: 'Text to rewrite' })
    fireEvent.click(screen.getByRole('button', { name: 'Clearer' }))
    expect(box.getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(box, { target: { value: 'hello' } })
    expect(box.getAttribute('aria-invalid')).toBeNull()
    expect(requestWritingRewrite).not.toHaveBeenCalled()
  })

  it('Try again while running sends once more and only the latest result shows', async () => {
    const resolvers: Array<(v: { request: never; text: string }) => void> = []
    vi.mocked(requestWritingRewrite).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve)
        })
    )
    vi.mocked(requestWritingRewrite).mockRejectedValueOnce(new WritingError('timeout'))
    render(<RewritePanel {...base} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(requestWritingRewrite).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Clearer' }))
    await waitFor(() => expect(requestWritingRewrite).toHaveBeenCalledTimes(3))
    resolvers[0]({ request: {} as never, text: 'OLD' })
    resolvers[1]({ request: {} as never, text: 'NEW' })
    expect(await screen.findByText('NEW')).toBeTruthy()
    expect(screen.queryByText('OLD')).toBeNull()
  })

  it('Escape is prevented, and ignored while composing', () => {
    const onBack = vi.fn()
    render(<RewritePanel {...base} option={null} onBack={onBack} />)
    const box = screen.getByRole('textbox', { name: 'Text to rewrite' })
    expect(fireEvent.keyDown(box, { key: 'Escape' })).toBe(false)
    fireEvent.keyDown(box, { key: 'Escape', isComposing: true })
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('editing the textarea does not start a run', () => {
    render(<RewritePanel {...base} option={null} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Text to rewrite' }), { target: { value: 'new' } })
    expect(requestWritingRewrite).not.toHaveBeenCalled()
  })

  it('Copy shows Copied', async () => {
    render(<RewritePanel {...base} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Copy' }))
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
  })

  it('saves the target on a valid run and not on an invalid one', async () => {
    render(<RewritePanel {...base} option={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))
    await waitFor(() => expect(localStorage.getItem(TRANSLATE_TARGET_KEY)).toBe('English'))
    const input = screen.getByLabelText('Translate to')
    fireEvent.change(input, { target: { value: 'Spanish' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(localStorage.getItem(TRANSLATE_TARGET_KEY)).toBe('Spanish'))
    fireEvent.change(input, { target: { value: 'Bad! target' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(localStorage.getItem(TRANSLATE_TARGET_KEY)).toBe('Spanish')
  })

  it('no model shows the Choose a model fix without calling the runtime', () => {
    render(<RewritePanel {...base} model={undefined} />)
    expect(screen.getByText("This model can't rewrite text.")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Choose a model' })).toBeTruthy()
    expect(requestWritingRewrite).not.toHaveBeenCalled()
  })

  it.each([
    ['incomplete', 'The model stopped before finishing.'],
    ['timeout', 'The rewrite took over a minute and was stopped.'],
  ] as const)('%s copy with Try again', async (code, copy) => {
    vi.mocked(requestWritingRewrite).mockRejectedValueOnce(new WritingError(code))
    render(<RewritePanel {...base} />)
    expect(await screen.findByText(copy)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})
