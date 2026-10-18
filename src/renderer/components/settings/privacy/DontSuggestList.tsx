import { useTranslation } from 'react-i18next'
import type { DontSuggestRow } from './useDontSuggestEntries'

export function DontSuggestList(props: { items: DontSuggestRow[]; onRestore(id: string): void }) {
  const { items, onRestore } = props
  const { t } = useTranslation()
  if (items.length === 0) {
    return (
      <div style={{ padding: 'var(--dango-space-4)' }}>
        <div className="dg-type-body" style={{ fontWeight: 600 }}>
          {t('Nothing here yet.')}
        </div>
        <div className="dg-type-caption">
          {t("When you choose “Don't suggest this again” on a proposal, it is listed here so you can turn it back on.")}
        </div>
      </div>
    )
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {items.map((item) => (
        <li
          key={item.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--dango-space-3)',
            padding: 'var(--dango-space-3) var(--dango-space-4)',
          }}
        >
          <div className="min-w-0">
            <div className="dg-type-body">{item.text}</div>
            <div className="dg-type-caption">
              {item.scopeLabel} · {new Date(item.at).toLocaleDateString()}
            </div>
          </div>
          <button type="button" className="dg-btn dg-btn--ghost" onClick={() => onRestore(item.id)}>
            {t('Suggest again')}
          </button>
        </li>
      ))}
    </ul>
  )
}
