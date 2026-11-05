import {
  ProfileValidationError,
  safeParseProfileDocument,
  type ApiErrorDetail,
  type ProfileDocument,
  type ProfileIssue,
} from '@chameleon/contracts';
import { ProfileStoreError } from '@chameleon/db';
import type { z } from 'zod';
import { HttpError } from '../../http/errors';

/** The 404 every missing/foreign/malformed resource answers: byte-identical to the generic not-found handler. */
export const notFound = (): HttpError => new HttpError(404, 'NOT_FOUND', 'Recurso nao encontrado.');

const MAX_DETAILS = 20;

/**
 * Validation details are `path` + a contract message, never the offending value. `unrecognized_keys`
 * messages list the key names the client sent, so they are replaced by a fixed text.
 */
export function issueDetails(issues: readonly ProfileIssue[], prefix = ''): ApiErrorDetail[] {
  return issues.slice(0, MAX_DETAILS).map((issue) => ({
    path: [prefix, issue.path].filter((part) => part !== '').join('.'),
    message:
      issue.code === 'unrecognized_keys'
        ? 'Campo desconhecido neste local.'
        : issue.message.slice(0, 300),
  }));
}

export function validationError(details: readonly ApiErrorDetail[], message = 'Dados invalidos.') {
  return new HttpError(400, 'VALIDATION_ERROR', message, { details });
}

/** Validates a whole document against the contract; throws `400 VALIDATION_ERROR` with paths and reasons. */
export function requireValidDocument(input: unknown, prefix = ''): ProfileDocument {
  const result = safeParseProfileDocument(input);
  if (!result.success) throw validationError(issueDetails(result.issues, prefix));
  return result.data;
}

/** Store/contract errors -> structured HTTP errors. Unknown errors pass through (the handler logs them as 500). */
export function translateStoreError(error: unknown): unknown {
  if (error instanceof HttpError) return error;
  if (error instanceof ProfileValidationError) return validationError(issueDetails(error.issues));
  if (error instanceof ProfileStoreError) {
    switch (error.code) {
      case 'NON_UUID_ID':
        return validationError([{ path: 'id', message: 'Id de registro invalido.' }]);
      case 'PROFILE_NOT_FOUND':
      case 'REVISION_NOT_FOUND':
      case 'IMPORT_NOT_FOUND':
        return notFound();
      case 'IMPORT_NOT_APPLICABLE':
        return new HttpError(409, 'IMPORT_NOT_APPLICABLE', 'A importacao nao esta mais em previa.');
      case 'ID_CONFLICT':
        return new HttpError(
          409,
          'ID_CONFLICT',
          'Algum id do arquivo ja esta em uso. Aplique gerando ids novos (regenerateConflictingIds).',
        );
      case 'DUPLICATE_SKILL':
        return new HttpError(409, 'DUPLICATE_SKILL', 'Ja existe uma competencia equivalente.');
      case 'CONCURRENT_MODIFICATION':
        return new HttpError(409, 'CONCURRENT_MODIFICATION', 'Conflito de concorrencia: repita.');
      default:
        return error; // REVISION_CORRUPT, UNMAPPED_FIELD: bugs/integrity -> logged 500
    }
  }
  return error;
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A path id. Malformed ids answer the same 404 as missing and foreign ones (no oracle, no 400 shape). */
export function uuidParam(value: unknown): string {
  if (typeof value !== 'string' || !UUID_SHAPE.test(value)) throw notFound();
  return value.toLowerCase();
}

/**
 * Validates a request DTO. Failure -> `400 VALIDATION_ERROR` with `path` + contract message, capped, and
 * with the client's unknown key names replaced by a fixed text (see `issueDetails`).
 */
export function parseDto<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  throw validationError(zodDetails(result.error.issues));
}

export function zodDetails(issues: readonly z.core.$ZodIssue[], prefix = ''): ApiErrorDetail[] {
  return issues.slice(0, MAX_DETAILS).map((issue) => ({
    path: [prefix, issue.path.map(String).join('.')].filter((part) => part !== '').join('.'),
    message:
      issue.code === 'unrecognized_keys'
        ? 'Campo desconhecido neste local.'
        : issue.message.slice(0, 300),
  }));
}
