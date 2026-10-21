import { openAddSourceSheet } from '@/components/sources/AddSourceSheet'
import { registerReviewOpener } from '@/packages/review/registry'
import { setReviewEntryState } from '@/packages/review/store'
import { SKIPPED_SOURCE_REF } from './firstRun'

/**
 * Opens the skipped-source Needs you entry (`ref: { type: 'setup', id: 'first-run:source' }`): the Add a source sheet
 * in the entry's scope. Once a source is connected the entry is done; closing the sheet leaves it open. Returns the
 * unregister function; `__root` registers it in an effect, like the other openers.
 */
export function registerFirstRunOpener(): () => void {
  return registerReviewOpener(
    'setup',
    async (entry) => {
      const result = await openAddSourceSheet({ scopeId: entry.scopeId })
      if (result) await setReviewEntryState({ id: entry.id }, 'done')
    },
    { canOpen: (entry) => entry.ref.id === SKIPPED_SOURCE_REF.id }
  )
}
