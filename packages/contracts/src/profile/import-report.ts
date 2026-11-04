import { z } from 'zod';

/**
 * Relatorio de importacao/migracao (ADR-0004, ADR-0013). E o conteudo que o `ImportRecord`
 * persiste: versoes de origem e destino, passos, avisos, mapa de ids e conteudo nao mapeado.
 */

export const IMPORT_WARNING_CODES = [
  // normalizacao
  'EMPTY_STRING_NORMALIZED',
  'EMPTY_RECORD_DROPPED',
  'EMPTY_LIST_ITEM_DROPPED',
  'TEXT_WHITESPACE_NORMALIZED',
  // chaves e valores nao reconhecidos
  'UNKNOWN_KEY_UNMAPPED',
  'INVALID_ENUM_VALUE_DROPPED',
  'INVALID_VALUE_MOVED_TO_NOTES',
  'INVALID_VALUE_DROPPED',
  'TEXT_TRUNCATED',
  // governanca e privacidade
  'STATUS_SET_NEEDS_REVIEW',
  'DECLARED_STATUS_PRESERVED',
  'DEFAULTS_APPLIED',
  'DISCLOSURE_MAPPED',
  'RESUME_USAGE_MAPPED',
  'PRIVACY_FORCED_PRIVATE',
  'CONSENT_IN_FILE_NOT_RECORDED',
  'CLIENT_NAMES_RESTRICTION_ADDED',
  'ARCHIVED_STATUS_KEPT',
  // competencias e contexto
  'USAGE_CONTEXT_MAPPED',
  'USAGE_CONTEXT_UNVERIFIED',
  'SKILL_NAME_TRUNCATED',
  'SKILL_MERGED',
  // estrutura
  'FIELD_MERGED',
  'IS_CURRENT_CONFLICT',
  'RECORD_RELOCATED',
  'REFERENCE_UNRESOLVED',
  'PENDING_ITEM_CREATED',
  'ID_GENERATED',
  'ID_REMAPPED',
  'DUPLICATE_ID_RENAMED',
  // versao, valores normalizados e reimportacao (contrato 2.1.0)
  'SCHEMA_VERSION_UPGRADED',
  'PHONE_NORMALIZED',
  'LANGUAGE_LEVEL_SELF_DESCRIBED',
  'IDS_MISSING_REIMPORT_RISK',
] as const;
export const importWarningCodeSchema = z.enum(IMPORT_WARNING_CODES);
export type ImportWarningCode = z.infer<typeof importWarningCodeSchema>;

export const importWarningSchema = z.strictObject({
  code: importWarningCodeSchema,
  severity: z.enum(['info', 'warning']),
  /** Caminho no documento de ORIGEM (ou do destino, quando o passo cria registros). */
  path: z.string().nullable(),
  message: z.string(),
});
export type ImportWarning = z.infer<typeof importWarningSchema>;

export const importStepSchema = z.strictObject({
  id: z.string(),
  from: z.string().nullable(),
  to: z.string(),
  description: z.string(),
  /** Quantidade de registros ou valores afetados pelo passo. */
  changes: z.number().int().min(0),
});
export type ImportStep = z.infer<typeof importStepSchema>;

export const unmappedEntrySchema = z.strictObject({
  path: z.string(),
  value: z.unknown(),
  reason: z.string(),
});
export type UnmappedEntry = z.infer<typeof unmappedEntrySchema>;

export const importErrorSchema = z.strictObject({
  path: z.string(),
  code: z.string(),
  message: z.string(),
});
export type ImportError = z.infer<typeof importErrorSchema>;

export const importReportSchema = z.strictObject({
  source_format: z.enum(['yaml', 'json', 'object']),
  source_schema_version: z.string().nullable(),
  target_schema_version: z.string(),
  mode: z.enum(['strict', 'lenient']),
  steps: z.array(importStepSchema),
  warnings: z.array(importWarningSchema),
  errors: z.array(importErrorSchema),
  /** Conteudo descartado do contrato (modo lenient) e valores preservados fora do modelo. */
  unmapped: z.array(unmappedEntrySchema),
  /** Mapa id local -> id definitivo (UUID v7). */
  id_map: z.record(z.string(), z.string()),
});
export type ImportReport = z.infer<typeof importReportSchema>;
