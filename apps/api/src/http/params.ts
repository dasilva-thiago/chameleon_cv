import type { ApiErrorDetail } from '@chameleon/contracts';
import type { z } from 'zod';
import { HttpError } from './errors';

/** The 404 every missing/foreign/malformed resource answers: byte-identical to the generic not-found handler. */
export const notFound = (): HttpError => new HttpError(404, 'NOT_FOUND', 'Recurso nao encontrado.');

const MAX_DETAILS = 20;

export function validationError(details: readonly ApiErrorDetail[], message = 'Dados invalidos.') {
  return new HttpError(400, 'VALIDATION_ERROR', message, { details });
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A path id. Malformed ids answer the same 404 as missing and foreign ones (no oracle, no 400 shape). */
export function uuidParam(value: unknown): string {
  if (typeof value !== 'string' || !UUID_SHAPE.test(value)) throw notFound();
  return value.toLowerCase();
}

/**
 * Validates a request DTO. Failure -> `400 VALIDATION_ERROR` with `path` + contract message, capped, and
 * with the client's unknown key names replaced by a fixed text.
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
