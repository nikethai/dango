import type { KnowledgeItem } from '@shared/types/knowledge'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useScopes } from '@/hooks/useScopes'
import { useKnowledgeItem } from '@/packages/knowledge/hooks'
import { editKnowledge, moveKnowledge, removeKnowledge } from '@/packages/knowledge/lifecycle'
import { NEVER_SEND_EMAIL } from '@/packages/knowledge/select'
import { quote } from '@/packages/knowledge/text'
import { KnowledgeItemDetail } from './KnowledgeItemDetail'
import { useKnowledgeAction } from './useKnowledgeActions'

function KnowledgeRow({ item, onNoneLeft }: { item: KnowledgeItem; onNoneLeft?: () => void }) {
  const { t } = useTranslation()
  const { scopes } = useScopes()
  const { busy, run } = useKnowledgeAction()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [moving, setMoving] = useState(false)
  const [draft, setDraft] = useState(item.text)
  const row = useRef<HTMLLIElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const replacement = useKnowledgeItem(item.supersededBy)

  const builtIn = item.id === NEVER_SEND_EMAIL.id
  const superseded = item.status === 'superseded'
  const hasActions = !builtIn && item.status === 'approved'
  // Preferences live in Everywhere (ADR 0013), so they never move.
  const canMove = hasActions && item.kind !== 'preference'
  const targets = [
    ...(item.scopeId === EVERYWHERE_SCOPE_ID ? [] : [{ id: EVERYWHERE_SCOPE_ID, name: t('Everywhere') }]),
    ...scopes.filter((s) => s.id !== item.scopeId).map((s) => ({ id: s.id, name: s.name })),
  ]

  // The Move menu takes focus, and closes on Escape or a press outside it. Its own trigger is not outside:
  // a press there toggles it through the click instead.
  useEffect(() => {
    if (!moving) return
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) setMoving(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [moving])

  const remove = () => {
    const sibling = row.current?.nextElementSibling ?? row.current?.previousElementSibling
    const next = sibling?.querySelector<HTMLElement>('button')
    void run(async () => {
      await removeKnowledge(item.id)
      if (next?.isConnected) next.focus()
      else onNoneLeft?.()
    })
  }

  const openEditor = () => {
    setDraft(item.text)
    setEditing(true)
  }
  const save = () =>
    void run(async () => {
      if (draft.trim() !== item.text) await editKnowledge(item.id, draft)
      setEditing(false)
    })

  return (
    <li ref={row} className="dg-item" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
      <div className="dg-item__text">
        {editing ? (
          <textarea
            aria-label={t('Edit')}
            value={draft}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            className="dango-field"
          />
        ) : builtIn ? (
          <span>{item.text}</span>
        ) : (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="dg-type-body dango-knowledge-toggle"
          >
            {item.text}
          </button>
        )}
        {superseded && replacement ? (
          <div className="dg-item__sub">{t('Replaced by "{{text}}"', { text: quote(replacement.text) })}</div>
        ) : null}
        {item.status === 'removed' ? <div className="dg-item__sub">{t('Removed')}</div> : null}
        {open && !editing ? <KnowledgeItemDetail item={item} /> : null}
      </div>
      <div className="dg-item__actions">
        {builtIn ? <span className="dg-chip">{t('Built in')}</span> : null}
        {hasActions && editing ? (
          <>
            <button type="button" className="dg-btn dg-btn--primary" disabled={busy || !draft.trim()} onClick={save}>
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
            <button type="button" className="dg-btn dg-btn--ghost" disabled={busy} onClick={openEditor}>
              {t('Edit')}
            </button>
            {canMove ? (
              <button
                ref={trigger}
                type="button"
                className="dg-btn dg-btn--ghost"
                disabled={busy}
                aria-haspopup="menu"
                aria-expanded={moving}
                onClick={() => setMoving(!moving)}
              >
                {t('Move to…')}
              </button>
            ) : null}
            <button type="button" className="dg-btn dg-btn--ghost" disabled={busy} onClick={remove}>
              {t('Remove')}
            </button>
          </>
        ) : null}
      </div>
      {moving && canMove && !editing ? (
        // In the row's flow, under its actions: it pushes the next row down instead of covering its actions.
        <div
          ref={menu}
          role="menu"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setMoving(false)
              trigger.current?.focus()
            }
          }}
          className="dg-menu"
          style={{ gridColumn: '1 / -1', justifySelf: 'end' }}
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
    </li>
  )
}

/** Rows for a list of items: select for detail, Edit, Move to…, Remove. Superseded and built-in rows have no actions. */
export function KnowledgeRows({ items, onNoneLeft }: { items: KnowledgeItem[]; onNoneLeft?: () => void }) {
  return (
    <ul className="flex flex-col gap-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {items.map((item) => (
        <KnowledgeRow key={item.id} item={item} onNoneLeft={onNoneLeft} />
      ))}
    </ul>
  )
}
