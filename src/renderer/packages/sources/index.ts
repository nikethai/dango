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

// Task 6 registers the job opener and the sources resolver (after `registerSourcesResolver()`); not done here.
export {
  connectSource,
  discardSourceDraft,
  MCP_SOURCE_OPTION,
  pickSource,
  registerSourceFixHandlers,
  syncJobLabel,
} from './connect'
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
  codexThreadsHint,
  getCodexDetection,
  useCodexDetection,
} from './kinds/codex-threads'
export { INTEGRATIONS_ROUTE, isOAuthClientIdError, OAuthClientIdError } from './kinds/oauth'
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
