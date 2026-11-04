import type { z } from 'zod';
import { defOf, unwrap } from './paths';
import { profileDocumentSchema } from './document';

/**
 * Forma canonica de um documento (para serializacao estavel e comparacao de round-trip):
 * - chaves na ordem do schema (chaves fora do schema, em ordem alfabetica, ao final);
 * - chaves `null`/`undefined` removidas (ausencia == null == not_provided; ver ADR-0005);
 * - arrays mantem a ordem e o `[]` (que significa "nenhum item fornecido").
 */
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function canon(schema: z.ZodType | undefined, value: unknown): unknown {
  const inner = schema ? unwrap(schema) : undefined;
  const def = inner ? defOf(inner) : undefined;
  if (Array.isArray(value)) {
    const element = def?.type === 'array' ? def.element : undefined;
    return value.map((item) => canon(element, item));
  }
  if (isObject(value)) {
    const shape = def?.type === 'object' ? (def.shape ?? {}) : {};
    const known = Object.keys(shape).filter((key) => key in value);
    const unknownKeys = Object.keys(value)
      .filter((key) => !(key in shape))
      .sort();
    const out: Record<string, unknown> = {};
    for (const key of [...known, ...unknownKeys]) {
      const child = canon(shape[key], value[key]);
      if (child !== null && child !== undefined) out[key] = child;
    }
    return out;
  }
  return value;
}

export function canonicalizeProfileDocument<T>(document: T): T {
  return canon(profileDocumentSchema, document) as T;
}
