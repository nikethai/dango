import type { KnowledgeKind } from '@shared/types/knowledge'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { addKnowledge } from '@/packages/knowledge/approve'
import { useKnowledgeAction } from './useKnowledgeActions'

const KINDS: KnowledgeKind[] = ['fact', 'decision', 'preference']

/** KN1: add by hand. `addKnowledge` pushes its own undo and throws on a contradiction or duplicate. */
export function AddKnowledgeForm({
  scopeId,
  defaultKind = 'fact',
  onDone,
}: {
  scopeId: string
  defaultKind?: KnowledgeKind
  onDone(): void
}) {
  const { t } = useTranslation()
  const [kind, setKind] = useState<KnowledgeKind>(defaultKind)
  const [text, setText] = useState('')
  const { busy, run } = useKnowledgeAction()
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => field.current?.focus(), [])
  const label: Record<KnowledgeKind, string> = { fact: t('Fact'), decision: t('Decision'), preference: t('Preference') }

  return (
    <form
      className="dg flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!text.trim()) return
        void run(async () => {
          await addKnowledge({ scopeId, kind, text })
          onDone()
        })
      }}
    >
      <div className="flex gap-2" role="group" aria-label={t('Kind')}>
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className={k === kind ? 'dg-chip dg-chip--blue' : 'dg-chip'}
            aria-pressed={k === kind}
            onClick={() => setKind(k)}
          >
            {label[k]}
          </button>
        ))}
      </div>
      <textarea
        ref={field}
        aria-label={t('Knowledge')}
        value={text}
        rows={3}
        onChange={(e) => setText(e.target.value)}
        className="dango-field"
      />
      <div className="flex gap-2">
        <button type="submit" className="dg-btn dg-btn--primary" disabled={busy || !text.trim()}>
          {t('Save')}
        </button>
        <button type="button" className="dg-btn dg-btn--ghost" disabled={busy} onClick={onDone}>
          {t('Cancel')}
        </button>
      </div>
    </form>
  )
}
