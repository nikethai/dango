import type { Message } from '@shared/types'
import { useTranslation } from 'react-i18next'
import platform from '@/platform'

const MAX_CITATION_CHIPS = 4

/** How many approved knowledge items the answer was given with (slice 4's `knowledgeIds`). */
export function usedKnowledgeCount(message: Message): number {
  return message.knowledgeIds?.length ?? 0
}

/** Only web links open; anything else (javascript:, file:, malformed) stays a plain label. */
export function openableUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}

/** Source chips under a Quick Chat answer: up to four citations, "+n" for the rest, and the knowledge chip. */
export function QuickSourceChips({ message }: { message: Message }) {
  const { t } = useTranslation()
  const citations = message.citations ?? []
  const shown = citations.slice(0, MAX_CITATION_CHIPS)
  const rest = citations.length - shown.length
  const knowledge = usedKnowledgeCount(message) > 0
  if (shown.length === 0 && !knowledge) return null

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--dango-space-2)' }}>
      {shown.map((citation) => {
        const url = openableUrl(citation.url)
        // Citation titles are external text: React children only.
        return url ? (
          <button
            key={`${citation.index}-${citation.url}`}
            type="button"
            className="dg-chip"
            style={{ cursor: 'pointer', maxWidth: '100%' }}
            onClick={() => {
              platform.openLink(url).catch(() => undefined)
            }}
          >
            <span className="min-w-0 truncate">{citation.title}</span>
          </button>
        ) : (
          <span key={`${citation.index}-${citation.url}`} className="dg-chip" style={{ maxWidth: '100%' }}>
            <span className="min-w-0 truncate">{citation.title}</span>
          </span>
        )
      })}
      {rest > 0 ? <span className="dg-chip">{t('+{{n}}', { n: rest })}</span> : null}
      {knowledge ? <span className="dg-chip dg-chip--green">{t('From approved knowledge')}</span> : null}
    </div>
  )
}
