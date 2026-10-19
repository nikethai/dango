/**
 * @vitest-environment jsdom
 */

import { createMessage, type Message } from '@shared/types'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createInstance } from 'i18next'
import { useState } from 'react'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/i18n/locales/en/translation.json'

const h = vi.hoisted(() => ({ openLink: vi.fn(() => Promise.resolve()) }))
vi.mock('@/platform', () => ({ default: { openLink: h.openLink } }))
vi.mock('@/modals/Settings', () => ({ navigateToSettings: vi.fn() }))
vi.mock('@/packages/writing/runtime', () => ({ requestWritingRewrite: vi.fn() }))
vi.mock('@/components/Markdown', () => ({
  // Stands in for rendering: emphasis markers do not reach the DOM.
  default: ({ children }: { children: string }) =>
    children.startsWith('<') ? (
      // biome-ignore lint/security/noDangerouslySetInnerHtml: test stand-in for rendered Markdown
      <div data-testid="markdown" dangerouslySetInnerHTML={{ __html: children }} />
    ) : (
      <div data-testid="markdown">{children.replace(/\*\*/g, '')}</div>
    ),
}))

import { QuickChatPanel, type QuickChatPanelProps, usedKnowledgeCount } from './index'

beforeAll(async () => {
  await createInstance()
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
})

beforeEach(() => {
  vi.clearAllMocks()
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
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.getSelection()?.removeAllRanges()
})

const scopes = [
  { id: 'acme', name: 'Acme Co', kind: 'client' as const },
  { id: 'dango', name: 'Dango app' },
  { id: 'everywhere', name: 'Everywhere' },
]

function props(overrides: Partial<QuickChatPanelProps> = {}): QuickChatPanelProps {
  return {
    view: 'empty',
    scopes,
    scopeId: 'acme',
    onScopeChange: vi.fn(),
    question: '',
    onQuestionChange: vi.fn(),
    onSubmit: vi.fn(),
    answer: undefined,
    generating: false,
    modelName: 'GPT-5',
    pictureCount: 0,
    rewrite: null,
    onRewrite: vi.fn(),
    onRewriteBack: vi.fn(),
    onEsc: vi.fn(),
    onRetry: vi.fn(),
    onContinue: vi.fn(),
    onSignIn: vi.fn(),
    windowed: true,
    ...overrides,
  }
}

function answer(text: string, extra: Partial<Message> = {}): Message {
  return { ...createMessage('assistant', text), ...extra }
}

function citations(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    index: i + 1,
    url: `https://example.com/${i + 1}`,
    title: `Source ${i + 1}`,
    source: 'builtin' as const,
    accessedAt: 0,
  }))
}

