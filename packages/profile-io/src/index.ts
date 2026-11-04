export const PACKAGE_NAME = '@chameleon/profile-io' as const;

// Pipeline de importacao (parse -> versao -> migracao -> normalizacao -> validacao -> defaults -> ids)
export {
  importProfile,
  loadProfile,
  type ImportOptions,
  type ImportResult,
  type LoadOptions,
  type LoadResult,
} from './import';

// Parse seguro e serializacao
export {
  detectTextFormat,
  parseProfileText,
  type ParseError,
  type ParseErrorCode,
  type ParseResult,
  type ProfileTextFormat,
} from './parse';
export { serializeProfile } from './serialize';
export { DEFAULT_PARSE_LIMITS, FORBIDDEN_KEYS, type ParseLimits } from './limits';

// Versao, migracao, normalizacao, validacao
export { detectSchemaVersion, type VersionDetection } from './version';
export {
  MIGRATION_CHAIN,
  migrateLegacyToCurrent,
  migratePreviousToCurrent,
  migrateV1ToV2,
  type MigrateResult,
} from './migrate';
export { isEmptyRecord, normalizeProfileData, type NormalizeResult } from './normalize';
export { validateProfile, type ValidateResult, type ValidationMode } from './validate';

// Governanca de importacao
export { applyImportDefaults, type ApplyDefaultsResult } from './defaults';
export { assignIds, type AssignIdsOptions, type AssignIdsResult } from './ids';
export {
  buildImportPreview,
  type CollectionPreview,
  type ImportPreview,
  type PreviewAction,
  type PreviewRecord,
} from './preview';
export { ReportBuilder } from './report';
