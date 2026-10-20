import { useCallback, useEffect, useRef } from 'react'
import { askCostHeadsUp, type CostHeadsUpInput, cancelCostHeadsUpFrom } from '@/components/chat/before-send'

export type { CostHeadsUpInput } from '@/components/chat/before-send'

/**
 * CS1 for the composer: before a send that may cost more than the user's limit, ask once through the route's
 * shared before-send sheet (`BeforeSendHost`), the same one the message actions use. Run sends; Cancel or Esc keeps
 * the draft. Call `confirm` before sending only — never during a turn.
 */
export function useCostHeadsUp(): { confirm(input: CostHeadsUpInput): Promise<boolean> } {
  const owner = useRef({}).current

  // A composer that goes away answers Cancel, so no send waits forever.
  useEffect(() => () => cancelCostHeadsUpFrom(owner), [owner])

  const confirm = useCallback((input: CostHeadsUpInput) => askCostHeadsUp(input, owner), [owner])
  return { confirm }
}
