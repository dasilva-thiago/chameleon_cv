import type {
  ApplySummaryDto,
  ImportRecordDto,
  ProfileStateResponse,
  RevisionSummaryDto,
  SaveResultDto,
} from '@chameleon/contracts';
import type {
  ApplySummary,
  ImportRecordView,
  LoadedProfile,
  RevisionResult,
  RevisionSummary,
  SaveResult,
} from '@chameleon/db';
import { emptySummary, summarize } from './doc';

/** Mappers from store views to the public DTOs (dates as ISO strings, no internal ids such as `profileId`). */

export function stateResponse(loaded: LoadedProfile | null): ProfileStateResponse {
  if (!loaded) return { exists: false, profile: null, document: null, summary: emptySummary() };
  return {
    exists: true,
    profile: {
      id: loaded.profileId,
      storedSchemaVersion: loaded.storedSchemaVersion,
      createdAt: loaded.createdAt.toISOString(),
      updatedAt: loaded.updatedAt.toISOString(),
    },
    document: loaded.document,
    summary: summarize(loaded.document),
  };
}

export function revisionDto(revision: RevisionSummary): RevisionSummaryDto {
  return {
    id: revision.id,
    revisionNumber: revision.revisionNumber,
    schemaVersion: revision.schemaVersion,
    contentHash: revision.contentHash,
    reason: revision.reason,
    createdAt: revision.createdAt.toISOString(),
  };
}

export function revisionResultDto(result: RevisionResult) {
  return { revision: revisionDto(result.revision), reused: result.reused };
}

export const applySummaryDto = (summary: ApplySummary): ApplySummaryDto => ({
  created: summary.created,
  updated: summary.updated,
  unchanged: summary.unchanged,
  archived: summary.archived,
  deleted: summary.deleted,
  kept: summary.kept,
  totals: summary.totals,
});

export function saveResultDto(save: SaveResult): SaveResultDto {
  return {
    profileCreated: save.profileCreated,
    summary: applySummaryDto(save.summary),
    generatedIds: save.generatedIds,
    revision: save.revision ? revisionResultDto(save.revision) : null,
  };
}

// --- Import ----------------------------------------------------------------------------------

/**
 * Parse/validation errors come from third-party libraries and from the contract; some of their messages echo
 * input (a JSON syntax error quotes the text, a forbidden or unknown key quotes the key, a YAML tag quotes the
 * tag). What the client gets is a FIXED text per code, so hostile content never comes back in an error body.
 */
const FIXED_MESSAGES: Record<string, string> = {
  EMPTY: 'O arquivo esta vazio.',
  TOO_LARGE: 'O arquivo excede o tamanho maximo permitido.',
  SYNTAX: 'Sintaxe invalida (YAML/JSON).',
  DUPLICATE_KEY: 'Chave duplicada no arquivo.',
  MULTIPLE_DOCUMENTS: 'O arquivo tem mais de um documento YAML.',
  ALIAS_NOT_ALLOWED: 'Aliases YAML nao sao permitidos.',
  ANCHOR_NOT_ALLOWED: 'Ancoras YAML nao sao permitidas.',
  TAG_NOT_ALLOWED: 'Tags YAML explicitas nao sao permitidas.',
  MERGE_KEY_NOT_ALLOWED: 'Chaves de mescla YAML (<<) nao sao permitidas.',
  FORBIDDEN_KEY: 'O arquivo contem uma chave proibida.',
  TOO_DEEP: 'Aninhamento profundo demais.',
  TOO_MANY_NODES: 'O documento tem elementos demais.',
  STRING_TOO_LONG: 'Um texto do arquivo e longo demais.',
  KEY_TOO_LONG: 'Uma chave do arquivo e longa demais.',
  NON_FINITE_NUMBER: 'Numero nao finito no arquivo.',
  NOT_AN_OBJECT: 'A raiz do arquivo deve ser um mapa/objeto.',
  unrecognized_keys: 'Campo desconhecido neste local.',
  VERSION_MISSING: 'O arquivo nao informa schema_version.',
  VERSION_INVALID: 'schema_version invalida.',
  VERSION_FUTURE: 'schema_version mais nova que a suportada.',
  VERSION_UNSUPPORTED: 'schema_version nao suportada.',
};

/** Paths of parse-stage errors are empty; others come from the contract and name fields (never values). */
const safePath = (path: string): string => path.slice(0, 200);

export function importErrorViews(
  errors: readonly { path: string; code: string; message: string }[],
): ImportRecordDto['errors'] {
  return errors.slice(0, 20).map((error) => ({
    path: safePath(error.path),
    code: error.code.slice(0, 64),
    message: FIXED_MESSAGES[error.code] ?? error.message.slice(0, 300),
  }));
}

export function importRecordDto(view: ImportRecordView): ImportRecordDto {
  return {
    id: view.id,
    status: view.status,
    sourceFormat: view.sourceFormat,
    sourceSchemaVersion: view.sourceSchemaVersion,
    targetSchemaVersion: view.targetSchemaVersion,
    mode: view.mode,
    steps: view.steps,
    warnings: view.warnings,
    errors: importErrorViews(view.errors),
    idMap: view.idMap,
    unmappedCount: view.unmapped.length,
    summary: view.summary,
    revisionId: view.revisionId,
    createdAt: view.createdAt.toISOString(),
    appliedAt: view.appliedAt ? view.appliedAt.toISOString() : null,
  };
}

export const MAX_UNMAPPED_IN_RESPONSE = 200;
