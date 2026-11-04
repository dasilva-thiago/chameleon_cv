import { isBlankValue, normalizeTerm } from '@chameleon/contracts';
import { v7 as uuidV7, validate as uuidValidate, version as uuidVersion } from 'uuid';

/**
 * Normalizacao de texto, chaves e ids. Funcoes puras (a unica fonte de aleatoriedade, `newId`,
 * pode ser substituida em testes).
 */

export { isBlankValue, normalizeTerm as normalizeKey };

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export interface NormalizeTextOptions {
  /** Preserva quebras de linha (paragrafos) em vez de colapsar tudo em uma linha. */
  multiline?: boolean;
}

/**
 * Normaliza um texto de entrada: NFC, fim de linha LF, sem caracteres de controle, sem espacos
 * nas pontas e (modo linha unica) com espacos internos colapsados.
 */
export function normalizeText(value: string, options: NormalizeTextOptions = {}): string {
  const base = value.normalize('NFC').replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '');
  if (!options.multiline) return base.replace(/\s+/g, ' ').trim();
  // preserva a indentacao inicial de cada linha (listas, recuos); colapsa espacos internos e remove os finais
  return base
    .split('\n')
    .map((line) => {
      const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
      return (
        indent +
        line
          .slice(indent.length)
          .replace(/[ \t]+/g, ' ')
          .trimEnd()
      );
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** `""`/espacos viram `null`; qualquer outro texto e normalizado. */
export function emptyToNull(
  value: string | null | undefined,
  options?: NormalizeTextOptions,
): string | null {
  if (value === null || value === undefined) return null;
  const normalized = normalizeText(value, options);
  return normalized === '' ? null : normalized;
}

/** Remove duplicatas por chave normalizada, mantendo a primeira ocorrencia e a ordem. */
export function uniqueByKey(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = normalizeTerm(value);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** Uniao sem duplicatas (por chave normalizada) de varias listas, preservando a ordem. */
export function unionStrings(
  ...lists: readonly (readonly string[] | null | undefined)[]
): string[] {
  return uniqueByKey(lists.flatMap((list) => list ?? []));
}

// ---------------------------------------------------------------------------
// Ids

/** UUID v7 (ordenavel por tempo). */
export function newId(): string {
  return uuidV7();
}

export function isUuid(value: string): boolean {
  return uuidValidate(value);
}

export function isUuidV7(value: string): boolean {
  return uuidValidate(value) && uuidVersion(value) === 7;
}

/**
 * Alocador deterministico de ids locais (`PREFIXO-001`), sem colidir com ids ja usados.
 * Usado por migracoes para criar registros que precisam ser referenciados.
 */
export function createLocalIdAllocator(taken: Iterable<string> = []): (prefix: string) => string {
  const used = new Set(taken);
  const counters = new Map<string, number>();
  return (prefix: string) => {
    let counter = counters.get(prefix) ?? 0;
    let candidate: string;
    do {
      counter += 1;
      candidate = `${prefix}-${String(counter).padStart(3, '0')}`;
    } while (used.has(candidate));
    counters.set(prefix, counter);
    used.add(candidate);
    return candidate;
  };
}
