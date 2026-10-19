import type { Message } from '@shared/types'
import type { WritingModel, WritingStyle } from '@shared/types/writing'
import { getMessageText } from '@shared/utils/message'
import { ChevronDown } from 'lucide-react'
import {
  type ForwardedRef,
  forwardRef,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { ThinkingLine } from '@/components/chat/ThinkingLine'
import Markdown from '@/components/Markdown'
import { REWRITE_OPTIONS, RewritePanel } from '@/components/rewrite'
import { QuickMenu } from './QuickMenu'
import { type QuickScope, QuickScopePill } from './QuickScopePill'
import { QuickSourceChips } from './QuickSourceChips'
import type { QuickView } from './quickChatState'

export type QuickChatPanelProps = {
  view: QuickView
  scopes: QuickScope[]
  scopeId: string | null
  onScopeChange: (id: string | null) => void
  question: string
  /** The question the shown answer replies to (the chat's last user message). Never the live input. */
  askedQuestion?: string
  onQuestionChange: (v: string) => void
  onSubmit: () => void
  answer?: Message
  generating: boolean
  /** Stops the running answer (Stop on the live thinking line, then in the foot while the answer streams). */
  onStop?: () => void
  /** Changes on every show; the input then takes focus unless the rewrite view is open. */
  focusKey?: number
  modelName: string
  pictureCount: number
  rewrite: { option: WritingStyle | null; text: string } | null
  onRewrite: (option: WritingStyle, text: string) => void
  onRewriteBack: () => void
  onEsc: () => void
  onRetry: () => void
  onContinue: () => void
  /** "Sign in to a model" and RewritePanel's "Choose a model". The panel never navigates by itself. */
  onSignIn: () => void
  model?: WritingModel
  windowed: boolean
}

type OpenMenu = 'scope' | 'rewrite' | null

/** Room left under an open menu, so its shadow is not cut by the window edge. */
const MENU_BOTTOM_GAP = 8
const INPUT_MAX_HEIGHT = 160

/**
 * The Quick Chat panel. The forwarded ref is the `.dg-qc` root: while a menu is open the root's min-height grows to
 * the menu's bottom, so a ResizeObserver on it reports max(panel height, menu bottom) for the quick window.
 */
export const QuickChatPanel = forwardRef(function QuickChatPanel(
  props: QuickChatPanelProps,
  ref: ForwardedRef<HTMLDivElement>
) {
  const {
    view,
    scopes,
    scopeId,
    onScopeChange,
    question,
    askedQuestion,
    onQuestionChange,
    onSubmit,
    answer,
    generating,
    onStop,
    focusKey,
    modelName,
    pictureCount,
    rewrite,
    onRewrite,
    onRewriteBack,
    onEsc,
    onRetry,
    onContinue,
    onSignIn,
    model,
    windowed,
  } = props
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const answerRef = useRef<HTMLDivElement>(null)
  const rewriteTriggerRef = useRef<HTMLButtonElement>(null)
  const rewriteTriggerId = useId()
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const [menuMinHeight, setMenuMinHeight] = useState<number | undefined>(undefined)
  const [asked, setAsked] = useState('')
  const rewriteText = useRef<string | null>(null)

  const setRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    },
    [ref]
  )

  // The window measures the root, so the root has to reach the bottom of an open menu. Content that moves while the
  // menu is open (a streaming answer, a longer question) moves the menu too, so it is re-measured.
  const answerText = answer ? getMessageText(answer, false, false) : ''
  // biome-ignore lint/correctness/useExhaustiveDependencies: view, question and answer text move the open menu
  useLayoutEffect(() => {
    const root = rootRef.current
    const menu = openMenu ? root?.querySelector<HTMLElement>('[role="menu"]') : null
    if (!root || !menu) {
      setMenuMinHeight(undefined)
      return
    }
    const measure = () => {
      const bottom = menu.getBoundingClientRect().bottom - root.getBoundingClientRect().top + MENU_BOTTOM_GAP
      setMenuMinHeight(Math.ceil(bottom))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(menu)
    for (const child of Array.from(root.children)) observer.observe(child)
    return () => observer.disconnect()
  }, [openMenu, view, question, answerText])

  // One Esc is one step: an open menu closes first; an Esc another handler took (RewritePanel) is skipped.
  const escState = useRef({ openMenu, onEsc, view, onRewriteBack })
  escState.current = { openMenu, onEsc, view, onRewriteBack }
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.keyCode === 229) return
      event.preventDefault()
      if (escState.current.openMenu) {
        const menu = rootRef.current?.querySelector('[role="menu"]')
        const triggerId = menu?.getAttribute('aria-labelledby')
        setOpenMenu(null)
        rewriteText.current = null
        if (triggerId) document.getElementById(triggerId)?.focus()
        return
      }
      // In the rewrite view Esc steps back to the answer; it never hides the window from there.
      if (escState.current.view === 'rewrite') escState.current.onRewriteBack()
      else escState.current.onEsc()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // Hotkey → type: the input has focus on first render and on every show. The rewrite view keeps its own focus.
  const hasInput = view !== 'no-model'
  const focusView = useRef(view)
  focusView.current = view
  // biome-ignore lint/correctness/useExhaustiveDependencies: focusKey is the show signal
  useEffect(() => {
    if (!hasInput || focusView.current === 'rewrite') return
    inputRef.current?.focus()
  }, [focusKey, hasInput])

  // Choosing a rewrite option lands focus in the RewritePanel's text, so typing and Esc work there.
  useEffect(() => {
    if (view !== 'rewrite') return
    bodyRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
  }, [view])

  // Grow the one-row textarea with Shift+Enter lines, up to a cap.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the text changes
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    if (input.scrollHeight > 0) input.style.height = `${Math.min(input.scrollHeight, INPUT_MAX_HEIGHT)}px`
  }, [question])

  // The finished answer is announced once, never token by token.
  const [announcement, setAnnouncement] = useState('')
  const streamingId = useRef<string | null>(null)
  useEffect(() => {
    if (!answer) return
    if (generating) {
      if (streamingId.current !== answer.id) setAnnouncement('')
      streamingId.current = answer.id
      return
    }
    if (streamingId.current !== answer.id) return
    streamingId.current = null
    // Plain text as rendered (no Markdown syntax); an errored answer announces its error line.
    const text = answer.error ? answer.error.trim() : answerRef.current ? announcedText(answerRef.current) : ''
    if (text) setAnnouncement(text)
  }, [answer, generating])

  /** Rewrite takes the text selected in the body, else what is in the input. */
  const readRewriteText = () => {
    const selection = window.getSelection()
    const body = bodyRef.current
    if (selection && body && !selection.isCollapsed && selection.rangeCount > 0) {
      const inside = body.contains(selection.anchorNode) && body.contains(selection.focusNode)
      const text = selection.toString()
      if (inside && text.trim()) return text
    }
    return question
  }

  const toggleRewriteMenu = () => {
    if (openMenu === 'rewrite') {
      setOpenMenu(null)
      rewriteText.current = null
      return
    }
    if (rewriteText.current === null) rewriteText.current = readRewriteText()
    setOpenMenu('rewrite')
  }

  const onRewriteTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') return
    if (openMenu !== 'rewrite') rewriteText.current = readRewriteText()
    if (event.key === 'ArrowDown' && openMenu !== 'rewrite') {
      event.preventDefault()
      setOpenMenu('rewrite')
    }
  }

  const submit = () => {
    if (!question.trim() && pictureCount === 0) return
    setAsked(question)
    onSubmit()
  }

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      return
    }
    event.preventDefault()
    submit()
  }

  const rootClass = `dg dg-qc${windowed ? ' dg-qc--window' : ''}`
  const rootStyle = { position: 'relative' as const, minHeight: menuMinHeight }

  if (view === 'no-model') {
    return (
      <div ref={setRootRef} className={rootClass} style={rootStyle}>
        <div className="dg-qc__body" data-tauri-drag-region style={{ alignItems: 'center' }}>
          <button type="button" className="dg-btn dg-btn--primary" onClick={onSignIn}>
            {t('Sign in to a model')}
          </button>
        </div>
      </div>
    )
  }

  const waitingForFirstToken = generating && !answerText.trim()
  const shownQuestion = askedQuestion !== undefined ? askedQuestion : asked

  return (
    <div ref={setRootRef} className={rootClass} style={rootStyle} data-menu-open={openMenu ? 'true' : undefined}>
      <div className="dg-qc__bar">
        <QuickScopePill
          scopes={scopes}
          value={scopeId}
          onChange={onScopeChange}
          open={openMenu === 'scope'}
          onOpenChange={(open) => setOpenMenu(open ? 'scope' : null)}
        />
        <textarea
          ref={inputRef}
          rows={1}
          aria-label={t('Ask anything')}
          placeholder={t('Ask anything')}
          value={question}
          onChange={(event) => onQuestionChange(event.target.value)}
          onKeyDown={onInputKeyDown}
        />
        {pictureCount > 0 ? <span className="dg-chip">{t('{{count}} images', { count: pictureCount })}</span> : null}
      </div>

      {view === 'empty' ? null : (
        <div ref={bodyRef} className="dg-qc__body">
          {view === 'offline' ? (
            <>
              <p style={{ margin: 0 }}>
                {t("You're offline. {{model}} needs a connection to answer.", { model: modelName })}
              </p>
              <div>
                <button type="button" className="dg-btn" onClick={onRetry}>
                  {t('Retry')}
                </button>
              </div>
            </>
          ) : null}

          {view === 'rewrite' && rewrite ? (
            <RewritePanel
              key={`${rewrite.option ?? ''}:${rewrite.text}`}
              text={rewrite.text}
              option={rewrite.option}
              model={model}
              onBack={onRewriteBack}
              onChooseModel={onSignIn}
            />
          ) : null}

          {view === 'answered' ? (
            <>
              {shownQuestion ? (
                <p className="dg-type-callout" style={{ margin: 0, color: 'var(--dango-muted)' }}>
                  {shownQuestion}
                </p>
              ) : null}
              {waitingForFirstToken ? (
                <ThinkingLine
                  live
                  text=""
                  defaultOpen={false}
                  showMascot
                  startedAt={answer?.timestamp}
                  onStop={onStop}
                />
              ) : null}
              {answerText.trim() ? (
                <div ref={answerRef}>
                  <Markdown generating={generating} citations={answer?.citations}>
                    {answerText}
                  </Markdown>
                </div>
              ) : null}
              {answer?.error && !generating ? (
                <>
                  <p style={{ margin: 0, color: 'var(--dango-muted)' }}>{answer.error}</p>
                  <div>
                    <button type="button" className="dg-btn" onClick={onRetry}>
                      {t('Retry')}
                    </button>
                  </div>
                </>
              ) : null}
              {answer ? <QuickSourceChips message={answer} /> : null}
            </>
          ) : null}
        </div>
      )}

      <div className="dg-qc__foot" data-tauri-drag-region>
        <button type="button" className="dg-btn dg-btn--ghost" aria-label={t('Close')} onClick={onEsc}>
          <kbd className="dg-kbd">{t('Esc')}</kbd>
        </button>
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <button
            ref={rewriteTriggerRef}
            id={rewriteTriggerId}
            type="button"
            className="dg-btn dg-btn--ghost"
            aria-haspopup="menu"
            aria-expanded={openMenu === 'rewrite'}
            disabled={view === 'rewrite'}
            onPointerDown={() => {
              if (openMenu !== 'rewrite') rewriteText.current = readRewriteText()
            }}
            onMouseDown={() => {
              if (openMenu !== 'rewrite') rewriteText.current = readRewriteText()
            }}
            onKeyDown={onRewriteTriggerKeyDown}
            onClick={toggleRewriteMenu}
          >
            {t('Rewrite')}
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {openMenu === 'rewrite' ? (
            <QuickMenu
              anchorRef={rewriteTriggerRef}
              labelledBy={rewriteTriggerId}
              onClose={() => {
                setOpenMenu(null)
                rewriteText.current = null
              }}
              items={REWRITE_OPTIONS.map((option) => ({
                key: option.value,
                label: t(option.label),
                onSelect: () => onRewrite(option.value, rewriteText.current ?? question),
              }))}
            />
          ) : null}
        </span>
        <span style={{ flexGrow: 1, alignSelf: 'stretch' }} data-tauri-drag-region />
        {generating && !waitingForFirstToken && onStop ? (
          <button type="button" className="dg-btn dg-btn--ghost" onClick={onStop}>
            {t('Stop')}
          </button>
        ) : null}
        <button type="button" className="dg-btn dg-btn--ghost" disabled={!answer} onClick={onContinue}>
          {t('Continue in Chat')}
        </button>
      </div>

      <div role="status" aria-live="polite" className="sr-only" data-quick-answer-live>
        {announcement}
      </div>
    </div>
  )
})

const BLOCK_TAGS = new Set([
  'P',
  'LI',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'PRE',
  'TD',
  'TH',
  'BLOCKQUOTE',
  'TR',
  'UL',
  'OL',
  'TABLE',
  'DIV',
])

/**
 * Rendered answer as plain text for the live region: blocks on their own lines; KaTeX's MathML copy, buttons and
 * `aria-hidden` parts skipped.
 */
export function announcedText(root: Element): string {
  const parts: string[] = []
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? '')
      return
    }
    if (!(node instanceof Element)) return
    // KaTeX's MathML copy, controls (a code block's Copy) and decorations are not part of the answer.
    if (node.classList.contains('katex-mathml') || node.tagName === 'BUTTON') return
    if (node.getAttribute('aria-hidden') === 'true') return
    if (node.tagName === 'BR') {
      parts.push('\n')
      return
    }
    const block = BLOCK_TAGS.has(node.tagName)
    if (block) parts.push('\n')
    for (const child of Array.from(node.childNodes)) walk(child)
    if (block) parts.push('\n')
  }
  walk(root)
  return parts
    .join('')
    .replace(/[ \t]*\n\s*/g, '\n')
    .trim()
}
