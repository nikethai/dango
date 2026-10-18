import type { KnowledgeProposal } from '@shared/types/knowledge'
import { t } from 'i18next'
import { useCallback, useMemo, useState } from 'react'
import { approveProposal, KnowledgeConflictError } from '@/packages/knowledge/approve'
import { useProposalConflictText, useProposalsForMessage } from '@/packages/knowledge/hooks'
import { deferProposal } from '@/packages/knowledge/proposals'
import { useGuarded } from '@/packages/knowledge/review/useGuarded'
import { scopeName } from '@/packages/knowledge/scopes'
import { quote } from '@/packages/knowledge/text'

const MAX_ROWS = 3

function ProposalRow({ proposal }: { proposal: KnowledgeProposal }) {
  const existing = useProposalConflictText(proposal.id)
  const [contradicts, setContradicts] = useState<string | undefined>()
  // A contradiction on Approve shows on the row (the Conflict entry is in Review); anything else toasts.
  const onError = useCallback((error: unknown) => {
    if (!(error instanceof KnowledgeConflictError)) return false
    setContradicts(error.oldText)
    return true
  }, [])
  const { busy, run } = useGuarded(onError)
  const old = contradicts ?? existing
  const scope = scopeName(proposal.scopeId)

  return (
    <article className={old === undefined ? 'dg-item' : 'dg-item dg-item--conflict'} aria-label={proposal.text}>
      <div className="dg-item__mark" aria-hidden="true" />
      <div className="dg-item__text">
        <div className="dg-item__meta">{t('Save to {{scope}}?', { scope })}</div>
        <div>{proposal.text}</div>
      </div>
      <div className="dg-item__actions">
        {old === undefined ? (
          <>
            <button
              type="button"
              className="dg-btn dg-btn--primary"
              disabled={busy}
              onClick={() => void run(() => approveProposal(proposal.id))}
            >
              {t('Approve')}
            </button>
            <button
              type="button"
              className="dg-btn dg-btn--ghost"
              disabled={busy}
              onClick={() => void run(() => deferProposal(proposal.id))}
            >
              {t('Not now')}
            </button>
          </>
        ) : (
          <span className="dg-item__meta">{t('Waiting in Review: it contradicts "{{old}}"', { old: quote(old) })}</span>
        )}
      </div>
    </article>
  )
}

/**
 * Under an answer: the open proposals filed from it (up to three, Not now hides one), each with Approve
 * and Not now. `approveProposal` pushes its own undo. Renders nothing when there are none.
 */
export function KnowledgeProposalCard({ sessionId, messageId }: { sessionId: string; messageId: string }) {
  const proposals = useProposalsForMessage(messageId)
  const open = useMemo(
    () => proposals.filter((p) => !p.deferred && (p.sessionId === undefined || p.sessionId === sessionId)),
    [proposals, sessionId]
  )
  if (open.length === 0) return null
  const more = open.length - MAX_ROWS

  return (
    <section
      className="dg"
      aria-label={t('Knowledge proposals')}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--dango-space-2)',
        marginTop: 'var(--dango-space-2)',
      }}
    >
      {open.slice(0, MAX_ROWS).map((p) => (
        <ProposalRow key={p.id} proposal={p} />
      ))}
      {more > 0 ? <div className="dg-item__meta">{t('{{n}} more in Review', { n: more })}</div> : null}
    </section>
  )
}
