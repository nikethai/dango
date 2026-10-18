import type { ReviewEntry } from '@shared/types/review'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect } from 'react'
import { startNewChat } from '@/lib/startNewChat'
import { hasReviewOpener, registerReviewOpener } from '@/packages/review'
import { ReviewFeed } from './ReviewFeed'
import { ReviewToolbar } from './ReviewToolbar'
import './review-home.css'

export type ReviewHomeProps = { sourceCount?: number }

export function ReviewHome(_props: ReviewHomeProps) {
  const { scope } = useSearch({ from: '/' })
  const navigate = useNavigate({ from: '/' })

  // Default opener for a question row: a chat with the question prefilled. Slice 10 may replace it.
  useEffect(() => {
    if (hasReviewOpener({ ref: { type: 'question' } } as ReviewEntry)) return
    return registerReviewOpener('question', (e) => startNewChat({ prefill: e.text, scopeId: e.scopeId }))
  }, [])

  return (
    <div className="dango-review-home">
      <ReviewToolbar
        scopeId={scope}
        onScopeChange={(id) => void navigate({ search: (prev) => ({ ...prev, scope: id }), replace: true })}
      />
      {/* Task 6: pass `caughtUp` and the empty states here. */}
      <ReviewFeed scopeId={scope} />
    </div>
  )
}
