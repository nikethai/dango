import { isEverywhere } from '@shared/types/scope'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useScopes } from '@/hooks/useScopes'
import { useLastCheckedAt, useReviewEntries } from '@/packages/review'
import { hasSources } from './feedSelectors'
import { ReviewEmpty } from './ReviewEmpty'
import { ReviewFeed } from './ReviewFeed'
import { ReviewToolbar } from './ReviewToolbar'
import './review-home.css'

export type ReviewHomeProps = { sourceCount?: number }

export function ReviewHome({ sourceCount }: ReviewHomeProps) {
  const { scope: requested } = useSearch({ from: '/' })
  const { scopes } = useScopes()
  // A stale `?scope=` (a deleted scope) falls back to All scopes without rewriting the URL. An empty list
  // means scopes have not loaded yet, so keep the id rather than flash the wrong state.
  const scope =
    requested === undefined || isEverywhere(requested) || scopes.length === 0 || scopes.some((s) => s.id === requested)
      ? requested
      : undefined
  const navigate = useNavigate({ from: '/' })
  const entries = useReviewEntries()
  const lastCheckedAt = useLastCheckedAt()
  const sourced = hasSources({ sourceCount, entries, lastCheckedAt })

  return (
    <div className="dango-review-home">
      <ReviewToolbar
        scopeId={scope}
        onScopeChange={(id) => void navigate({ search: (prev) => ({ ...prev, scope: id }), replace: true })}
      />
      {sourced ? (
        <ReviewFeed scopeId={scope} caughtUp={<ReviewEmpty variant="caught-up" lastCheckedAt={lastCheckedAt} />} />
      ) : (
        <ReviewEmpty variant="no-sources" />
      )}
    </div>
  )
}
