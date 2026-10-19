import i18n from '@/i18n'
import platform, { platformCapabilities } from '@/platform'
import type { SourceKindDefinition } from '../kinds'
import { UNAVAILABLE_HINT } from './common'

// File statuses that mean "not searchable yet" (see KnowledgeBaseDocuments).
const INDEXING = new Set(['pending', 'processing', 'paused'])
const READY = 'done'

const kbIdOf = (config: Record<string, unknown>) => (typeof config.kbId === 'number' ? config.kbId : undefined)

/**
 * Points a scope at an existing Documents collection. It is searched when answering, never reviewed, and never
 * deleted when the source is removed.
 */
export const documentsKind: SourceKindDefinition = {
  kind: 'documents',
  name: 'Documents',
  hint: 'Files Dango searches when answering. Never treated as approved knowledge.',
  supportsBackgroundReview: false,
  isAvailable: () => platformCapabilities.supportsKnowledgeBase,
  unavailableHint: UNAVAILABLE_HINT,

  // The sheet chooses the collection first (`choice.kbId`); without one there is nothing to connect.
  async pick({ signal, choice }) {
    if (signal.aborted || choice?.kbId === undefined) return null
    const kbId = choice.kbId
    const collection = (await platform.getKnowledgeBaseController().list()).find((kb) => kb.id === kbId)
    if (!collection || signal.aborted) return null
    return { kind: 'documents', label: collection.name, ref: collection.name, config: { kbId } }
  },

  async sync(source) {
    const kbId = kbIdOf(source.config)
    if (kbId === undefined) throw new Error(i18n.t('This Documents source has no collection.'))
    const files = await platform.getKnowledgeBaseController().listFiles(kbId)
    // Failed files are neither ready nor still indexing.
    const indexing = files.filter((f) => INDEXING.has(f.status)).length
    const ready = i18n.t('{{count}} documents ready to search', {
      count: files.filter((f) => f.status === READY).length,
    })
    if (indexing === 0) return { summary: ready }
    return {
      summary: i18n.t('{{ready}}, {{indexing}}', {
        ready,
        indexing: i18n.t('{{count}} still indexing', { count: indexing }),
      }),
    }
  },
}
