import {
  cloneJson,
  isBlankValue,
  listRecords,
  normalizePhone,
  RECORD_DISCRIMINATORS,
  type RecordKind,
} from '@chameleon/contracts';
import { normalizeText } from '@chameleon/domain';
import { FORBIDDEN_KEYS } from './limits';
import type { ReportBuilder } from './report';

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const OWN_KEYS = new Set(['id', 'meta', 'field_states']);

const formatPath = (path: readonly (string | number)[]): string =>
  path.reduce<string>(
    (acc, segment) =>
      typeof segment === 'number' ? `${acc}[${segment}]` : acc ? `${acc}.${segment}` : segment,
    '',
  );

/** Registro "fantasma": nenhum campo de conteudo (alem de id, meta e discriminadores). */
export function isEmptyRecord(kind: RecordKind, record: Json): boolean {
  const discriminators: readonly string[] =
    (RECORD_DISCRIMINATORS as Partial<Record<RecordKind, readonly string[]>>)[kind] ?? [];
  return Object.entries(record).every(
    ([key, value]) => OWN_KEYS.has(key) || discriminators.includes(key) || isBlankValue(value),
  );
}

/** Remove registros sem conteudo de todas as colecoes (mais profundos primeiro). */
function dropEmptyRecords(document: Json, report: ReportBuilder): number {
  let dropped = 0;
  // Do mais profundo para o mais raso, e de tras para frente, para manter os indices validos.
  const entries = listRecords(document).sort(
    (a, b) => b.path.length - a.path.length || compareIndexPaths(b.path, a.path),
  );
  for (const entry of entries) {
    if (!isEmptyRecord(entry.kind, entry.value)) continue;
    const parentPath = entry.path.slice(0, -1);
    let parent: unknown = document;
    for (const segment of parentPath) {
      parent = (parent as Record<string | number, unknown>)[segment];
    }
    const index = entry.path[entry.path.length - 1];
    if (Array.isArray(parent) && typeof index === 'number') {
      parent.splice(index, 1);
      dropped += 1;
      report.warn(
        'EMPTY_RECORD_DROPPED',
        formatPath(entry.path),
        `Registro sem conteudo (${entry.kind}) descartado.`,
      );
    }
  }
  return dropped;
}

function compareIndexPaths(
  a: readonly (string | number)[],
  b: readonly (string | number)[],
): number {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x).localeCompare(String(y));
  }
  return a.length - b.length;
}

interface NormalizeCounters {
  emptyStrings: number;
  emptyItems: number;
  whitespace: number;
}

function normalizeNode(
  value: unknown,
  path: (string | number)[],
  report: ReportBuilder,
  counters: NormalizeCounters,
): unknown {
  if (typeof value === 'string') {
    const normalized = normalizeText(value, { multiline: true });
    if (normalized !== value && normalized !== '') counters.whitespace += 1;
    return normalized === '' ? null : normalized;
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    let dropped = 0;
    value.forEach((item, index) => {
      const next = normalizeNode(item, [...path, index], report, counters);
      if (next === null) {
        dropped += 1;
      } else {
        out.push(next);
      }
    });
    if (dropped > 0) {
      counters.emptyItems += dropped;
      report.warn(
        'EMPTY_LIST_ITEM_DROPPED',
        formatPath(path),
        `${dropped} item(ns) vazio(s) removido(s) da lista.`,
      );
    }
    return out;
  }
  if (isObject(value)) {
    const out: Json = {};
    const emptied: string[] = [];
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) {
        report.warn(
          'UNKNOWN_KEY_UNMAPPED',
          formatPath([...path, key]),
          `Chave proibida "${key}" ignorada.`,
        );
        continue;
      }
      const wasBlankString = typeof child === 'string' && child.trim() === '';
      const next = normalizeNode(child, [...path, key], report, counters);
      if (wasBlankString) emptied.push(key);
      out[key] = next;
    }
    if (emptied.length > 0) {
      counters.emptyStrings += emptied.length;
      const shown = emptied.slice(0, 8).join(', ');
      report.warn(
        'EMPTY_STRING_NORMALIZED',
        formatPath(path),
        `${emptied.length} campo(s) com texto vazio normalizado(s) para null: ${shown}${emptied.length > 8 ? ', ...' : ''}.`,
      );
    }
    return out;
  }
  return value;
}

/**
 * Telefones em formato comum ("(12) 91234-5678", "+55 12 91234-5678") -> forma canonica (digitos
 * com + opcional). Valor que nao e normalizavel e MANTIDO como esta para que a validacao do
 * contrato o rejeite com mensagem propria (sem ecoar o valor). So avisa a contagem.
 */
function normalizePhones(document: Json, report: ReportBuilder): number {
  let changed = 0;
  for (const entry of listRecords(document)) {
    if (entry.kind !== 'contact_point' || entry.value.kind !== 'phone') continue;
    const value = entry.value.value;
    if (typeof value !== 'string') continue;
    const result = normalizePhone(value);
    if (result.ok && result.value !== value) {
      entry.value.value = result.value;
      changed += 1;
    }
  }
  if (changed > 0) {
    report.info(
      'PHONE_NORMALIZED',
      null,
      `${changed} telefone(s) normalizado(s) para a forma canonica (digitos e + opcional).`,
    );
  }
  return changed;
}

export interface NormalizeResult {
  data: unknown;
  droppedRecords: number;
  emptyStrings: number;
}

/**
 * Normalizacao ESTRUTURAL de um documento v2 ainda nao validado:
 * 1. descarta registros sem conteudo (`EMPTY_RECORD_DROPPED`);
 * 2. normaliza texto (NFC, espacos, fim de linha) e converte `""` em `null` (`EMPTY_STRING_NORMALIZED`);
 * 3. remove itens vazios de listas (`EMPTY_LIST_ITEM_DROPPED`).
 * Nao aplica defaults de governanca nem ids (ver `applyImportDefaults` e `assignIds`).
 */
export function normalizeProfileData(input: unknown, report: ReportBuilder): NormalizeResult {
  if (!isObject(input)) return { data: input, droppedRecords: 0, emptyStrings: 0 };
  const copy = cloneJson(input);
  const droppedRecords = dropEmptyRecords(copy, report);
  const counters: NormalizeCounters = { emptyStrings: 0, emptyItems: 0, whitespace: 0 };
  const data = normalizeNode(copy, [], report, counters);
  const phonesNormalized = isObject(data) ? normalizePhones(data, report) : 0;
  report.step(
    'normalize',
    null,
    'normalized',
    'Normalizacao de texto, "" -> null, telefones e descarte de registros sem conteudo.',
    droppedRecords + counters.emptyStrings + counters.emptyItems + phonesNormalized,
  );
  return { data, droppedRecords, emptyStrings: counters.emptyStrings };
}
