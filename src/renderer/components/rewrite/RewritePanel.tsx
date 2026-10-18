import {
  MAX_WRITING_INPUT_CHARS,
  TARGET_LANGUAGE_RE,
  type WritingErrorCode,
  type WritingModel,
  type WritingStyle,
} from '@shared/types/writing'
import copyToClipboard from 'copy-to-clipboard'
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { navigateToSettings } from '@/modals/Settings'
import { useWritingRewrite } from '@/packages/writing/useWritingRewrite'

export const TRANSLATE_TARGET_KEY = 'dango.rewrite.translate-to'
const DEFAULT_TARGET = 'English'

export const REWRITE_OPTIONS: ReadonlyArray<{ value: WritingStyle; label: string }> = [
  { value: 'clearer', label: 'Clearer' },
  { value: 'friendlier', label: 'Friendlier' },
  { value: 'shorter', label: 'Shorter' },
  { value: 'formal', label: 'Formal' },
  { value: 'translate', label: 'Translate' },
]

export type RewritePanelProps = {
  text: string
  option: WritingStyle | null
  model?: WritingModel
  onUse?: (text: string) => void
  onBack: () => void
  /** Where "Choose a model" goes. Defaults to the provider settings. */
  onChooseModel?: () => void
}

function readTarget(): string {
  try {
    return localStorage.getItem(TRANSLATE_TARGET_KEY) || DEFAULT_TARGET
  } catch {
    return DEFAULT_TARGET
  }
}

function saveTarget(target: string) {
  try {
    localStorage.setItem(TRANSLATE_TARGET_KEY, target)
  } catch {
    // Remembering the language is a convenience only.
  }
}

const field: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: 'var(--dango-space-2) var(--dango-space-3)',
  border: '1px solid var(--dango-control-border)',
  borderRadius: 'var(--dango-radius-md)',
  background: 'var(--dango-surface)',
  color: 'var(--dango-ink)',
  font: 'inherit',
}

export default function RewritePanel({ text, option, model, onUse, onBack, onChooseModel }: RewritePanelProps) {
  const { t } = useTranslation()
  const { state, rewrite } = useWritingRewrite()
  const targetId = useId()
  const targetErrorId = `${targetId}-error`
  const [draft, setDraft] = useState(text)
  const [style, setStyle] = useState<WritingStyle | null>(option)
  const [target, setTarget] = useState(readTarget)
  const [invalid, setInvalid] = useState<'text' | 'language' | null>(null)
  const [unsupported, setUnsupported] = useState(false)
  const [copied, setCopied] = useState(false)

  const run = (nextStyle: WritingStyle, nextDraft = draft, nextTarget = target) => {
    setCopied(false)
    setUnsupported(false)
    if (nextDraft.trim().length === 0 || nextDraft.length > MAX_WRITING_INPUT_CHARS) {
      setInvalid('text')
      return
    }
    const language = nextTarget.trim()
    if (nextStyle === 'translate' && !TARGET_LANGUAGE_RE.test(language)) {
      setInvalid('language')
      return
    }
    setInvalid(null)
    if (!model) {
      setUnsupported(true)
      return
    }
    if (nextStyle === 'translate') saveTarget(language)
    void rewrite({
      draft: nextDraft,
      style: nextStyle,
      ...(nextStyle === 'translate' ? { targetLanguage: language } : {}),
      model,
    })
  }

  const started = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once for the option the panel opened with
  useEffect(() => {
    if (started.current) return
    started.current = true
    if (option) run(option)
  }, [])

  const choose = (value: WritingStyle) => {
    setStyle(value)
    run(value)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    onBack()
  }

  const errorCode: WritingErrorCode | null = unsupported
    ? 'unsupported_model'
    : state.status === 'error'
      ? state.code
      : invalid === 'text'
        ? 'invalid_input'
        : null
  const errorText: Record<WritingErrorCode, string> = {
    invalid_input: t('Add some text to rewrite, up to 8,000 characters.'),
    unsupported_model: t("This model can't rewrite text."),
    request_failed: t("The rewrite didn't go through. Your text is unchanged."),
    incomplete: t('The model stopped before finishing.'),
    timeout: t('The rewrite took over a minute and was stopped.'),
  }
  const running = state.status === 'running'
  const output = state.status === 'complete' ? state.result.text : state.status === 'running' ? state.text : ''
  const chooseModel = onChooseModel ?? (() => navigateToSettings('/provider'))

  const copy = () => {
    if (copyToClipboard(output)) setCopied(true)
  }

  return (
    <div
      className="dg"
      onKeyDown={onKeyDown}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--dango-space-3)' }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--dango-space-2)' }}>
        {REWRITE_OPTIONS.map((item) => (
          <button
            key={item.value}
            type="button"
            className={`dg-chip${style === item.value ? ' dg-chip--green' : ''}`}
            aria-pressed={style === item.value}
            onClick={() => choose(item.value)}
          >
            {t(item.label)}
          </button>
        ))}
      </div>

      <textarea
        data-autofocus
        aria-label={t('Text to rewrite')}
        aria-invalid={invalid === 'text' || undefined}
        className="dg-type-body"
        rows={4}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        style={{ ...field, resize: 'vertical' }}
      />

      {style === 'translate' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--dango-space-1)' }}>
          <label className="dg-type-caption" htmlFor={targetId} style={{ color: 'var(--dango-muted)' }}>
            {t('Translate to')}
          </label>
          <input
            id={targetId}
            aria-invalid={invalid === 'language' || undefined}
            aria-describedby={invalid === 'language' ? targetErrorId : undefined}
            className="dg-type-body"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                run('translate')
              }
            }}
            style={field}
          />
          {invalid === 'language' && (
            <div id={targetErrorId} role="alert" className="dg-type-caption" style={{ color: 'var(--dango-danger)' }}>
              {t('Enter a language name, such as Spanish.')}
            </div>
          )}
        </div>
      )}

      {(running || output) && (
        <div
          aria-live="polite"
          aria-busy={running}
          className="dg-type-body"
          style={{
            ...field,
            whiteSpace: 'pre-wrap',
            background: 'var(--dango-ground)',
            border: '1px solid var(--dango-hairline)',
          }}
        >
          {output || t('Rewriting…')}
        </div>
      )}

      {errorCode && (
        <div role="alert" className="dg-type-callout" style={{ color: 'var(--dango-danger)' }}>
          {errorText[errorCode]}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--dango-space-2)' }}>
        {output && state.status === 'complete' && (
          <>
            <button type="button" className="dg-btn dg-btn--primary" onClick={copy}>
              {copied ? t('Copied') : t('Copy')}
            </button>
            {onUse && (
              <button type="button" className="dg-btn" onClick={() => onUse(output)}>
                {t('Use this')}
              </button>
            )}
          </>
        )}
        {errorCode === 'unsupported_model' ? (
          <button type="button" className="dg-btn dg-btn--primary" onClick={chooseModel}>
            {t('Choose a model')}
          </button>
        ) : (
          style &&
          (errorCode !== null || state.status === 'complete') &&
          errorCode !== 'invalid_input' && (
            <button
              type="button"
              className={`dg-btn${errorCode ? ' dg-btn--primary' : ' dg-btn--ghost'}`}
              onClick={() => run(style)}
            >
              {t('Try again')}
            </button>
          )
        )}
      </div>
    </div>
  )
}
