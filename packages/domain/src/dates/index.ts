import {
  earliestKey,
  isDefinitelyBefore as contractIsDefinitelyBefore,
  latestKey,
  parsePartialDateParts,
  type DatePrecision,
  type PartialDateParts,
} from '@chameleon/contracts';

/**
 * Datas parciais (AAAA | AAAA-MM | AAAA-MM-DD) e periodos. Funcoes puras.
 *
 * Regras:
 * - a precisao e inferida do comprimento e NUNCA e aumentada (nao se inventa dia ou mes);
 * - para ordenar e comparar, uma data parcial cobre um INTERVALO (ex.: "2020" = 2020-01-01..2020-12-31);
 * - "present" so existe como fim de periodo (substitui o antigo `is_current`).
 */

export type { DatePrecision } from '@chameleon/contracts';

export interface ParsedPartialDate extends PartialDateParts {
  /** Texto original (ja validado). */
  value: string;
}

export interface Period {
  start?: string | null;
  end?: string | null; // data parcial, "present" ou ausente
}

export const PRESENT = 'present' as const;

export function parsePartialDate(value: string): ParsedPartialDate | null {
  const parts = parsePartialDateParts(value);
  return parts ? { ...parts, value } : null;
}

export function isPartialDate(value: unknown): boolean {
  return typeof value === 'string' && parsePartialDateParts(value) !== null;
}

