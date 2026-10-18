import type { ReviewEntry } from '@shared/types/review'
import { displayKind } from './feedSelectors'
import type { ReviewAction } from './ReviewItem'

export type DefaultActionHandlers = { open(): void; undo(): void; approve(): void; dismiss(): void }
export type DefaultActionContext = { canOpen: boolean; canUndo: boolean; canApply: boolean }

/** English labels; the renderer translates them. The first action is the primary one, Dismiss is ghost. */
export function defaultActions(e: ReviewEntry, h: DefaultActionHandlers, ctx: DefaultActionContext): ReviewAction[] {
  const kind = displayKind(e)
  const actions: ReviewAction[] = []

  if (kind === 'done') {
    if (ctx.canOpen) actions.push({ label: 'Open', onClick: h.open, variant: 'primary' })
    if (ctx.canUndo) actions.push({ label: 'Undo', onClick: h.undo, variant: ctx.canOpen ? 'secondary' : 'primary' })
    return actions
  }

  // An applier-backed row applies (proposal kind only); otherwise an opener opens; with neither, no primary.
  const primaryHandler = ctx.canApply ? h.approve : ctx.canOpen ? h.open : undefined
  if (primaryHandler) {
    const fallback = kind === 'needs-you' ? 'Answer' : kind === 'proposal' ? 'Approve' : 'Open'
    const label = e.actionLabel ?? fallback
    // Without actionLabel only these kinds have a default primary; others (conflict, re-check) get Dismiss alone.
    if (e.actionLabel || kind === 'needs-you' || kind === 'change' || kind === 'proposal') {
      actions.push({ label, onClick: primaryHandler, variant: 'primary' })
    }
  }
  actions.push({ label: 'Dismiss', onClick: h.dismiss, variant: 'ghost' })
  return actions
}
