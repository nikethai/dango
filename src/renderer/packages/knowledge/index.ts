export { addKnowledge, approveProposal, KnowledgeConflictError } from './approve'
export { resolveConflict } from './conflicts'
export { type ContradictionChecker, checkAgainstLayers, selectCandidates } from './contradictions'
export { formatKnowledgeSection, isLegacyMemoryActive, knowledgeForTurn } from './for-turn'
export { useKnowledgeList, useKnowledgeUses, useProposalConflictText, useProposalsForMessage } from './hooks'
export { initKnowledge } from './init'
export {
  editKnowledge,
  type KnowledgeListOptions,
  listKnowledge,
  markSourceRemoved,
  moveKnowledge,
  NEVER_SEND_EMAIL,
  reapproveKnowledge,
  removeKnowledge,
} from './lifecycle'
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
export { listKnowledgeUses, recordKnowledgeUse } from './uses'
