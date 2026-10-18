import { isEverywhere } from '@shared/types/scope'
import { readTrustLevel } from '@shared/types/settings'
import { ChevronDown } from 'lucide-react'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TRUST_LABELS } from '@/components/settings/TrustSheet'
import { useTrustSheet } from '@/components/settings/useTrustSheet'
import { useScopes } from '@/hooks/useScopes'
import { startNewChat } from '@/lib/startNewChat'
import { useSettingsStore } from '@/stores/settingsStore'
import './review-home.css'

export type ReviewToolbarProps = { scopeId?: string; onScopeChange(id: string | undefined): void }

const queryItems = (root: HTMLElement | null) =>
  Array.from(root?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])

export function ReviewToolbar({ scopeId, onScopeChange }: ReviewToolbarProps) {
  const { t } = useTranslation()
  const { scopes } = useScopes()
  const trust = useTrustSheet()
  const level = readTrustLevel(useSettingsStore((s) => s.trustLevel))
  const [menuOpen, setMenuOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  const items = () => queryItems(wrap.current)

  useEffect(() => {
    if (!menuOpen) return
    const all = queryItems(wrap.current)
    const current = all.find((el) => el.classList.contains('is-current')) ?? all[0]
    current?.focus()
  }, [menuOpen])

  const onWrapKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && menuOpen) {
      e.preventDefault()
      setMenuOpen(false)
      trigger.current?.focus()
      return
    }
    if (!menuOpen || !(e.target as HTMLElement).matches('[role="menuitem"]')) return
    const all = items()
    const i = all.indexOf(e.target as HTMLElement)
    const next =
      e.key === 'ArrowDown'
        ? all[(i + 1) % all.length]
        : e.key === 'ArrowUp'
          ? all[(i - 1 + all.length) % all.length]
          : e.key === 'Home'
            ? all[0]
            : e.key === 'End'
              ? all[all.length - 1]
              : undefined
    if (!next) return
    e.preventDefault()
    next.focus()
  }

  const choose = (id: string | undefined) => {
    setMenuOpen(false)
    onScopeChange(id)
    trigger.current?.focus()
  }

  const scopeName =
    scopeId === undefined
      ? t('All scopes')
      : isEverywhere(scopeId)
        ? t('Everywhere')
        : (scopes.find((s) => s.id === scopeId)?.name ?? t('All scopes'))
  const options: { id: string | undefined; name: string }[] = [
    { id: undefined, name: t('All scopes') },
    { id: 'everywhere', name: t('Everywhere') },
    ...scopes.filter((s) => !isEverywhere(s.id)).map((s) => ({ id: s.id, name: s.name })),
  ]

  return (
    <div className="dango-review-toolbar">
      <div className="dango-review-toolbar__scope" ref={wrap} onKeyDown={onWrapKeyDown}>
        <button
          type="button"
          ref={trigger}
          className="dg-btn"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span>{scopeName}</span>
          <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
        {menuOpen && (
          <div className="dg-menu dango-review-toolbar__menu" role="menu">
            {options.map((o) => (
              <button
                key={o.id ?? 'all'}
                type="button"
                role="menuitem"
                className={o.id === scopeId ? 'is-current' : undefined}
                onClick={() => choose(o.id)}
              >
                {o.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <button type="button" className="dg-btn" onClick={trust.open}>
        <span>{t('Trust: {{level}}', { level: t(TRUST_LABELS[level]) })}</span>
        <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {trust.sheet}
      <button
        type="button"
        className="dg-btn dg-btn--primary dango-review-toolbar__new"
        onClick={() => startNewChat({ scopeId })}
      >
        <span>{t('New chat')}</span>
        <kbd className="dg-kbd" aria-hidden="true">
          ⌘N
        </kbd>
      </button>
    </div>
  )
}