export function datePrecision(value: string): DatePrecision | null {
  return parsePartialDateParts(value)?.precision ?? null;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function keyToIso(key: number): string {
  const year = Math.floor(key / 10_000);
  const month = Math.floor((key % 10_000) / 100);
  const day = key % 100;
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Primeiro dia coberto, em ISO completo (ex.: "2020" -> "2020-01-01"). */
export function toEarliestIsoDate(value: string): string | null {
  const parts = parsePartialDateParts(value);
  return parts ? keyToIso(earliestKey(parts)) : null;
}

/** Ultimo dia coberto, em ISO completo (ex.: "2020-02" -> "2020-02-29"). */
export function toLatestIsoDate(value: string): string | null {
  const parts = parsePartialDateParts(value);
  return parts ? keyToIso(latestKey(parts)) : null;
}

const PRECISION_RANK: Record<DatePrecision, number> = { year: 0, month: 1, day: 2 };

/**
 * Ordem total e estavel: primeiro pelo inicio do intervalo coberto, depois pela precisao
 * (a data mais grossa vem antes da mais precisa na mesma posicao).
 * Datas invalidas lancam RangeError: valide antes ou use `compareNullableDates`.
 */
export function comparePartialDates(a: string, b: string): number {
  const pa = parsePartialDateParts(a);
  const pb = parsePartialDateParts(b);
  if (!pa || !pb) throw new RangeError(`Data parcial invalida: ${pa ? b : a}`);
  const byStart = earliestKey(pa) - earliestKey(pb);
  if (byStart !== 0) return byStart < 0 ? -1 : 1;
  const byPrecision = PRECISION_RANK[pa.precision] - PRECISION_RANK[pb.precision];
  return byPrecision === 0 ? 0 : byPrecision < 0 ? -1 : 1;
}

/** Comparador tolerante para ordenar: nulos, ausentes e invalidos ficam no fim. */
export function compareNullableDates(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const da = typeof a === 'string' && isPartialDate(a) ? a : null;
  const db = typeof b === 'string' && isPartialDate(b) ? b : null;
  if (da !== null && db !== null) return comparePartialDates(da, db);
  if (da !== null) return -1;
  if (db !== null) return 1;
  return 0;
}

/** `a` termina estritamente antes de `b` comecar (certeza, mesmo com precisao diferente). */
export function isDefinitelyBefore(a: string, b: string): boolean {
  return contractIsDefinitelyBefore(a, b);
}

export function isDefinitelyAfter(a: string, b: string): boolean {
  return contractIsDefinitelyBefore(b, a);
}

/** Os intervalos cobertos pelas duas datas se tocam (podem ser o mesmo dia)? */
export function datesMayOverlap(a: string, b: string): boolean {
  const pa = parsePartialDateParts(a);
  const pb = parsePartialDateParts(b);
  if (!pa || !pb) return false;
  return earliestKey(pa) <= latestKey(pb) && earliestKey(pb) <= latestKey(pa);
}

// ---------------------------------------------------------------------------
// Periodos

export type PeriodIssueCode = 'INVALID_START' | 'INVALID_END' | 'END_BEFORE_START';

export interface PeriodIssue {
  code: PeriodIssueCode;
  message: string;
}

export function isOngoing(period: Period): boolean {
  return period.end === PRESENT;
}

export function validatePeriod(period: Period): { valid: boolean; issues: PeriodIssue[] } {
  const issues: PeriodIssue[] = [];
  const { start, end } = period;
  if (start != null && !isPartialDate(start)) {
    issues.push({ code: 'INVALID_START', message: `Inicio invalido: ${start}` });
  }
  if (end != null && end !== PRESENT && !isPartialDate(end)) {
    issues.push({ code: 'INVALID_END', message: `Fim invalido: ${end}` });
  }
  if (
    issues.length === 0 &&
    start != null &&
    end != null &&
    end !== PRESENT &&
    isDefinitelyBefore(end, start)
  ) {
    issues.push({
      code: 'END_BEFORE_START',
      message: `O fim (${end}) e anterior ao inicio (${start}).`,
    });
  }
  return { valid: issues.length === 0, issues };
}

/**
 * Ordem "mais recente primeiro" para periodos (experiencias, formacao): periodos em andamento
 * primeiro; depois pelo fim (mais recente antes); empate pelo inicio (mais recente antes);
 * periodos sem datas ficam no fim. Retorna < 0 quando `a` deve vir antes de `b`.
 */
export function comparePeriodsMostRecentFirst(a: Period, b: Period): number {
  const rank = (period: Period): [number, number] => {
    const start = period.start != null ? parsePartialDateParts(period.start) : null;
    let endKey: number | null = null;
    if (period.end === PRESENT) endKey = Number.MAX_SAFE_INTEGER;
    else if (period.end != null) {
      const end = parsePartialDateParts(period.end);
      endKey = end ? latestKey(end) : null;
    } else if (start) {
      // sem fim informado: usa o inicio como melhor estimativa (nao assume "atual")
      endKey = earliestKey(start);
    }
    return [endKey ?? -1, start ? earliestKey(start) : -1];
  };
  const [aEnd, aStart] = rank(a);
  const [bEnd, bStart] = rank(b);
  if (aEnd !== bEnd) return bEnd - aEnd < 0 ? -1 : 1;
  if (aStart !== bStart) return bStart - aStart < 0 ? -1 : 1;
  return 0;
}

function dateToKey(date: Date): number {
  return date.getUTCFullYear() * 10_000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
}

/** Dia seguinte a uma chave AAAAMMDD (limite exclusivo de um intervalo). */
function nextDayKey(key: number): number {
  const year = Math.floor(key / 10_000);
  const month = Math.floor((key % 10_000) / 100);
  const day = key % 100;
  return dateToKey(new Date(Date.UTC(year, month - 1, day + 1)));
}

/** Meses completos entre duas chaves AAAAMMDD (`to` exclusivo). Nunca negativo. */
function wholeMonthsBetween(from: number, to: number): number {
  const fy = Math.floor(from / 10_000);
  const fm = Math.floor((from % 10_000) / 100);
  const fd = from % 100;
  const ty = Math.floor(to / 10_000);
  const tm = Math.floor((to % 10_000) / 100);
  const td = to % 100;
  const months = (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
  return Math.max(0, months);
}

/**
 * Limites da duracao de um periodo em meses completos, respeitando a imprecisao das datas.
 * Exige inicio e fim conhecidos ("present" usa `now`); caso contrario devolve `null`
 * (duracao nao informada nunca e inventada).
 */
export function periodDurationMonths(
  period: Period,
  now: Date = new Date(),
): { min: number; max: number } | null {
  if (period.start == null) return null;
  const start = parsePartialDateParts(period.start);
  if (!start) return null;
  let endEarliest: number;
  let endLatest: number;
  if (period.end === PRESENT) {
    endEarliest = endLatest = dateToKey(now);
  } else if (period.end != null) {
    const end = parsePartialDateParts(period.end);
    if (!end) return null;
    endEarliest = earliestKey(end);
    endLatest = latestKey(end);
  } else {
    return null;
  }
  // minimo: do fim do intervalo de inicio ao comeco do intervalo de fim (inclusive)
  const min = wholeMonthsBetween(latestKey(start), nextDayKey(endEarliest));
  // maximo: do comeco do intervalo de inicio ao fim do intervalo de fim (inclusive)
  const max = wholeMonthsBetween(earliestKey(start), nextDayKey(endLatest));
  return { min, max };
}

// ---------------------------------------------------------------------------
// Formatacao

export type DateStyle = 'long' | 'short' | 'iso';

export interface FormatOptions {
  locale?: string;
  style?: DateStyle;
  /** Texto para `present` (padrao por idioma: pt -> "atual", en -> "present", es -> "actual"). */
  presentLabel?: string;
}

const PRESENT_LABELS: Record<string, string> = { pt: 'atual', en: 'present', es: 'actual' };

/** Formata respeitando a precisao: "2020", "marco de 2020", "5 de marco de 2020". */
export function formatPartialDate(value: string, options: FormatOptions = {}): string {
  const parts = parsePartialDateParts(value);
  if (!parts) throw new RangeError(`Data parcial invalida: ${value}`);
  const { locale = 'pt-BR', style = 'long' } = options;
  if (style === 'iso' || parts.precision === 'year') return value;
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    year: 'numeric',
    month: style === 'long' ? 'long' : 'short',
    ...(parts.precision === 'day' ? { day: 'numeric' as const } : {}),
  });
  return formatter.format(new Date(Date.UTC(parts.year, (parts.month ?? 1) - 1, parts.day ?? 1)));
}

export function formatPeriod(period: Period, options: FormatOptions = {}): string {
  const locale = options.locale ?? 'pt-BR';
  const presentLabel =
    options.presentLabel ?? PRESENT_LABELS[locale.slice(0, 2).toLowerCase()] ?? 'present';
  const start = period.start != null ? formatPartialDate(period.start, options) : null;
  const end =
    period.end === PRESENT
      ? presentLabel
      : period.end != null
        ? formatPartialDate(period.end, options)
        : null;
  if (start && end) return `${start} - ${end}`;
  if (start) return `${start} -`;
  if (end) return `- ${end}`;
  return '';
}

/** Data de hoje (UTC) no nivel de precisao pedido; util para `review.last_reviewed_date`. */
export function toPartialDate(date: Date, precision: DatePrecision = 'day'): string {
  const year = pad(date.getUTCFullYear(), 4);
  if (precision === 'year') return year;
  const month = pad(date.getUTCMonth() + 1);
  return precision === 'month' ? `${year}-${month}` : `${year}-${month}-${pad(date.getUTCDate())}`;
}
