import { z } from 'zod';
import { isDefinitelyBefore } from '../../common/dates';
import { metaSchema } from '../../common/meta';
import { fieldStatesSchema, localIdSchema } from '../../common/primitives';
import { isBlankValue } from '../../common/text';
import { recordFieldNames } from './paths';

/**
 * Fabricas de objetos do contrato. Todos os objetos sao FECHADOS (`strictObject`):
 * chaves desconhecidas geram erro com caminho (domain-model.md 2.1).
 * Os `superRefine` aqui sao regras locais ao registro; a integridade entre registros
 * fica em `integrity.ts`.
 */

export interface RecordOptions {
  /** Chaves que classificam o registro mas nao contam como "conteudo" (ex.: `kind`, `type`). */
  discriminators?: readonly string[];
}

const STATES_THAT_FORBID_VALUE = new Set([
  'not_provided',
  'not_applicable',
  'not_assessed',
  'declined',
]);

type Ctx = z.RefinementCtx;

/**
 * Campos que aceitam estado explicito: os de primeiro nivel do registro e os caminhos aninhados
 * dentro dele (`metric.value`, `business.portfolio_url`), os mesmos aceitos por `target.field`.
 */
function allowedFieldStateKeys(shape: z.ZodRawShape): ReadonlySet<string> {
  const keys = new Set<string>(Object.keys(shape));
  for (const name of recordFieldNames(z.strictObject(shape))) keys.add(name);
  return keys;
}

/** Valor em um caminho `a.b.c` dentro do registro (undefined se algum nivel nao e objeto). */
function valueAtPath(record: Record<string, unknown>, field: string): unknown {
  let current: unknown = record;
  for (const segment of field.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function checkFieldStates(
  states: unknown,
  record: Record<string, unknown>,
  fieldKeys: ReadonlySet<string>,
  ctx: Ctx,
  basePath: (string | number)[],
): void {
  if (!states || typeof states !== 'object') return;
  for (const [field, state] of Object.entries(states as Record<string, unknown>)) {
    if (!fieldKeys.has(field)) {
      ctx.addIssue({
        code: 'custom',
        message: `field_states: "${field}" nao e um campo deste registro.`,
        path: [...basePath, field],
      });
      continue;
    }
    if (typeof state === 'string' && STATES_THAT_FORBID_VALUE.has(state)) {
      if (!isBlankValue(valueAtPath(record, field))) {
        ctx.addIssue({
          code: 'custom',
          message: `field_states: "${field}" esta marcado como ${state}, mas tem valor preenchido (conflito).`,
          path: [...basePath, field],
        });
      }
    }
  }
}

function hasContent(
  record: Record<string, unknown>,
  fieldKeys: readonly string[],
  discriminators: readonly string[],
): boolean {
  return fieldKeys.some((key) => !discriminators.includes(key) && !isBlankValue(record[key]));
}

/** Registro com `id` mas sem `meta` (contatos, evidencias, pendencias, restricoes, colaboradores). */
export function plainRecord<S extends z.ZodRawShape>(shape: S, options: RecordOptions = {}) {
  const fieldKeys = Object.keys(shape);
  const discriminators = options.discriminators ?? [];
  return z.strictObject({ id: localIdSchema.nullish(), ...shape }).superRefine((record, ctx) => {
    if (!hasContent(record, fieldKeys, discriminators)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Registro sem conteudo: preencha ao menos um campo ou remova o registro.',
        path: [],
      });
    }
  });
}

/** Registro citavel: `id` + campos + `meta` de governanca. */
export function factRecord<S extends z.ZodRawShape>(shape: S, options: RecordOptions = {}) {
  const fieldKeys = Object.keys(shape);
  const stateKeys = allowedFieldStateKeys(shape);
  const discriminators = options.discriminators ?? [];
  return z
    .strictObject({ id: localIdSchema.nullish(), ...shape, meta: metaSchema.nullish() })
    .superRefine((record, ctx) => {
      const rec = record as Record<string, unknown>;
      if (!hasContent(rec, fieldKeys, discriminators)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Registro sem conteudo: preencha ao menos um campo ou remova o registro.',
          path: [],
        });
      }
      const meta = rec.meta as { field_states?: unknown } | null | undefined;
      checkFieldStates(meta?.field_states, rec, stateKeys, ctx, ['meta', 'field_states']);
    });
}

/** Bloco singleton (identity, positioning, ...): sem id; `field_states` esparso proprio. */
export function block<S extends z.ZodRawShape>(shape: S) {
  const fieldKeys = allowedFieldStateKeys(shape);
  return z
    .strictObject({ ...shape, field_states: fieldStatesSchema.nullish() })
    .superRefine((value, ctx) => {
      const rec = value as Record<string, unknown>;
      checkFieldStates(rec.field_states, rec, fieldKeys, ctx, ['field_states']);
    });
}

/** Objeto aninhado simples (ex.: location, metric), fechado e sem regras de conteudo. */
export function nested<S extends z.ZodRawShape>(shape: S) {
  return z.strictObject(shape);
}

/** Regra: o fim do periodo nao pode ser definitivamente anterior ao inicio. */
export function periodRule(startKey: string, endKey: string) {
  return (record: unknown, ctx: Ctx): void => {
    const rec = record as Record<string, unknown>;
    const start = rec[startKey];
    const end = rec[endKey];
    if (typeof start === 'string' && typeof end === 'string' && end !== 'present') {
      if (isDefinitelyBefore(end, start)) {
        ctx.addIssue({
          code: 'custom',
          message: `${endKey} (${end}) e anterior a ${startKey} (${start}).`,
          path: [endKey],
        });
      }
    }
  };
}
