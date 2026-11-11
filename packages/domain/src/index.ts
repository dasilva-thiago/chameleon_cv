export const PACKAGE_NAME = '@chameleon/domain' as const;

export * from './snapshot';
export { fold, containsTerm, containsQuote, tidy } from './text/fold';
export {
  parseBaseCv,
  stripInline,
  type BaseContact,
  type BaseCv,
  type BaseEducation,
  type BaseExperience,
  type BaseProject,
  type BaseSkillGroup,
} from './cv/parse';
export { avoidedExpressions, resumeLanguage } from './profile/rules';
export {
  buildBaseResume,
  buildResume,
  findExperience,
  reconcileOrigins,
  resumeText,
  type BuildResult,
  type TailoredPlan,
} from './resume/build';
export { keywordCoverage, validateResume, type ValidationSources } from './resume/validate';
export {
  finalizeAnalysis,
  recommendationFor,
  verifyExtraction,
  type DraftEvaluation,
  type FinalizeInput,
} from './analysis/verify';
