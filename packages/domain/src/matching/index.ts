export {
  MATCHER_VERSION,
  analyzeJob,
  analyzeRequirements,
  type AnalyzeRequirementsInput,
} from './match';
export { buildMatchIndex, type IndexedFact, type MatchIndex } from './profile-index';
export {
  EXTRACTOR_VERSION,
  extractKeywords,
  extractRequirements,
  looksLikeInstructions,
} from './requirements';
export { foldDiacritics, haystackOf, tokenize } from './text';
