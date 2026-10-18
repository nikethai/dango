import type { KnowledgeItem } from '@shared/types/knowledge'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useScopes } from '@/hooks/useScopes'
import { useKnowledgeItem } from '@/packages/knowledge/hooks'
import { editKnowledge, moveKnowledge, removeKnowledge } from '@/packages/knowledge/lifecycle'
import { NEVER_SEND_EMAIL } from '@/packages/knowledge/select'
import { quote } from '@/packages/knowledge/text'
import { KnowledgeItemDetail } from './KnowledgeItemDetail'
import { useKnowledgeAction } from './useKnowledgeActions'

function KnowledgeRow({ item }: { item: KnowledgeItem }) {
  const { t } = useTranslation()
  const { scopes } = useScopes()
  const { busy, run } = useKnowledgeAction()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [moving, setMoving] = useState(false)
  const [draft, setDraft] = useState(item.text)
  const replacement = useKnowledgeItem(item.supersededBy)

  const builtIn = item.id === NEVER_SEND_EMAIL.id
  const superseded = item.status === 'superseded'
  const hasActions = !builtIn && !superseded
  // Preferences live in Everywhere (ADR 0013), so they never move.
  const canMove = hasActions && item.kind !== 'preference'
  const targets = [
    ...(item.scopeId === EVERYWHERE_SCOPE_ID ? [] : [{ id: EVERYWHERE_SCOPE_ID, name: t('Everywhere') }]),
    ...scopes.filter((s) => s.id !== item.scopeId).map((s) => ({ id: s.id, name: s.name })),
  ]

  return (
    <li className="dg-item" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
      <div className="dg-item__text">
        {editing ? (
          <textarea
            aria-label={t('Edit')}
            value={draft}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            className="dg-type-body"
            style={{
              width: '100%',
              padding: 'var(--dango-space-2)',
              border: '1px solid var(--dango-line)',
              borderRadius: 'var(--dango-radius-sm)',
              background: 'var(--dango-raised)',
              color: 'var(--dango-ink)',
            }}
          />
        ) : builtIn ? (
          <span>{item.text}</span>
        ) : (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="dg-type-body"
            style={{ all: 'unset', cursor: 'pointer', display: 'block' }}
          >
            {item.text}
          </button>
        )}
        {superseded && replacement ? (
          <div className="dg-item__sub">{t('Replaced by "{{text}}"', { text: quote(replacement.text) })}</div>
        ) : null}
        {open && !editing ? <KnowledgeItemDetail item={item} /> : null}
      </div>
      <div className="dg-item__actions">
        {builtIn ? <span className="dg-chip">{t('Built in')}</span> : null}
        {hasActions && editing ? (
          <>
            <button
              type="button"
              className="dg-btn dg-btn--primary"
              disabled={busy || !draft.trim()}
              onClick={() =>
                void run(async () => {
                  await editKnowledge(item.id, draft)
                  setEditing(false)
                })
              }
            >
              {t('Save')}
            </button>
            <button
              type="button"
              className="dg-btn dg-btn--ghost"
              disabled={busy}
              onClick={() => {
                setDraft(item.text)
                setEditing(false)
              }}
            >
              {t('Cancel')}
            </button>
          </>
        ) : null}
        {hasActions && !editing ? (
          <>
            <button type="button" className="dg-btn dg-btn--ghost" disabled={busy} onClick={() => setEditing(true)}>
              {t('Edit')}
            </button>
            {canMove ? (
              <span style={{ position: 'relative' }}>
                <button
                  type="button"
                  className="dg-btn dg-btn--ghost"
                  disabled={busy}
                  aria-haspopup="menu"
                  aria-expanded={moving}
                  onClick={() => setMoving(!moving)}
                >
                  {t('Move to…')}
                </button>
                {moving ? (
                  <div
                    role="menu"
                    className="dg-menu"
                    style={{ position: 'absolute', right: 0, zIndex: 10, marginTop: 'var(--dango-space-1)' }}
                  >
                    {targets.map((target) => (
                      <button
                        key={target.id}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMoving(false)
                          void run(() => moveKnowledge(item.id, target.id))
                        }}
                      >
                        {target.name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </span>
            ) : null}
            <button
              type="button"
              className="dg-btn dg-btn--ghost"
              disabled={busy}
              onClick={() => void run(() => removeKnowledge(item.id))}
            >
              {t('Remove')}
            </button>
          </>
        ) : null}
      </div>
    </li>
  )
}

/** Rows for a list of items: select for detail, Edit, Move to…, Remove. Superseded and built-in rows have no actions. */
export function KnowledgeRows({ items }: { items: KnowledgeItem[] }) {
  return (
    <ul className="flex flex-col gap-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {items.map((item) => (
        <KnowledgeRow key={item.id} item={item} />
      ))}
    </ul>
  )
}
