export { type ContradictionChecker, checkAgainstLayers, selectCandidates } from './contradictions'
export { initKnowledge } from './init'
export {
  allowSuggestAgain,
  DONT_SUGGEST_WINDOW_MS,
  deferProposal,
  dismissProposal,
  getConflict,
  listDontSuggest,
  listProposals,
  moveProposalsForSession,
  proposeKnowledge,
} from './proposals'
export { scopeName } from './scopes'
export { ensureKnowledgeLoaded, type KnowledgeMigrationState } from './store'
export { contentHash, knowledgeTextKey, parseStaleAfter, quote } from './text'
export { pushKnowledgeUndo } from './undo'
