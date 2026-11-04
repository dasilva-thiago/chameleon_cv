import {
  emailSchema,
  httpUrlSchema,
  isBlankValue,
  LIMITS,
  localeSchema,
  partialDateSchema,
  normalizePhone,
  timezoneSchema,
} from '@chameleon/contracts';
import {
  createLocalIdAllocator,
  emptyToNull,
  normalizeKey,
  normalizeText,
} from '@chameleon/domain';
import type { ReportBuilder } from '../report';

export type Obj = Record<string, unknown>;
export const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export type Size = 'short' | 'text' | 'long';
export const SIZE_LIMIT: Record<Size, number> = {
  short: LIMITS.shortText,
  text: LIMITS.text,
  long: LIMITS.longText,
};

export const formatPath = (base: string, key: string | number): string =>
  typeof key === 'number' ? `${base}[${key}]` : base ? `${base}.${key}` : key;

/**
 * Chaves que, no 1.0.0, eram preenchidas com DEFAULTS do modelo (enums, booleanos, ids, status)
 * e portanto nao contam como conteudo ao decidir se um registro e "fantasma".
 */
const NON_CONTENT_KEYS = new Set([
  'id',
  'evidence_ids',
  'fact_status',
  'status',
  'priority',
  'category',
  'type',
  'usage_context',
  'context',
  'self_assessed_level',
  'visibility',
  'include_by_default',
  'disclosure',
  'public_disclosure',
  'client_names_disclosure',
  'participation_type',
  'employment_type',
  'work_mode',
  'degree_type',
  'modality',
  'scope',
  'resume_usage',
  'include_in_resume',
  'overall_level',
  'reading',
  'writing',
  'listening',
  'speaking',
  'frequency',
  'autonomy',
  'reference_contact_permission',
  'is_public',
  'team_based',
  'is_current',
  'certificate_issued',
  'approved_for_recruiter_sharing',
]);

/** `true` se o valor 1.0.0 carrega conteudo real (texto, data, lista nao vazia, numero). */
export function hasV1Content(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return true;
  if (typeof value === 'boolean') return false;
  if (Array.isArray(value)) return value.some(hasV1Content);
  if (isObj(value)) {
    return Object.entries(value).some(
      ([key, child]) => !NON_CONTENT_KEYS.has(key) && hasV1Content(child),
    );
  }
  return false;
}

/** Estado compartilhado da migracao: relatorio, alocador de ids, registradores de avisos agregados. */
export class MigrationContext {
  readonly alloc: (prefix: string) => string;
  private readonly isEnglish: boolean;
  private readonly blanks = new Map<string, string[]>();

  constructor(
    readonly report: ReportBuilder,
    takenIds: Iterable<string>,
    locale: string | null | undefined,
  ) {
    this.alloc = createLocalIdAllocator(takenIds);
    this.isEnglish = typeof locale === 'string' && locale.toLowerCase().startsWith('en');
  }

  /** Texto de apoio gerado pelo sistema (pendencias, notas) no idioma do perfil. */
  t(pt: string, en: string): string {
    return this.isEnglish ? en : pt;
  }

  /** Emite um aviso agregado por objeto para campos vazios normalizados. */
  flushBlankStrings(): void {
    for (const [path, keys] of this.blanks) {
      const shown = keys.slice(0, 8).join(', ');
      this.report.warn(
        'EMPTY_STRING_NORMALIZED',
        path,
        `${keys.length} campo(s) com texto vazio normalizado(s) para null: ${shown}${keys.length > 8 ? ', ...' : ''}.`,
      );
    }
    this.blanks.clear();
  }

  private markBlank(path: string, key: string): void {
    const list = this.blanks.get(path);
    if (list) list.push(key);
    else this.blanks.set(path, [key]);
  }

