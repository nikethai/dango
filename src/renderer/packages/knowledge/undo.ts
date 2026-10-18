import { pushUndo } from '@/packages/undo'

/**
 * The one undo record a user-facing knowledge mutator pushes (group `knowledge`, so a newer one retires it).
 * Undo awaits `revert()`, then `onUndo`.
 */
export function pushKnowledgeUndo(
  message: string,
  revert: () => Promise<void>,
  opts?: { extra?: { label: string; onClick: () => void }; onUndo?: () => Promise<void> }
): string {
  return pushUndo({
    group: 'knowledge',
    message,
    extra: opts?.extra,
    undo: async () => {
      await revert()
      await opts?.onUndo?.()
    },
  })
}
