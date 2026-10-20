import NiceModal from '@ebay/nice-modal-react'
import { isEverywhere } from '@shared/types'
import { Search } from 'lucide-react'
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useSheetFocus } from '@/components/ui/useSheetFocus'
import { useScopes } from '@/hooks/useScopes'
import { startNewChat } from '@/lib/startNewChat'
import { getOS } from '@/packages/navigator'
// The barrel registers the built-in providers on import.
import { attachPrefill, type SearchGroup, type SearchHit, useSearch } from '@/packages/search'
import { platformCapabilities } from '@/platform'
import { useUIStore } from '@/stores/uiStore'
import './search.css'

const GROUPS: { group: SearchGroup; label: string }[] = [
  { group: 'chats', label: 'Chats' },
  { group: 'knowledge', label: 'Knowledge' },
  { group: 'sources', label: 'Sources' },
]

function runOpen(hit: SearchHit) {
  try {
    void Promise.resolve(hit.open()).catch((error) => console.warn('[search] open failed', error))
  } catch (error) {
    console.warn('[search] open failed', error)
  }
}

function OpenSearchOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { scopes } = useScopes()
  const panelRef = useRef<HTMLElement>(null)
  const listId = useId()
  const [text, setText] = useState('')
  const [scope, setScope] = useState<string>('all')
  useSheetFocus(panelRef, { onClose })

  const { groups, loading, stale } = useSearch(text, scope === 'all' ? 'all' : [scope])
  const shown = useMemo(() => GROUPS.filter(({ group }) => groups[group].length > 0), [groups])
  const flat = useMemo(() => shown.flatMap(({ group }) => groups[group]), [shown, groups])

  // The cursor belongs to the list it was moved in; new results start at the first hit.
  const [cursor, setCursor] = useState<{ list: SearchHit[]; index: number }>({ list: flat, index: 0 })
  const active = cursor.list === flat ? cursor.index : 0
  const setActive = (index: number) => setCursor({ list: flat, index })

  const optionId = (index: number) => `${listId}-option-${index}`
  const activeIndex = flat.length > 0 ? Math.min(active, flat.length - 1) : -1

  useEffect(() => {
    if (activeIndex < 0) return
    document.getElementById(optionId(activeIndex))?.scrollIntoView?.({ block: 'nearest' })
  })

  const openHit = (hit: SearchHit) => {
    onClose()
    runOpen(hit)
  }

  const newChatWith = (hit: SearchHit) => {
    onClose()
    startNewChat({
      scopeId: hit.scopeId && !isEverywhere(hit.scopeId) ? hit.scopeId : undefined,
      prefill: attachPrefill(hit),
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (flat.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((activeIndex + step + flat.length) % flat.length)
      return
    }
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    // Results of an earlier text or scope are still on screen: never act on them.
    if (stale || activeIndex < 0) return
    const hit = flat[activeIndex]
    if (event.metaKey || event.ctrlKey) newChatWith(hit)
    else openHit(hit)
  }

  const openImportArchive = () => {
    onClose()
    void NiceModal.show('import-chatgpt-archive')
  }

  const query = text.trim()
  const nothingFound = query !== '' && !loading && !stale && flat.length === 0
  const newChatKey = getOS() === 'Mac' ? '⌘↵' : `${t('Ctrl')} ↵`
  let index = -1

  return (
    <div className="dg-search-layer">
      <div className="dg-search-layer__scrim" aria-hidden="true" onClick={onClose} />
      <section ref={panelRef} className="dg-qc dg-search" role="dialog" aria-modal="true" aria-label={t('Search')}>
        <div className="dg-qc__bar">
          <Search size={18} aria-hidden="true" className="dg-search__icon" />
          <input
            data-autofocus
            type="text"
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            onKeyDown={onKeyDown}
            placeholder={t('Search chats, knowledge and sources')}
            aria-label={t('Search chats, knowledge and sources')}
            aria-controls={listId}
            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="dg-search__chips">
          <button
            type="button"
            className="dg-chip dg-search__chip"
            aria-pressed={scope === 'all'}
            onClick={() => setScope('all')}
          >
            {t('All')}
          </button>
          {scopes.map((s) => (
            <button
              key={s.id}
              type="button"
              className="dg-chip dg-search__chip"
              aria-pressed={scope === s.id}
              onClick={() => setScope(s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>
        <div
          id={listId}
          className="dg-search__results"
          role="listbox"
          aria-label={t('Search')}
          aria-busy={loading || undefined}
        >
          {shown.map(({ group, label }) => (
            <div key={group} role="group" aria-labelledby={`${listId}-${group}`} className="dg-search__group">
              <div id={`${listId}-${group}`} className="dg-search__heading dg-type-caption">
                {t(label)}
              </div>
              {groups[group].map((hit) => {
                index += 1
                const i = index
                return (
                  <div
                    key={hit.id}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === activeIndex}
                    className="dg-search__hit"
                    onMouseMove={() => {
                      if (i !== activeIndex) setActive(i)
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => openHit(hit)}
                  >
                    <span className="dg-search__title">{hit.title}</span>
                    {hit.excerpt ? <span className="dg-search__excerpt">{hit.excerpt}</span> : null}
                    <span className="dg-search__source dg-type-caption">{hit.sourceLabel}</span>
                  </div>
                )
              })}
            </div>
          ))}
          {nothingFound ? <p className="dg-search__empty">{t('Nothing found for “{{query}}”', { query })}</p> : null}
        </div>
        <div className="dg-qc__foot">
          <span>
            <kbd className="dg-kbd">↵</kbd> {t('Open')}
          </span>
          <span>
            <kbd className="dg-kbd">{newChatKey}</kbd> {t('New chat with it')}
          </span>
          <span>
            <kbd className="dg-kbd">{t('Esc')}</kbd> {t('Close')}
          </span>
          {platformCapabilities.supportsImportedArchives ? (
            <button type="button" className="dg-link dg-search__import" onClick={openImportArchive}>
              {t('Import ChatGPT archive')}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  )
}

/** The ⌘K overlay (SE1). Renders nothing while closed, so nothing stays mounted that could hide #root. */
export function SearchOverlay(): JSX.Element | null {
  const open = useUIStore((s) => s.openSearchDialog)
  const setOpen = useUIStore((s) => s.setOpenSearchDialog)
  if (!open) return null
  return createPortal(<OpenSearchOverlay onClose={() => setOpen(false)} />, document.body)
}
