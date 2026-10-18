import dayjs from 'dayjs'
import { t } from 'i18next'
import { useState } from 'react'
import { useStore } from 'zustand'
import { getLogger } from '@/lib/utils'
import type { ReviewRendererProps } from '@/packages/review'
import { resolveConflict } from '../conflicts'
import { dismissProposal } from '../proposals'
import { scopeName } from '../scopes'
import { knowledgeStore } from '../store'
import { KeepBothSheet } from './KeepBothSheet'

const log = getLogger('knowledge')

type Statement = { id: string; text: string; source?: string; at: number }

const settle = (action: Promise<unknown>) => {
  action.catch((error) => log.error('Conflict action failed:', error))
}

/** RV4: the proposed and the saved statement side by side, with the three ways out (RV6, RV7). */
export function ConflictRenderer({ entry, focused }: ReviewRendererProps) {
  const state = useStore(knowledgeStore, (s) => s.state)
  const [sheet, setSheet] = useState(false)
  const conflict = state.conflicts.find((c) => c.id === entry.ref.id)
  const proposal = conflict ? state.proposals.find((p) => p.id === conflict.proposalId) : undefined

  const statements: Statement[] = []
  if (conflict && proposal) {
    statements.push({
      id: proposal.id,
      text: proposal.text,
      ...(proposal.sources[0]?.label !== undefined ? { source: proposal.sources[0].label } : {}),
      at: proposal.createdAt,
    })
    for (const itemId of conflict.itemIds) {
      const item = state.items.find((i) => i.id === itemId)
      if (!item) continue
      statements.push({
        id: item.id,
        text: item.text,
        ...(item.sources[0]?.label !== undefined ? { source: item.sources[0].label } : {}),
        at: item.createdAt,
      })
    }
  }

  const meta = [t('Conflict'), scopeName(entry.scopeId)].join(' · ')
  const className = ['dg', 'dg-item', 'dg-item--conflict', focused ? 'is-focused' : ''].filter(Boolean).join(' ')

  return (
    <article className={className} aria-label={`${meta}. ${entry.text}`}>
      <div className="dg-item__mark" aria-hidden="true" />
      <div className="dg-item__text">
        <div className="dg-item__meta">{meta}</div>
        {conflict && proposal ? (
          statements.map((s) => (
            <div key={s.id} className="dango-conflict__statement">
              <div>
                <div>{s.text}</div>
                <div className="dg-item__meta">
                  {[s.source, dayjs(s.at).format('D MMM')].filter(Boolean).join(' · ')}
                </div>
              </div>
              <button
                type="button"
                className="dg-btn"
                onClick={() => settle(resolveConflict(conflict.id, { keep: s.id }))}
              >
                {t('Keep this')}
              </button>
            </div>
          ))
        ) : (
          <>
            <div>{entry.text}</div>
            {entry.sub ? <div className="dg-item__sub">{entry.sub}</div> : null}
          </>
        )}
      </div>
      <div className="dg-item__actions">
        {conflict && proposal ? (
          <>
            <button type="button" className="dg-btn" onClick={() => setSheet(true)}>
              {t('Keep both, with a condition…')}
            </button>
            <button
              type="button"
              className="dg-btn dg-btn--ghost"
              onClick={() => settle(dismissProposal(conflict.proposalId))}
            >
              {t('Dismiss')}
            </button>
          </>
        ) : null}
      </div>
      {conflict ? (
        <KeepBothSheet
          opened={sheet}
          onClose={() => setSheet(false)}
          onConfirm={(condition) => {
            setSheet(false)
            settle(resolveConflict(conflict.id, { keepBoth: condition }))
          }}
        />
      ) : null}
    </article>
  )
}
