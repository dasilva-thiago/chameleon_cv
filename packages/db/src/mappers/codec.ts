import { parsePartialDateParts } from '@chameleon/contracts';
import type { DateSpec, ScalarSpec } from './specs';

/** Linha de tabela como objeto simples (colunas camelCase; datas como `Date`). */
export type Row = Record<string, unknown>;
export type Json = Record<string, unknown>;

export type Precision = 'year' | 'month' | 'day';

export const isJsonObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// ---------------------------------------------------------------------------
// Datas parciais <-> (date, precision)

/** `AAAA[-MM[-DD]]` -> primeiro dia do periodo (UTC) + precisao. Nunca aumenta a precisao. */
export function partialDateToColumns(value: string): { date: Date; precision: Precision } {
  const parts = parsePartialDateParts(value);
  if (!parts) throw new TypeError('Data parcial invalida.');
  return {
    date: new Date(Date.UTC(parts.year, (parts.month ?? 1) - 1, parts.day ?? 1)),
    precision: parts.precision,
  };
}

/** (date, precision) -> `AAAA[-MM[-DD]]` com a MESMA precisao declarada. */
export function columnsToPartialDate(date: Date, precision: Precision): string {
  const iso = date.toISOString().slice(0, 10);
  if (precision === 'year') return iso.slice(0, 4);
  if (precision === 'month') return iso.slice(0, 7);
  return iso;
}

// ---------------------------------------------------------------------------
// Registro do contrato -> colunas + details

export interface CodecSpec {
  scalars: readonly ScalarSpec[];
  dates: readonly DateSpec[];
  special: readonly string[];
}

export interface EncodedRecord {
  columns: Row;
  /** Atributos nao mapeados em coluna (chaves do contrato); `null` quando nao ha nenhum. */
  details: Json | null;
}

/**
 * Separa um registro (ja canonico: sem nulos) em colunas e `details`. `id` e `meta` nao entram:
 * pertencem ao ProfileFact. Chaves `special` (filhos e vinculos) sao tratadas por quem chama.
 */
export function encodeRecord(record: Json, spec: CodecSpec): EncodedRecord {
  const consumed = new Set<string>(['id', 'meta', ...spec.special]);
  const columns: Row = {};
  const nestedLeft = new Map<string, Json>();

  for (const scalar of spec.scalars) {
    const dot = scalar.key.indexOf('.');
    let value: unknown;
    if (dot === -1) {
      value = record[scalar.key];
      consumed.add(scalar.key);
    } else {
      const parentKey = scalar.key.slice(0, dot);
      const childKey = scalar.key.slice(dot + 1);
      consumed.add(parentKey);
      const parent = record[parentKey];
      if (!nestedLeft.has(parentKey)) {
        nestedLeft.set(parentKey, isJsonObject(parent) ? { ...parent } : {});
      }
      const leftover = nestedLeft.get(parentKey)!;
      value = isJsonObject(parent) ? parent[childKey] : undefined;
      delete leftover[childKey];
    }
    columns[scalar.prop] = value ?? null;
  }

  for (const date of spec.dates) {
    consumed.add(date.key);
    const value = record[date.key];
    columns[date.dateProp] = null;
    columns[date.precisionProp] = null;
    if (date.currentProp) columns[date.currentProp] = false;
    if (typeof value !== 'string') continue;
    if (value === 'present' && date.currentProp) {
      columns[date.currentProp] = true;
      continue;
    }
    const encoded = partialDateToColumns(value);
    columns[date.dateProp] = encoded.date;
    columns[date.precisionProp] = encoded.precision;
  }

  const details: Json = {};
  for (const [key, value] of Object.entries(record)) {
    if (consumed.has(key) || value === undefined || value === null) continue;
    details[key] = value;
  }
  // Objeto aninhado: o que sobrou fora das colunas, ou `{}` se o objeto existia vazio.
  for (const [parentKey, leftover] of nestedLeft) {
    const original = record[parentKey];
    if (!isJsonObject(original)) continue;
    const hasColumnValue = spec.scalars.some(
      (s) => s.key.startsWith(`${parentKey}.`) && columns[s.prop] !== null,
    );
    if (Object.keys(leftover).length > 0) details[parentKey] = leftover;
    else if (!hasColumnValue) details[parentKey] = {};
  }
  return { columns, details: Object.keys(details).length > 0 ? details : null };
}

/** Colunas + details -> registro do contrato (sem `id`/`meta`; sem chaves nulas). */
export function decodeRecord(row: Row, details: unknown, spec: CodecSpec): Json {
  const record: Json = isJsonObject(details) ? { ...details } : {};

  for (const scalar of spec.scalars) {
    const value = row[scalar.prop];
    if (value === null || value === undefined) continue;
    const dot = scalar.key.indexOf('.');
    if (dot === -1) {
      record[scalar.key] = value;
    } else {
      const parentKey = scalar.key.slice(0, dot);
      const childKey = scalar.key.slice(dot + 1);
      const existingParent = record[parentKey];
      const parent: Json = isJsonObject(existingParent) ? { ...existingParent } : {};
      parent[childKey] = value;
      record[parentKey] = parent;
    }
  }

  for (const date of spec.dates) {
    if (date.currentProp && row[date.currentProp] === true) {
      record[date.key] = 'present';
      continue;
    }
    const value = row[date.dateProp];
    const precision = row[date.precisionProp];
    if (value instanceof Date && typeof precision === 'string') {
      record[date.key] = columnsToPartialDate(value, precision as Precision);
    }
  }
  return record;
}

// ---------------------------------------------------------------------------
// Comparacao estavel de linhas (diff)

/** Representacao textual estavel de um valor de coluna (datas em ISO; chaves ordenadas). */
export function stableValue(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner instanceof Date) return `@date:${inner.toISOString()}`;
    if (isJsonObject(inner)) {
      return Object.fromEntries(
        Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    }
    return inner === undefined ? null : inner;
  });
}

/** Colunas de `desired` que diferem de `existing` (comparando apenas as colunas de `desired`). */
export function changedColumns(desired: Row, existing: Row): string[] {
  return Object.keys(desired).filter(
    (column) => stableValue(desired[column] ?? null) !== stableValue(existing[column] ?? null),
  );
}
