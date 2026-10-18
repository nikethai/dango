// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import copyToClipboard from 'copy-to-clipboard'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WritingResult } from '@/packages/writing/rewrite'

vi.mock('@/hooks/useProviders', () => ({
  useProviders: () => ({
    providers: [
      { id: 'gemini', name: 'Gemini', models: [{ modelId: 'test-text' }] },
      { id: 'perplexity', name: 'Perplexity', models: [{ modelId: 'sonar-pro' }] },
    ],
  }),
}))
vi.mock('@/stores/lastUsedModelStore', () => ({
  lastUsedModelStore: { getState: () => ({}) },
}))
vi.mock('@/packages/writing/runtime', () => ({ requestWritingRewrite: vi.fn() }))
vi.mock('@/packages/writing/save', () => ({ saveWritingResult: vi.fn() }))
vi.mock('copy-to-clipboard', () => ({ default: vi.fn() }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars?.[name] ?? name)),
  }),
}))

import { requestWritingRewrite } from '@/packages/writing/runtime'
import { saveWritingResult } from '@/packages/writing/save'
import WritingAssistant from './WritingAssistant'

beforeEach(() => {
  vi.clearAllMocks()
  // JSDOM does not implement the scrolling API used by Mantine's model picker.
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  vi.mocked(copyToClipboard).mockReturnValue(true)
  vi.mocked(saveWritingResult).mockResolvedValue('saved-session')
  vi.mocked(requestWritingRewrite).mockImplementation(async (request) => ({
    request,
    text: 'I could not find the root cause.',
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function setup(initialDraft = 'I cannot found the root cause.', withModel = true) {
  const onConfigureProvider = vi.fn()
  const view = render(
    <MantineProvider>
      <WritingAssistant
        initialDraft={initialDraft}
        initialModel={withModel ? { provider: 'gemini', modelId: 'test-text' } : undefined}
        onConfigureProvider={onConfigureProvider}
      />
    </MantineProvider>
  )
  return { ...view, onConfigureProvider }
}

describe('writing assistant', () => {
  it('does not request, copy, or save anything merely by opening', () => {
    setup()
    expect(requestWritingRewrite).not.toHaveBeenCalled()
    expect(copyToClipboard).not.toHaveBeenCalled()
    expect(saveWritingResult).not.toHaveBeenCalled()
    expect(screen.getByText(/Your draft will be sent to Gemini/)).toBeTruthy()
  })

  it('requires an explicit model instead of silently selecting one', () => {
    setup(undefined, false)
    expect(screen.getByRole('button', { name: 'Improve writing' }).hasAttribute('disabled')).toBe(true)
    expect(requestWritingRewrite).not.toHaveBeenCalled()
  })

  it('rewrites, compares, copies, and saves only on explicit actions', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Improve writing' }))
    await screen.findByLabelText('Revised message')
    expect(requestWritingRewrite).toHaveBeenCalledWith(
      {
        draft: 'I cannot found the root cause.',
        style: 'clearer',
        model: { provider: 'gemini', modelId: 'test-text' },
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(saveWritingResult).not.toHaveBeenCalled()
    expect(copyToClipboard).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Copy revised message' }))
    expect(copyToClipboard).toHaveBeenCalledExactlyOnceWith('I could not find the root cause.')
    fireEvent.click(screen.getByRole('button', { name: 'Save to chat' }))
    await screen.findByRole('button', { name: 'Saved to chat' })
    expect(saveWritingResult).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Saved to chat' }).hasAttribute('disabled')).toBe(true)
  })

  it('lets the user select Perplexity and discloses that destination before rewriting', async () => {
    setup()
    fireEvent.click(screen.getByLabelText('Provider and model', { selector: 'input' }))
    fireEvent.click(await screen.findByRole('option', { name: 'sonar-pro' }))
    expect(screen.getByText(/Your draft will be sent to Perplexity/)).toBeTruthy()
    expect(requestWritingRewrite).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Improve writing' }))
    await screen.findByLabelText('Revised message')
    expect(vi.mocked(requestWritingRewrite).mock.calls[0][0].model).toEqual({
      provider: 'perplexity',
      modelId: 'sonar-pro',
    })
  })

  it('keeps an oversized pasted draft intact and blocks submission', () => {
    const draft = 'x'.repeat(8_001)
    setup(draft)
    expect((screen.getByLabelText('Your draft') as HTMLTextAreaElement).value).toBe(draft)
    expect(screen.getByRole('button', { name: 'Improve writing' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/Your draft has not been shortened/)).toBeTruthy()
  })

  it('keeps the original draft after an error and offers retry', async () => {
    vi.mocked(requestWritingRewrite).mockRejectedValue(new Error('PRIVATE_RESPONSE_BODY'))
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Improve writing' }))
    await screen.findByRole('alert')
    expect(screen.queryByText(/PRIVATE_RESPONSE_BODY/)).toBeNull()
    expect((screen.getByLabelText('Your draft') as HTMLTextAreaElement).value).toBe('I cannot found the root cause.')
    expect(screen.getByRole('button', { name: 'Improve writing' }).hasAttribute('disabled')).toBe(false)
  })

  it('invalidates a completed result when the draft changes', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Improve writing' }))
    await screen.findByLabelText('Revised message')
    fireEvent.change(screen.getByLabelText('Your draft'), { target: { value: 'Another draft' } })
    expect(screen.queryByLabelText('Revised message')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy revised message' })).toBeNull()
  })

  it('does not expose partial output as a copyable completed rewrite', async () => {
    let finish!: (value: WritingResult) => void
    const pending = new Promise<WritingResult>((resolve) => {
      finish = resolve
    })
    vi.mocked(requestWritingRewrite).mockImplementation((_request, { onText }) => {
      onText?.('Partial')
      return pending
    })
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Improve writing' }))
    await screen.findByLabelText('Rewrite in progress')
    expect(screen.queryByRole('button', { name: 'Copy revised message' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Stop rewriting' }))
    await act(async () => {
      finish({ request: vi.mocked(requestWritingRewrite).mock.calls[0][0], text: 'Late result' })
      await pending
    })
    expect(screen.queryByLabelText('Revised message')).toBeNull()
    expect(screen.getByText('Rewrite stopped. Your draft is unchanged.')).toBeTruthy()
  })

  it('reports clipboard failures without claiming success', async () => {
    vi.mocked(copyToClipboard).mockReturnValue(false)
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Improve writing' }))
    await screen.findByLabelText('Revised message')
    fireEvent.click(screen.getByRole('button', { name: 'Copy revised message' }))
    expect(screen.getByText(/Copy failed/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull()
  })

  it('supports the keyboard action but not during IME composition', async () => {
    setup()
    fireEvent.keyDown(screen.getByLabelText('Your draft'), { key: 'Enter', ctrlKey: true, isComposing: true })
    expect(requestWritingRewrite).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByLabelText('Your draft'), { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(requestWritingRewrite).toHaveBeenCalledTimes(1))
  })

  it('clears unsaved content by unmounting and starts fresh next time', async () => {
    const view = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Improve writing' }))
    await screen.findByLabelText('Revised message')
    view.unmount()
    setup('')
    expect((screen.getByLabelText('Your draft') as HTMLTextAreaElement).value).toBe('')
    expect(screen.queryByLabelText('Revised message')).toBeNull()
    expect(saveWritingResult).not.toHaveBeenCalled()
  })
})
