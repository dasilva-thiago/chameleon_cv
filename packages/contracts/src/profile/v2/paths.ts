import type { z } from 'zod';

/**
 * Introspecao do contrato Zod: lista os caminhos de campo (usados pelo teste bidirecional do
 * template Markdown, ADR-0003, e pela validacao de alvos de pendencias/restricoes).
 *
 * Convencao de caminho: `profile.experiences[].official_title`.
 * - objeto aninhado: `.chave`;
 * - array de objetos (sub-registros): `chave[]` seguido dos campos do elemento;
 * - array de escalares (lista de textos/enums): o proprio array e o campo (sem `[]`);
 * - `record` (ex.: `field_states`) e tratado como folha.
 */

export interface ZodDef {
  type: string;
  shape?: Record<string, z.ZodType>;
  element?: z.ZodType;
  innerType?: z.ZodType;
  options?: z.ZodType[];
  entries?: Record<string, string>;
  values?: unknown[];
}

export const defOf = (schema: z.ZodType): ZodDef =>
  (schema as unknown as { _zod: { def: ZodDef } })._zod.def;

export function unwrap(schema: z.ZodType): z.ZodType {
  let current = schema;
  for (;;) {
    const def = defOf(current);
    if ((def.type === 'optional' || def.type === 'nullable') && def.innerType) {
      current = def.innerType;
    } else {
      return current;
    }
  }
}

export interface FieldPath {
  path: string;
  /** Tipo base do valor (string, number, boolean, enum, literal, union, record). */
  type: string;
  /** `true` quando o campo e uma lista de escalares. */
  list: boolean;
  /** Valores aceitos, para enums (ou lista de enums). */
  enumValues?: string[];
}

export interface ContainerPath {
  path: string;
  /** `object` (bloco aninhado) ou `array` (sub-registros). */
  type: 'object' | 'array';
}

export interface PathListing {
  leaves: FieldPath[];
  containers: ContainerPath[];
}

function enumValuesOf(schema: z.ZodType): string[] | undefined {
  const def = defOf(schema);
  if (def.type === 'enum' && def.entries) return Object.values(def.entries);
  if (def.type === 'literal' && def.values) return def.values.map(String);
  return undefined;
}

function walk(schema: z.ZodType, path: string, out: PathListing): void {
  const inner = unwrap(schema);
  const def = defOf(inner);
  switch (def.type) {
    case 'object': {
      if (path) out.containers.push({ path, type: 'object' });
      for (const [key, child] of Object.entries(def.shape ?? {})) {
        walk(child, path ? `${path}.${key}` : key, out);
      }
      return;
    }
    case 'array': {
      const element = def.element ? unwrap(def.element) : undefined;
      if (element && defOf(element).type === 'object') {
        out.containers.push({ path: `${path}[]`, type: 'array' });
        walk(element, `${path}[]`, out);
        return;
      }
      const enumValues = element ? enumValuesOf(element) : undefined;
      out.leaves.push({
        path,
        type: element ? defOf(element).type : 'unknown',
        list: true,
        ...(enumValues ? { enumValues } : {}),
      });
      return;
    }
    case 'union': {
      const options = (def.options ?? []).map(unwrap);
      const values = options.flatMap((option) => enumValuesOf(option) ?? []);
      out.leaves.push({
        path,
        type: 'union',
        list: false,
        ...(values.length ? { enumValues: values } : {}),
      });
      return;
    }
    default: {
      const enumValues = enumValuesOf(inner);
      out.leaves.push({ path, type: def.type, list: false, ...(enumValues ? { enumValues } : {}) });
    }
  }
}

/** Lista folhas e contêineres de um schema de objeto. */
export function listSchemaPaths(schema: z.ZodType, prefix = ''): PathListing {
  const out: PathListing = { leaves: [], containers: [] };
  walk(schema, prefix, out);
  return out;
}

/**
 * Nomes de campo "planos" de um registro (objetos aninhados incluidos, sub-registros excluidos),
 * usados para validar `target.field` e `field_states`. Ex.: `location`, `location.city`, `name`.
 */
export function recordFieldNames(schema: z.ZodType): Set<string> {
  const listing = listSchemaPaths(schema);
  const names = new Set<string>();
  const isOwnField = (path: string) =>
    !path.includes('[]') &&
    path !== 'id' &&
    path !== 'meta' &&
    !path.startsWith('meta.') &&
    path !== 'field_states';
  for (const leaf of listing.leaves) if (isOwnField(leaf.path)) names.add(leaf.path);
  for (const container of listing.containers) {
    if (container.type === 'object' && isOwnField(container.path)) names.add(container.path);
  }
  return names;
}
