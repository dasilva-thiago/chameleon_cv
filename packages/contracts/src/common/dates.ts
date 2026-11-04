/**
 * Datas parciais (AAAA, AAAA-MM, AAAA-MM-DD): validacao e limites de intervalo.
 * Implementacao minima e pura, compartilhada pelo contrato Zod e por `@chameleon/domain/dates`.
 * A precisao e inferida do comprimento e nunca e aumentada pelo sistema (domain-model.md 2.1).
 */

export const PARTIAL_DATE_REGEX = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;

export type DatePrecision = 'year' | 'month' | 'day';

export interface PartialDateParts {
  year: number;
  month: number | null;
  day: number | null;
  precision: DatePrecision;
}

/** Menor ano aceito (evita `0000`, que nao e uma data de calendario util). */
export const MIN_YEAR = 1000;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Devolve as partes da data ou `null` quando o texto nao e uma data parcial valida de calendario. */
export function parsePartialDateParts(value: string): PartialDateParts | null {
  if (typeof value !== 'string' || !PARTIAL_DATE_REGEX.test(value)) return null;
  const year = Number(value.slice(0, 4));
  if (year < MIN_YEAR) return null;
  if (value.length === 4) return { year, month: null, day: null, precision: 'year' };
  const month = Number(value.slice(5, 7));
  if (value.length === 7) return { year, month, day: null, precision: 'month' };
  const day = Number(value.slice(8, 10));
  if (day > daysInMonth(year, month)) return null;
  return { year, month, day, precision: 'day' };
}

export function isValidPartialDate(value: string): boolean {
  return parsePartialDateParts(value) !== null;
}

/** Chave numerica AAAAMMDD do primeiro dia coberto pela data. */
export function earliestKey(parts: PartialDateParts): number {
  return parts.year * 10_000 + (parts.month ?? 1) * 100 + (parts.day ?? 1);
}

/** Chave numerica AAAAMMDD do ultimo dia coberto pela data. */
export function latestKey(parts: PartialDateParts): number {
  const month = parts.month ?? 12;
  const day = parts.day ?? daysInMonth(parts.year, month);
  return parts.year * 10_000 + month * 100 + day;
}

/**
 * `true` somente quando `a` termina estritamente antes de `b` comecar
 * (ex.: "2019" esta antes de "2020-03"; "2020" nao esta antes de "2020-03").
 * Entradas invalidas devolvem `false` (a validacao de formato acontece em outro lugar).
 */
export function isDefinitelyBefore(a: string, b: string): boolean {
  const pa = parsePartialDateParts(a);
  const pb = parsePartialDateParts(b);
  if (!pa || !pb) return false;
  return latestKey(pa) < earliestKey(pb);
}