  /** Registra campos vazios de um objeto que sera descartado ou nao lido (apenas blocos). */
  countBlankStrings(source: Obj, path: string): void {
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === 'string' && value.trim() === '') this.markBlank(path, key);
    }
  }

  /** Texto normalizado; limitado ao tamanho do destino (o excedente vai para `unmapped`). */
  text(
    source: Obj,
    key: string,
    path: string,
    size: Size = 'short',
    notes?: string[],
  ): string | null {
    const raw = source[key];
    if (typeof raw !== 'string') return null;
    if (raw.trim() === '') {
      this.markBlank(path, key);
      return null;
    }
    const normalized = normalizeText(raw, { multiline: size !== 'short' });
    return this.fit(normalized, size, formatPath(path, key), notes);
  }

  fit(value: string, size: Size, path: string, notes?: string[]): string {
    const limit = SIZE_LIMIT[size];
    if (value.length <= limit) return value;
    this.report.addUnmapped(
      path,
      value,
      `Texto original (acima de ${limit} caracteres) preservado.`,
    );
    this.report.warn(
      'TEXT_TRUNCATED',
      path,
      `Texto truncado para ${limit} caracteres (original em unmapped).`,
    );
    notes?.push(`${path}: ${value.slice(limit)}`);
    return value.slice(0, limit);
  }

  /** Lista de textos: remove vazios e duplicatas exatas, respeita limites. */
  list(source: Obj, key: string, path: string, size: Size = 'short'): string[] {
    const raw = source[key];
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    let dropped = 0;
    raw.forEach((item, index) => {
      if (typeof item !== 'string') return;
      const normalized = emptyToNull(item, { multiline: size !== 'short' });
      if (normalized === null) {
        dropped += 1;
        return;
      }
      const fitted = this.fit(normalized, size, formatPath(formatPath(path, key), index));
      if (!out.includes(fitted)) out.push(fitted);
    });
    if (dropped > 0) {
      this.report.warn(
        'EMPTY_LIST_ITEM_DROPPED',
        formatPath(path, key),
        `${dropped} item(ns) vazio(s) removido(s) da lista.`,
      );
    }
    if (out.length > LIMITS.shortList) {
      const extra = out.splice(LIMITS.shortList);
      this.report.addUnmapped(formatPath(path, key), extra, 'Itens alem do limite da lista.');
      this.report.warn(
        'TEXT_TRUNCATED',
        formatPath(path, key),
        `Lista truncada em ${LIMITS.shortList} itens.`,
      );
    }
    return out;
  }

  /**
   * Valor de enum do 1.0.0 -> enum do 2.0.0. `aliases` mapeia sinonimos (ou `null` = ausente).
   * Valor invalido: descartado, com aviso e o texto original em `notes` (ou `unmapped`).
   */
  enumValue<T extends string>(
    source: Obj,
    key: string,
    path: string,
    allowed: readonly T[],
    options: { aliases?: Record<string, T | null>; notes?: string[] } = {},
  ): T | null {
    const raw = source[key];
    if (typeof raw !== 'string') return null;
    if (raw.trim() === '') {
      this.markBlank(path, key);
      return null;
    }
    const norm = raw.trim();
    const slug = norm.toLowerCase().replace(/[\s-]+/g, '_');
    const direct = allowed.find((value) => value === norm || value.toLowerCase() === slug);
    if (direct) return direct;
    if (options.aliases && slug in options.aliases) return options.aliases[slug] ?? null;
    this.reject(
      path,
      key,
      raw,
      'INVALID_ENUM_VALUE_DROPPED',
      options.notes,
      `valor "${raw}" nao e aceito`,
    );
    return null;
  }

  /**
   * Nivel que pode ser enum OU texto descritivo: se reconhecido (ou alias), devolve o enum; senao
   * devolve o texto original em `described` (limitado ao tamanho do destino). Nunca inventa o enum.
   */
  enumOrDescribed<T extends string>(
    source: Obj,
    key: string,
    path: string,
    allowed: readonly T[],
    aliases: Record<string, T | null> = {},
  ): { value: T | null; described: string | null } {
    const raw = source[key];
    if (typeof raw !== 'string') return { value: null, described: null };
    if (raw.trim() === '') {
      this.markBlank(path, key);
      return { value: null, described: null };
    }
    const norm = raw.trim();
    const slug = norm.toLowerCase().replace(/[\s-]+/g, '_');
    const direct = allowed.find((value) => value === norm || value.toLowerCase() === slug);
    if (direct) return { value: direct, described: null };
    if (slug in aliases) return { value: aliases[slug] ?? null, described: null };
    const described = this.fit(normalizeText(raw), 'short', formatPath(path, key));
    this.report.info(
      'LANGUAGE_LEVEL_SELF_DESCRIBED',
      formatPath(path, key),
      `Campo ${key}: o texto nao e um nivel CEFR/native; preservado em self_described_level (sem conversao para CEFR).`,
    );
    return { value: null, described };
  }

  /** Descarta um valor invalido registrando o aviso e guardando o original. */
  reject(
    path: string,
    key: string,
    original: unknown,
    code: 'INVALID_ENUM_VALUE_DROPPED' | 'INVALID_VALUE_MOVED_TO_NOTES' | 'INVALID_VALUE_DROPPED',
    notes: string[] | undefined,
    detail: string,
  ): void {
    const full = formatPath(path, key);
    if (notes) {
      notes.push(`${key} (1.0.0): ${String(original)}`);
      this.report.warn(
        'INVALID_VALUE_MOVED_TO_NOTES',
        full,
        `Campo ${key}: ${detail}; valor original guardado em meta.private_notes.`,
      );
    } else {
      this.report.addUnmapped(full, original, `Valor invalido descartado: ${detail}.`);
      this.report.warn(
        code === 'INVALID_ENUM_VALUE_DROPPED' ? code : 'INVALID_VALUE_DROPPED',
        full,
        `Campo ${key}: ${detail}; valor preservado em unmapped.`,
      );
    }
  }

  date(
    source: Obj,
    key: string,
    path: string,
    notes?: string[],
    allowPresent = false,
  ): string | null {
    const raw = source[key];
    if (typeof raw !== 'string') return null;
    if (raw.trim() === '') {
      this.markBlank(path, key);
      return null;
    }
    const value = raw.trim();
    if (allowPresent && value === 'present') return value;
    if (partialDateSchema.safeParse(value).success) return value;
    this.reject(
      path,
      key,
      raw,
      'INVALID_VALUE_MOVED_TO_NOTES',
      notes,
      'data fora do formato AAAA, AAAA-MM ou AAAA-MM-DD',
    );
    return null;
  }

  url(source: Obj, key: string, path: string, notes?: string[]): string | null {
    const raw = this.text(source, key, path, 'short');
    if (raw === null) return null;
    if (httpUrlSchema.safeParse(raw).success) return raw;
    this.reject(path, key, raw, 'INVALID_VALUE_MOVED_TO_NOTES', notes, 'URL invalida');
    return null;
  }

  email(value: string, path: string): string | null {
    if (emailSchema.safeParse(value).success) return value;
    this.report.addUnmapped(path, value, 'E-mail invalido descartado.');
    this.report.warn(
      'INVALID_VALUE_DROPPED',
      path,
      'E-mail invalido descartado (valor em unmapped).',
    );
    return null;
  }

  /** Telefone em forma comum -> forma canonica (digitos e + opcional); invalido e descartado. */
  phone(value: string, path: string): string | null {
    const result = normalizePhone(value);
    if (result.ok) {
      if (result.value !== value) {
        this.report.info('PHONE_NORMALIZED', path, 'Telefone normalizado para a forma canonica.');
      }
      return result.value;
    }
    this.report.addUnmapped(path, value, 'Telefone invalido descartado.');
    this.report.warn(
      'INVALID_VALUE_DROPPED',
      path,
      'Telefone invalido descartado (valor em unmapped).',
    );
    return null;
  }

  locale(value: string, path: string): string | null {
    if (localeSchema.safeParse(value).success) return value;
    this.report.addUnmapped(path, value, 'Locale invalido descartado.');
    this.report.warn(
      'INVALID_VALUE_DROPPED',
      path,
      `Locale "${value}" invalido descartado (use BCP-47).`,
    );
    return null;
  }

  timezone(value: string, path: string): string | null {
    if (timezoneSchema.safeParse(value).success) return value;
    this.report.addUnmapped(path, value, 'Fuso horario invalido descartado.');
    this.report.warn('INVALID_VALUE_DROPPED', path, `Fuso "${value}" invalido descartado.`);
    return null;
  }

  /** Reporta chaves fora do conhecido no 1.0.0 (objetos abertos) sem descartar o valor. */
  unknownKeys(source: Obj, known: readonly string[], path: string): void {
    for (const [key, value] of Object.entries(source)) {
      if (known.includes(key)) continue;
      const full = formatPath(path, key);
      this.report.addUnmapped(
        full,
        value,
        'Chave desconhecida no contrato 1.0.0; preservada fora do modelo.',
      );
      this.report.warn(
        'UNKNOWN_KEY_UNMAPPED',
        full,
        `Chave "${key}" nao existe no contrato; preservada em unmapped.`,
      );
    }
  }

  /** Chave normalizada de competencia (dedupe). */
  skillKey(name: string): string {
    return normalizeKey(name);
  }

  isBlank(value: unknown): boolean {
    return isBlankValue(value);
  }
}
