import { registerSourceKind } from './kinds'
import { codexThreadsKind } from './kinds/codex-threads'
import { documentsKind } from './kinds/documents'
import { folderKind } from './kinds/folder'
import { asanaKind, gmailKind } from './kinds/oauth'

/** Registers the five built-in kinds (runs on import; tests call it again after a reset). */
export function registerBuiltinSourceKinds(): void {
  for (const def of [folderKind, gmailKind, asanaKind, codexThreadsKind, documentsKind]) registerSourceKind(def)
}

registerBuiltinSourceKinds()

// `initBackgroundJobs` (setup/background_jobs.ts) registers the resolver, handlers and job opener; not done here.
export {
  connectSource,
  discardSourceDraft,
  draftWasDiscarded,
  MCP_SOURCE_OPTION,
  pickSource,
  registerSourceFixHandlers,
  syncJobLabel,
} from './connect'
export { dueReviews, dueSyncs, startDueJobs } from './jobs'
export {
  _resetSourceKindsForTests,
  getSourceKind,
  listSourceKinds,
  registerSourceAdapter,
  registerSourceKind,
  type SourceAdapter,
  type SourceChoice,
  type SourceKindDefinition,
} from './kinds'
export {
  _resetCodexDetectionForTests,
  codexThreadsFound,
  codexThreadsHint,
  getCodexDetection,
  useCodexDetection,
} from './kinds/codex-threads'
export { INTEGRATIONS_ROUTE, isOAuthClientIdError, OAuthClientIdError } from './kinds/oauth'
export {
  _resetReviewForTests,
  buildReviewPrompt,
  type ProposalDraft,
  parseProposalDraft,
  REVIEW_BATCH_CHARS,
  reviewJobHandler,
  syncJobHandler,
} from './review'
export {
  _resetSourcesForTests,
  addSource,
  adoptExistingFolderBindings,
  getSource,
  listSources,
  loadSources,
  registerSourcesResolver,
  revokeSource,
  type SourceRuleCode,
  SourceRuleError,
  sourceRuleErrorText,
  sourcesStore,
  updateSource,
  useSources,
  useSourcesLoaded,
} from './store'