describe('QuickChatPanel', () => {
  it('QC1: empty view shows the input, the scope and the foot', () => {
    const { container } = render(<QuickChatPanel {...props()} />)
    const input = screen.getByRole('textbox', { name: 'Ask anything' })
    expect(input.tagName).toBe('TEXTAREA')
    expect(input.getAttribute('placeholder')).toBe('Ask anything')
    expect(screen.getByRole('button', { name: 'Scope: Acme Co' }).textContent).toContain('Acme Co')
    const foot = container.querySelector('.dg-qc__foot') as HTMLElement
    expect(foot.hasAttribute('data-tauri-drag-region')).toBe(true)
    expect(within(foot).getByText('Esc').className).toContain('dg-kbd')
    expect(within(foot).getByRole('button', { name: 'Rewrite' })).toBeTruthy()
    const cont = within(foot).getByRole('button', { name: 'Continue in Chat' }) as HTMLButtonElement
    expect(cont.disabled).toBe(true)
    expect(container.querySelector('.dg.dg-qc.dg-qc--window')).toBeTruthy()
  })

  it('answered with chips', () => {
    const msg = answer('The answer', { citations: citations(5), knowledgeIds: ['k1'] })
    expect(usedKnowledgeCount(msg)).toBe(1)
    expect(usedKnowledgeCount(answer('x'))).toBe(0)
    render(<QuickChatPanel {...props({ view: 'answered', answer: msg, question: 'What now?' })} />)
    for (const n of [1, 2, 3, 4]) expect(screen.getByRole('button', { name: `Source ${n}` })).toBeTruthy()
    expect(screen.queryByText('Source 5')).toBeNull()
    expect(screen.getByText('+1')).toBeTruthy()
    expect(screen.getByText('From approved knowledge').className).toContain('dg-chip--green')
    fireEvent.click(screen.getByRole('button', { name: 'Source 2' }))
    expect(h.openLink).toHaveBeenCalledWith('https://example.com/2')
    expect((screen.getByRole('button', { name: 'Continue in Chat' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('citation chips only open http(s) links', () => {
    const bad = [{ ...citations(1)[0], url: 'javascript:alert(1)', title: 'Bad' }]
    render(<QuickChatPanel {...props({ view: 'answered', answer: answer('x', { citations: bad }) })} />)
    expect(screen.queryByRole('button', { name: 'Bad' })).toBeNull()
    fireEvent.click(screen.getByText('Bad'))
    expect(h.openLink).not.toHaveBeenCalled()
  })

  it('QC2: offline view', () => {
    const p = props({ view: 'offline', modelName: 'GPT-5' })
    render(<QuickChatPanel {...p} />)
    expect(screen.getByText("You're offline. GPT-5 needs a connection to answer.")).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(p.onRetry).toHaveBeenCalledTimes(1)
  })

  it('no model shows only sign in', () => {
    const p = props({ view: 'no-model' })
    render(<QuickChatPanel {...p} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].textContent).toBe('Sign in to a model')
    expect(buttons[0].className).toContain('dg-btn--primary')
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(buttons[0])
    expect(p.onSignIn).toHaveBeenCalledTimes(1)
  })

  it('Rewrite uses the selection', () => {
    const p = props({ view: 'answered', answer: answer('Selected answer text'), question: 'pasted text' })
    const { rerender } = render(<QuickChatPanel {...p} />)
    const range = document.createRange()
    range.selectNodeContents(screen.getByText('Selected answer text'))
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    const rewrite = screen.getByRole('button', { name: 'Rewrite' })
    fireEvent.pointerDown(rewrite)
    fireEvent.mouseDown(rewrite)
    window.getSelection()?.removeAllRanges() // a click on a button can clear the selection
    fireEvent.click(rewrite)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Formal' }))
    expect(p.onRewrite).toHaveBeenCalledWith('formal', 'Selected answer text')

    rerender(<QuickChatPanel {...p} />)
    fireEvent.pointerDown(rewrite)
    fireEvent.mouseDown(rewrite)
    fireEvent.click(rewrite)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Formal' }))
    expect(p.onRewrite).toHaveBeenLastCalledWith('formal', 'pasted text')
  })

  it('Rewrite reads the selection on keyboard activation', () => {
    const p = props({ view: 'answered', answer: answer('Keyboard text'), question: 'q' })
    render(<QuickChatPanel {...p} />)
    const range = document.createRange()
    range.selectNodeContents(screen.getByText('Keyboard text'))
    window.getSelection()?.addRange(range)
    const rewrite = screen.getByRole('button', { name: 'Rewrite' })
    fireEvent.keyDown(rewrite, { key: 'ArrowDown' })
    const items = screen.getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['Clearer', 'Friendlier', 'Shorter', 'Formal', 'Translate'])
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(items[0], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[4])
    fireEvent.click(items[1])
    expect(p.onRewrite).toHaveBeenCalledWith('friendlier', 'Keyboard text')
    expect(document.activeElement).toBe(rewrite)
  })

  it('Escape', () => {
    const p = props()
    render(<QuickChatPanel {...p} />)
    const rewrite = screen.getByRole('button', { name: 'Rewrite' })
    fireEvent.click(rewrite)
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0], { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(p.onEsc).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(rewrite)
    fireEvent.keyDown(rewrite, { key: 'Escape' })
    expect(p.onEsc).toHaveBeenCalledTimes(1)
  })

  it('skips an Escape another handler already took', () => {
    const p = props()
    render(<QuickChatPanel {...p} />)
    const input = screen.getByRole('textbox', { name: 'Ask anything' })
    input.addEventListener('keydown', (event) => event.preventDefault())
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(p.onEsc).not.toHaveBeenCalled()
  })

  it('Enter submits, Shift+Enter does not', () => {
    const p = props({ question: 'Hi' })
    render(<QuickChatPanel {...p} />)
    const input = screen.getByRole('textbox', { name: 'Ask anything' })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(p.onSubmit).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(p.onSubmit).toHaveBeenCalledTimes(1)
    fireEvent.change(input, { target: { value: 'Hi there' } })
    expect(p.onQuestionChange).toHaveBeenCalledWith('Hi there')
  })

  it('shows the picture count', () => {
    render(<QuickChatPanel {...props({ pictureCount: 2 })} />)
    expect(screen.getByText('2 images')).toBeTruthy()
    cleanup()
    render(<QuickChatPanel {...props({ pictureCount: 1 })} />)
    expect(screen.getByText('1 image')).toBeTruthy()
  })

  it('scope menu: None first, Everywhere hidden, client chip', () => {
    const p = props({ scopeId: null })
    render(<QuickChatPanel {...p} />)
    const pill = screen.getByRole('button', { name: 'Scope: None' })
    expect(pill.textContent).toBe('No scope')
    fireEvent.click(pill)
    const items = screen.getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['None', 'Acme Coclient', 'Dango app'])
    fireEvent.click(items[1])
    expect(p.onScopeChange).toHaveBeenCalledWith('acme')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('before the first token: one live thinking line with the only mascot', () => {
    const { container } = render(
      <QuickChatPanel
        {...props({ view: 'answered', generating: true, answer: answer(''), askedQuestion: 'Why?', question: '' })}
      />
    )
    expect(container.querySelectorAll('svg.dg-mascot')).toHaveLength(1)
    expect(container.querySelector('.dg-think__title')?.textContent).toBe('Thinking')
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
    expect(container.querySelector('.dg-qc__body p')?.textContent).toBe('Why?')
  })

  it('announces the finished answer once', () => {
    const p = props({ view: 'answered', generating: true, answer: answer('Part', { id: 'a1' }), question: 'q' })
    const { rerender, container } = render(<QuickChatPanel {...p} />)
    const live = () => container.querySelector('[data-quick-answer-live]')?.textContent ?? ''
    expect(live()).toBe('')
    rerender(<QuickChatPanel {...p} answer={answer('Part and more', { id: 'a1' })} />)
    expect(live()).toBe('')
    const done = answer('Part and more, done.', { id: 'a1' })
    act(() => rerender(<QuickChatPanel {...p} generating={false} answer={done} />))
    expect(live()).toBe('Part and more, done.')
  })

  it('rewrite view hosts the RewritePanel', () => {
    const p = props({ view: 'rewrite', rewrite: { option: null, text: 'draft' } })
    render(<QuickChatPanel {...p} />)
    expect((screen.getByRole('textbox', { name: 'Text to rewrite' }) as HTMLTextAreaElement).value).toBe('draft')
  })

  it('reports the open menu through the measured root', () => {
    const { container } = render(<QuickChatPanel {...props()} />)
    const root = container.querySelector('.dg-qc') as HTMLElement
    fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }))
    expect(root.contains(screen.getByRole('menu'))).toBe(true)
    expect(root.dataset.menuOpen).toBe('true')
  })
  it('IME composition never submits or closes', () => {
    const p = props({ question: 'Hi' })
    render(<QuickChatPanel {...p} />)
    const input = screen.getByRole('textbox', { name: 'Ask anything' })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(p.onSubmit).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Escape', keyCode: 229 })
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true })
    expect(p.onEsc).not.toHaveBeenCalled()
  })

  it('Enter on a blank question is ignored', () => {
    const p = props({ question: '   ' })
    render(<QuickChatPanel {...p} />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Ask anything' }), { key: 'Enter' })
    expect(p.onSubmit).not.toHaveBeenCalled()
  })

  it('Enter with a blank question but a captured picture submits', () => {
    const p = props({ question: '', pictureCount: 1 })
    render(<QuickChatPanel {...p} />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Ask anything' }), { key: 'Enter' })
    expect(p.onSubmit).toHaveBeenCalledTimes(1)
  })

  it('the asked question comes from the prop, else the last submit, never the live input', () => {
    const p = props({ view: 'answered', answer: answer('A'), question: 'typing a follow-up' })
    const { container, rerender } = render(<QuickChatPanel {...p} />)
    const asked = () => container.querySelector('.dg-qc__body p')?.textContent ?? null
    expect(asked()).toBeNull()
    rerender(<QuickChatPanel {...p} question="First question" />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Ask anything' }), { key: 'Enter' })
    rerender(<QuickChatPanel {...p} question="" />)
    expect(asked()).toBe('First question')
    rerender(<QuickChatPanel {...p} question="" askedQuestion="From the session" />)
    expect(asked()).toBe('From the session')
  })

  it('announces plain text, and the error for an errored answer', () => {
    const p = props({ view: 'answered', generating: true, answer: answer('', { id: 'a2' }), question: 'q' })
    const { rerender, container } = render(<QuickChatPanel {...p} />)
    const live = () => container.querySelector('[data-quick-answer-live]')?.textContent ?? ''
    act(() => rerender(<QuickChatPanel {...p} generating={false} answer={answer('It is **bold**.', { id: 'a2' })} />))
    expect(live()).toBe('It is bold.')
    act(() => rerender(<QuickChatPanel {...p} answer={answer('', { id: 'a3' })} />))
    act(() =>
      rerender(<QuickChatPanel {...p} generating={false} answer={answer('', { id: 'a3', error: 'Rate limited' })} />)
    )
    expect(live()).toBe('Rate limited')
  })

  it('Rewrite is disabled in the rewrite view', () => {
    render(<QuickChatPanel {...props({ view: 'rewrite', rewrite: { option: null, text: 'draft' } })} />)
    expect((screen.getByRole('button', { name: 'Rewrite' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('menu keys: Home, End, Tab and a click outside', () => {
    render(<QuickChatPanel {...props()} />)
    const rewrite = screen.getByRole('button', { name: 'Rewrite' })
    fireEvent.click(rewrite)
    let items = screen.getAllByRole('menuitem')
    fireEvent.keyDown(items[0], { key: 'End' })
    expect(document.activeElement).toBe(items[4])
    fireEvent.keyDown(items[4], { key: 'Home' })
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(items[0], { key: 'Tab' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(rewrite)
    items = screen.getAllByRole('menuitem')
    fireEvent.pointerDown(screen.getByRole('textbox', { name: 'Ask anything' }))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('re-measures the open menu when the panel content moves', () => {
    const observers: Array<() => void> = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          observers.push(callback)
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    let menuBottom = 300
    const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 0, width: 0, height: 0 }) as DOMRect
    const original = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.getAttribute('role') === 'menu') return rect(menuBottom - 200, menuBottom)
      if (this.classList.contains('dg-qc')) return rect(100, 250)
      return original.call(this)
    }
    try {
      const { container } = render(<QuickChatPanel {...props()} />)
      const root = container.querySelector('.dg-qc') as HTMLElement
      fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }))
      expect(root.style.minHeight).toBe('208px')
      menuBottom = 400
      act(() => {
        for (const callback of observers) callback()
      })
      expect(root.style.minHeight).toBe('308px')
      fireEvent.keyDown(screen.getAllByRole('menuitem')[0], { key: 'Escape' })
      expect(root.style.minHeight).toBe('')
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original
    }
  })
  it('announces block text with separators and skips MathML', () => {
    const p = props({ view: 'answered', generating: true, answer: answer('', { id: 'a4' }), question: 'q' })
    const { rerender, container } = render(<QuickChatPanel {...p} />)
    const html = '<h2>Steps</h2><p>First</p><ul><li>a</li><li>b</li></ul><p><span class="katex-mathml">x</span>y</p>'
    act(() => rerender(<QuickChatPanel {...p} generating={false} answer={answer(html, { id: 'a4' })} />))
    expect(container.querySelector('[data-quick-answer-live]')?.textContent).toBe('Steps\nFirst\na\nb\ny')
  })

  for (const how of ['mouse', 'keyboard'] as const) {
    it(`choosing a rewrite option moves focus into the rewrite view (${how}), and Esc goes back`, () => {
      const onEsc = vi.fn()
      const onRewriteBack = vi.fn()
      function Harness() {
        const [rewrite, setRewrite] = useState<QuickChatPanelProps['rewrite']>(null)
        return (
          <QuickChatPanel
            {...props({ question: 'pasted text', onEsc, onRewriteBack })}
            view={rewrite ? 'rewrite' : 'empty'}
            rewrite={rewrite}
            onRewrite={(option, text) => setRewrite({ option, text })}
          />
        )
      }
      render(<Harness />)
      const trigger = screen.getByRole('button', { name: 'Rewrite' })
      if (how === 'mouse') {
        fireEvent.click(trigger)
        fireEvent.click(screen.getByRole('menuitem', { name: 'Formal' }))
      } else {
        fireEvent.keyDown(trigger, { key: 'ArrowDown' })
        const formal = screen.getByRole('menuitem', { name: 'Formal' })
        fireEvent.keyDown(document.activeElement as Element, { key: 'End' })
        fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' })
        expect(document.activeElement).toBe(formal)
        fireEvent.click(formal)
      }
      const textarea = screen.getByRole('textbox', { name: 'Text to rewrite' })
      expect(document.activeElement).toBe(textarea)
      fireEvent.keyDown(textarea, { key: 'Escape' })
      expect(onRewriteBack).toHaveBeenCalledTimes(1)
      expect(onEsc).not.toHaveBeenCalled()
    })
  }

  it('Esc in the rewrite view outside the RewritePanel goes back, not away', () => {
    const p = props({ view: 'rewrite', rewrite: { option: null, text: 'draft' } })
    render(<QuickChatPanel {...p} />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Ask anything' }), { key: 'Escape' })
    expect(p.onRewriteBack).toHaveBeenCalledTimes(1)
    expect(p.onEsc).not.toHaveBeenCalled()
  })
})
