import { t } from 'i18next'
import { useCallback } from 'react'
import { KnowledgeConflictError } from '@/packages/knowledge/approve'
import { toastFailure, useGuarded } from '@/packages/knowledge/review/useGuarded'
import { quote } from '@/packages/knowledge/text'

/**
 * Runs one knowledge action at a time (the shared in-flight guard). A contradiction toasts
 * `Waiting in Review: …`, a duplicate toasts `Already saved`, anything else the generic failure.
 * The package functions push their own undo; callers must not.
 */
export function useKnowledgeAction() {
  const onError = useCallback(async (error: unknown): Promise<boolean> => {
    // Loaded on demand: the toast store reads localStorage.
    const toastActions = await import('@/stores/toastActions')
    if (error instanceof KnowledgeConflictError) {
      toastActions.add(t('Waiting in Review: it contradicts "{{old}}"', { old: quote(error.oldText) }))
      return true
    }
    if (error instanceof Error && error.message === 'duplicate') {
      toastActions.add(t('Already saved'))
      return true
    }
    await toastFailure()
    return true
  }, [])
  return useGuarded(onError)
}
