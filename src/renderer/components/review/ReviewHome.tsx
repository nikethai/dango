import type { Scope } from '@shared/types'
import { isEverywhere } from '@shared/types/scope'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { readScopes, useScopes } from '@/hooks/useScopes'
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
  // The hook's list is [] both before storage loads and for a user with no scopes, so ask storage once.
  const [stored, setStored] = useState<Scope[] | undefined>(undefined)
  useEffect(() => {
    let live = true
    readScopes()
      .then((list) => live && setStored(list))
      .catch(() => live && setStored([]))
    return () => {
      live = false
    }
  }, [])
  const loaded = scopes.length > 0 || stored !== undefined
  const known = scopes.length > 0 ? scopes : (stored ?? [])
  // A stale `?scope=` (a deleted scope) falls back to All scopes without rewriting the URL. Until scopes have
  // loaded, keep the id rather than flash the wrong state; the toolbar then reads Loading, never All scopes.
  // Toolbar and feed get this one resolved id.
  const scope =
    requested === undefined || isEverywhere(requested) || !loaded || known.some((s) => s.id === requested)
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
