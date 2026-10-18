import type { KnowledgeItem, KnowledgeState, KnowledgeUse, KnowledgeUseRef } from '@shared/types/knowledge'
import { t } from 'i18next'
import { getLogger } from '@/lib/utils'
import { addReviewEntry, setReviewEntryState } from '@/packages/review'
import { commitKnowledge, knowledgeStore } from './store'
import { quote } from './text'

const log = getLogger('knowledge')

/** Each item keeps its newest uses only. */
export const USES_PER_ITEM = 50

/** The item's uses, newest first. Pure, so hooks and `listKnowledgeUses` share it. */
export function selectKnowledgeUses(state: KnowledgeState, itemId: string): KnowledgeUse[] {
  return state.uses.filter((u) => u.itemId === itemId).sort((a, b) => b.at - a.at)
}

export function listKnowledgeUses(itemId: string): KnowledgeUse[] {
  return selectKnowledgeUses(knowledgeStore.getState().state, itemId)
}

const keyOfUse = (itemId: string, ref: KnowledgeUseRef) => JSON.stringify([itemId, ref.type, ref.id])

/**
 * Records that a chat, draft or change used these items (background write: no undo). The same item and ref
 * only moves `at` (and takes the newer label); each item keeps its newest `USES_PER_ITEM`. Ids that name
 * no stored item (the built-in one included) are skipped. Indexed once per commit, so a turn with many items
 * stays linear in the number of uses.
 */
export async function recordKnowledgeUse(itemIds: string[], ref: KnowledgeUseRef): Promise<void> {
  const ids = [...new Set(itemIds)]
  if (!ids.length) return
  await commitKnowledge((d) => {
    const now = Date.now()
    const items = new Map(d.items.map((i) => [i.id, i]))
    const uses = new Map(d.uses.map((u) => [keyOfUse(u.itemId, u.ref), u]))
    const touched = new Set<string>()
    for (const itemId of ids) {
      const item = items.get(itemId)
      if (!item) continue
      touched.add(itemId)
      const existing = uses.get(keyOfUse(itemId, ref))
      if (existing) {
        existing.at = now
        existing.ref = { ...ref }
      } else {
        const use: KnowledgeUse = { itemId, scopeId: item.scopeId, ref: { ...ref }, at: now }
        d.uses.push(use)
        uses.set(keyOfUse(itemId, ref), use)
      }
    }
    // Trim only the items this call touched: group their uses, keep each one's newest.
    const perItem = new Map<string, KnowledgeUse[]>()
    for (const u of d.uses) {
      if (!touched.has(u.itemId)) continue
      const list = perItem.get(u.itemId)
      if (list) list.push(u)
      else perItem.set(u.itemId, [u])
    }
    const dropped = new Set<string>()
    for (const list of perItem.values()) {
      if (list.length <= USES_PER_ITEM) continue
      for (const u of [...list].sort((a, b) => b.at - a.at).slice(USES_PER_ITEM)) dropped.add(keyOfUse(u.itemId, u.ref))
    }
    if (dropped.size) d.uses = d.uses.filter((u) => !dropped.has(keyOfUse(u.itemId, u.ref)))
  })
}

export type RecheckReason = 'replaced' | 'edited' | 'removed'

function recheckSub(reason: RecheckReason, text: string): string {
  const vars = { text: quote(text) }
  if (reason === 'replaced') return t('It used "{{text}}", which was replaced.', vars)
  if (reason === 'edited') return t('It used "{{text}}", which you edited.', vars)
  return t('It used "{{text}}", which you removed.', vars)
}

/**
 * After an edit, a remove or a superseding: one `re-check` Review entry for every draft or change that used
 * an affected item (`text` = the item's wording that the draft used). Returns the entry ids, for the
 * action's undo to dismiss. A failed entry is logged and never fails the action.
 */
export async function fileRechecks(
  affected: Array<Pick<KnowledgeItem, 'id' | 'text'>>,
  reason: RecheckReason
): Promise<string[]> {
  const state = knowledgeStore.getState().state
  const ids: string[] = []
  for (const item of affected) {
    for (const use of selectKnowledgeUses(state, item.id)) {
      if (use.ref.type !== 'draft' && use.ref.type !== 'change') continue
      try {
        const entry = await addReviewEntry({
          kind: 're-check',
          scopeId: use.scopeId,
          text: use.ref.label,
          sub: recheckSub(reason, item.text),
          ref: use.ref,
        })
        ids.push(entry.id)
      } catch (error) {
        log.error('Knowledge re-check entry failed:', error)
      }
    }
  }
  return ids
}

/** Undo of an action that filed re-checks: dismisses them. */
export async function dismissRechecks(ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      await setReviewEntryState({ id }, 'dismissed')
    } catch (error) {
      log.error('Knowledge re-check dismiss failed:', error)
    }
  }
}
