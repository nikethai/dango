import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Inline editor for a sent question (MA1): Send resends it and keeps the old answer as a branch. ⌘/Ctrl+Enter sends,
 * Escape cancels, plain Enter adds a line.
 */
export function UserMessageEditor(props: { initialText: string; onSend(text: string): void; onCancel(): void }) {
  const { initialText, onSend, onCancel } = props
  const { t } = useTranslation()
  const [text, setText] = useState(initialText)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const blank = !text.trim()

  useEffect(() => {
    const field = fieldRef.current
    if (!field) return
    field.focus()
    field.setSelectionRange(field.value.length, field.value.length)
  }, [])

  const send = () => {
    if (blank) return
    onSend(text)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
      return
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="dg-composer w-full">
      <textarea
        ref={fieldRef}
        aria-label={t('Edit message')}
        aria-keyshortcuts="Meta+Enter Control+Enter Escape"
        value={text}
        rows={Math.min(10, Math.max(2, text.split('\n').length))}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      <div className="dg-composer__bar">
        <span className="dg-composer__spacer" />
        <button type="button" className="dg-btn dg-btn--ghost" onClick={onCancel}>
          {t('Cancel')}
        </button>
        <button type="button" className="dg-btn dg-btn--primary" disabled={blank} onClick={send}>
          {t('Send')}
        </button>
      </div>
    </div>
  )
}
