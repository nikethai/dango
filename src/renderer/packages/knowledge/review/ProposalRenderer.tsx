import { t } from 'i18next'
import { useEffect, useRef, useState } from 'react'
import { ReviewItem } from '@/components/review'
import type { ReviewRendererProps } from '@/packages/review'
import { approveProposal, KnowledgeConflictError } from '../approve'
import { dismissProposal } from '../proposals'
import { scopeName } from '../scopes'
import { quote } from '../text'
import { useGuarded } from './useGuarded'

async function handleConflict(error: unknown): Promise<boolean> {
  if (!(error instanceof KnowledgeConflictError)) return false
  // Loaded on demand: the toast store reads localStorage, which init-time code must not need.
  const toastActions = await import('@/stores/toastActions')
  toastActions.add(t('Waiting in Review: it contradicts "{{old}}"', { old: quote(error.oldText) }))
  return true
}

/** Approve, Edit (RV2) and Dismiss for a proposal. The package functions push their own undo. */
export function ProposalRenderer({ entry, focused }: ReviewRendererProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(entry.text)
  const field = useRef<HTMLTextAreaElement>(null)
  const editButton = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)
  const { busy, run } = useGuarded(handleConflict)

  useEffect(() => {
    if (editing) field.current?.focus()
    else if (returnFocus.current) {
      returnFocus.current = false
      editButton.current?.focus()
    }
  }, [editing])

  const startEdit = () => {
    setDraft(entry.text)
    setEditing(true)
  }
  const cancelEdit = () => {
    returnFocus.current = true
    setEditing(false)
  }
  const canApproveEdit = draft.trim().length > 0
  const approveEdit = () => {
    if (canApproveEdit) void run(() => approveProposal(entry.ref.id, { text: draft }))
  }

  const base = {
    kind: entry.kind,
    scope: scopeName(entry.scopeId),
    text: entry.text,
    focused,
    ...(entry.source !== undefined ? { source: entry.source } : {}),
  }

  return (
    <div>
      {editing ? (
        <ReviewItem
          {...base}
          actions={[
            { label: t('Approve'), variant: 'primary', disabled: busy, onClick: approveEdit },
            { label: t('Cancel'), variant: 'ghost', disabled: busy, onClick: cancelEdit },
          ]}
        >
          <textarea
            ref={field}
            className="dango-field"
            rows={3}
            aria-label={t('Edit proposal')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // An IME composing text (Safari reports keyCode 229) owns Enter and Esc.
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                if (!busy) approveEdit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                // While the approve runs, Esc does not leave editing.
                if (!busy) cancelEdit()
              }
            }}
          />
        </ReviewItem>
      ) : (
        <ReviewItem
          {...base}
          actions={[
            {
              label: t('Approve'),
              variant: 'primary',
              disabled: busy,
              onClick: () => void run(() => approveProposal(entry.ref.id)),
            },
            { label: t('Edit'), disabled: busy, onClick: startEdit, ref: editButton },
            {
              label: t('Dismiss'),
              variant: 'ghost',
              disabled: busy,
              onClick: () => void run(() => dismissProposal(entry.ref.id)),
            },
          ]}
        />
      )}
    </div>
  )
}
