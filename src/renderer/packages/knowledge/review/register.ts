import { registerReviewOpener, registerReviewRenderer } from '@/packages/review'
import { ConflictRenderer } from './ConflictRenderer'
import { ProposalRenderer } from './ProposalRenderer'
import { RecheckRenderer } from './RecheckRenderer'

/**
 * Registers the Review renderers for proposals, conflicts and re-checks, and the opener for a knowledge
 * re-check. Proposals and conflicts register by ref type, so a slice-10 draft proposal never lands here.
 * Returns the unregister function.
 */
export function registerKnowledgeRenderers(): () => void {
  const offs = [
    registerReviewRenderer('proposal', ProposalRenderer, { refType: 'proposal' }),
    registerReviewRenderer('conflict', ConflictRenderer, { refType: 'conflict' }),
    registerReviewRenderer('re-check', RecheckRenderer),
    registerReviewOpener('knowledge', async (entry) => {
      // Loaded on demand: the router pulls in every route.
      const { router } = await import('@/router')
      await router.navigate({ to: '/scope/$scopeId', params: { scopeId: entry.scopeId }, search: { tab: 'knowledge' } })
    }),
  ]
  return () => {
    for (const off of offs) off()
  }
}
