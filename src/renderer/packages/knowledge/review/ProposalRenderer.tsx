import { t } from 'i18next'
import { useEffect, useRef, useState } from 'react'
import { ReviewItem } from '@/components/review'
import { getLogger } from '@/lib/utils'
import type { ReviewRendererProps } from '@/packages/review'
import { approveProposal, KnowledgeConflictError } from '../approve'
import { dismissProposal } from '../proposals'
import { quote } from '../text'

const log = getLogger('knowledge')

/** Approve, Edit (RV2) and Dismiss for a proposal. The package functions push their own undo. */
export function ProposalRenderer({ entry, focused }: ReviewRendererProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(entry.text)
  const field = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) field.current?.focus()
  }, [editing])

  const approve = async (text?: string) => {
    try {
      await (text === undefined ? approveProposal(entry.ref.id) : approveProposal(entry.ref.id, { text }))
    } catch (error) {
      if (error instanceof KnowledgeConflictError) {
        // Loaded on demand: the toast store reads localStorage, which init-time code must not need.
        const toastActions = await import('@/stores/toastActions')
        toastActions.add(t('Waiting in Review: it contradicts "{{old}}"', { old: quote(error.oldText) }))
        return
      }
      log.error('Approve failed:', error)
    }
  }
  const dismiss = () => {
    dismissProposal(entry.ref.id).catch((error) => log.error('Dismiss failed:', error))
  }
  const canApproveEdit = draft.trim().length > 0
  const approveEdit = () => {
    if (canApproveEdit) void approve(draft)
  }

  const base = {
    kind: entry.kind,
    scope: entry.scopeId,
    text: entry.text,
    focused,
    ...(entry.source !== undefined ? { source: entry.source } : {}),
  }

  if (editing) {
    return (
      <ReviewItem
        {...base}
        actions={[
          { label: t('Approve'), variant: 'primary', onClick: approveEdit },
          {
            label: t('Cancel'),
            variant: 'ghost',
            onClick: () => {
              setEditing(false)
              setDraft(entry.text)
            },
          },
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
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              approveEdit()
            }
          }}
        />
      </ReviewItem>
    )
  }

  return (
    <ReviewItem
      {...base}
      actions={[
        { label: t('Approve'), variant: 'primary', onClick: () => void approve() },
        { label: t('Edit'), onClick: () => setEditing(true) },
        { label: t('Dismiss'), variant: 'ghost', onClick: dismiss },
      ]}
    />
  )
}
