import {
  CERTIFICATION_CATEGORY_VALUES,
  CERTIFICATION_STATUS_VALUES,
  COURSE_STATUS_VALUES,
  DEGREE_TYPE_VALUES,
  EDUCATION_STATUS_VALUES,
  EMPLOYMENT_TYPE_VALUES,
  EVIDENCE_TYPE_VALUES,
  FACT_STATUS_VALUES,
  LANGUAGE_LEVEL_VALUES,
  LEGACY_V1_SHAPES,
  LOCAL_ID_REGEX,
  PARTICIPATION_TYPE_VALUES,
  PROFILE_SCHEMA_VERSION,
  PROJECT_CATEGORY_VALUES,
  PROJECT_STATUS_VALUES,
  PUBLICATION_STATUS_VALUES,
  PUBLICATION_TYPE_VALUES,
  AWARD_SCOPE_VALUES,
  AUTONOMY_VALUES,
  FREQUENCY_VALUES,
  OUTPUT_FORMAT_VALUES,
  PREFERRED_LENGTH_VALUES,
  PRIORITY_VALUES,
  REVIEWED_BY_VALUES,
  RESUME_SECTION_VALUES,
  SALARY_PERIOD_VALUES,
  SELF_ASSESSED_LEVEL_VALUES,
  SENIORITY_VALUES,
  SKILL_CATEGORY_VALUES,
  STUDY_MODALITY_VALUES,
  TONE_VALUES,
  TRI_STATE_VALUES,
  VISIBILITY_VALUES,
  VISUAL_STYLE_VALUES,
  WORK_MODE_VALUES,
  currencySchema,
  httpUrlSchema,
  nonNegativeNumber,
  type LegacyProfileV1,
  type ResumeUse,
  type UsageContext,
} from '@chameleon/contracts';
import { normalizeKey, unionStrings } from '@chameleon/domain';
import type { ReportBuilder } from '../report';
import { formatPath, hasV1Content, isObj, MigrationContext, type Obj } from './context';

/**
 * Migracao pura 1.0.0 -> 2.0.0 (ADR-0004; mapeamento em docs/domain-model.md secao 4).
 *
 * Recebe o documento 1.0.0 JA LIDO (validado por `legacyProfileV1Schema`) e devolve um objeto
 * no formato 2.0.0 (ainda nao validado pelo contrato v2) alem de registrar tudo no
 * `ReportBuilder`: avisos, passos, conteudo nao mapeado e consentimento ignorado.
 *
 * Principios: nada e descartado em silencio (valores invalidos vao para `meta.private_notes`
 * ou `report.unmapped`); defaults do 1.0.0 nao viram fatos (registros-modelo sao descartados,
 * `fact_status` vira `meta.declared_status` + `needs_review`); contexto de uso de competencia
 * nunca e "promovido" sem fonte (vira `unverified` + pendencia).
 */

const FROM = '1.0.0';
const TO = PROFILE_SCHEMA_VERSION;

/** Sinonimos de nivel que sao a MESMA coisa que um valor do enum (nao inventam CEFR). */
const LANGUAGE_LEVEL_ALIASES: Record<string, 'native' | 'not_assessed'> = {
  nativo: 'native',
  nativa: 'native',
  native_speaker: 'native',
  falante_nativo: 'native',
  nao_avaliado: 'not_assessed',
};

const DISCLOSURE_TO_RESUME_USE: Record<string, ResumeUse> = {
  approved: 'allowed',
  restricted: 'requires_approval',
  not_approved: 'never',
  not_confirmed: 'requires_approval',
};
const INCLUDE_TO_RESUME_USE: Record<string, ResumeUse> = {
  include: 'allowed',
  exclude: 'never',
  depending_on_job: 'requires_approval',
};

const DOI = /^10\.\d{4,9}\/\S+$/;

const TEMPLATE_DEFAULTS = {
  identity: { interface_languages: ['pt-BR'] },
  positioning: { current_seniority: 'not_assessed' },
  availability: {
    privacy: 'private',
    willing_to_relocate: 'not_specified',
    travel_availability: 'not_specified',
  },
  career: { interest_in_adjacent_fields: 'depends' },
  resume: {
    default_language: 'pt-BR',
    regional_variant: 'pt-BR',
    tone: 'professional_direct',
    preferred_length: 'content_based',
    output_formats: ['docx', 'pdf'],
    visual_style: 'ats_simple',
    include_photo: false,
  },
  review: { reviewed_by: 'self', processing_consent: 'not_recorded' },
} as const;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Bloco "intocado": so valores vazios ou iguais aos defaults do modelo 1.0.0. */
function isUntouchedBlock(
  source: Obj,
  defaults: Record<string, unknown>,
  ignore: readonly string[] = [],
): boolean {
  return Object.entries(source).every(([key, value]) => {
    if (ignore.includes(key)) return true;
    if (key in defaults && same(value, defaults[key])) return true;
    return isBlankDeep(value);
  });
}

function isBlankDeep(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.every(isBlankDeep);
  if (isObj(value)) return Object.values(value).every(isBlankDeep);
  return false; // numeros e booleanos sao conteudo explicito em blocos
}

const present = (value: unknown): boolean =>
  value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0);

function compact(source: Obj): Obj {
  const out: Obj = {};
  for (const [key, value] of Object.entries(source)) {
    if (present(value)) out[key] = value;
  }
  return out;
}

interface KeptRecord {
  src: Obj;
  index: number;
  path: string;
}

type SourceField =
  | 'experience_id'
  | 'project_id'
  | 'education_id'
  | 'course_id'
  | 'certification_id'
  | 'volunteering_id';

interface UsageArgs {
  skillId: string;
  context: UsageContext;
  source?: { field: SourceField; id: string } | null;
  facet?: string | null;
  description?: string | null;
  personal?: string | null;
  level?: string | null;
  tasks?: string[];
  start?: string | null;
  end?: string | null;
  resumeUse?: ResumeUse | null;
}

class V1Migrator {
  private readonly c: MigrationContext;
  private readonly legacy: LegacyProfileV1;
  private readonly profile: Obj;
  private readonly report: ReportBuilder;

  // registros de saida
  private readonly skills: Obj[] = [];
  private readonly skillByKey = new Map<string, Obj>();
  private readonly usages: Obj[] = [];
  private readonly usageKeys = new Map<string, Obj>();
  private readonly pendings: Obj[] = [];
  private readonly restrictions: Obj[] = [];
  private readonly statements: Obj[] = [];

  // ids: id 1.0.0 -> id 2.0.0, por colecao
  private readonly usedIds = new Set<string>();
  private readonly expIds = new Map<string, string>();
  private readonly projIds = new Map<string, string>();
  private readonly eduIds = new Map<string, string>();
  private readonly evidenceIds = new Set<string>();
  private readonly usageMapCounts = new Map<string, number>();
  private declaredPreserved = 0;
  private recordsDropped = 0;

  constructor(legacy: LegacyProfileV1, report: ReportBuilder) {
    this.legacy = legacy;
    this.profile = legacy.profile;
    this.report = report;
    this.c = new MigrationContext(report, collectLegacyIds(this.profile), legacy.locale);
  }

  // ---------------------------------------------------------------------------
  // utilitarios

  /** Registros 1.0.0 com conteudo (ghosts descartados com aviso). */
  private kept(key: string, label: string): KeptRecord[] {
    const raw = this.profile[key];
    if (!Array.isArray(raw)) return [];
    const out: KeptRecord[] = [];
    raw.forEach((src, index) => {
      const path = `profile.${key}[${index}]`;
      if (!isObj(src)) return;
      if (hasV1Content(src)) {
        out.push({ src, index, path });
      } else {
        this.recordsDropped += 1;
        this.report.warn(
          'EMPTY_RECORD_DROPPED',
          path,
          `Registro-modelo sem conteudo (${label}) descartado; so continha valores padrao do 1.0.0.`,
        );
      }
    });
    return out;
  }

  private subKept(parent: Obj, key: string, path: string, label: string): KeptRecord[] {
    const raw = parent[key];
    if (!Array.isArray(raw)) return [];
    const out: KeptRecord[] = [];
    raw.forEach((src, index) => {
      const subPath = `${path}.${key}[${index}]`;
      if (!isObj(src)) return;
      if (hasV1Content(src)) out.push({ src, index, path: subPath });
      else {
        this.recordsDropped += 1;
        this.report.warn(
          'EMPTY_RECORD_DROPPED',
          subPath,
          `Sub-registro sem conteudo (${label}) descartado.`,
        );
      }
    });
    return out;
  }

  private idFor(src: Obj, prefix: string, path: string, registry?: Map<string, string>): string {
    const raw = typeof src.id === 'string' ? src.id.trim() : '';
    let id: string;
    if (raw !== '' && LOCAL_ID_REGEX.test(raw) && !this.usedIds.has(raw)) {
      id = raw;
    } else {
      id = this.c.alloc(prefix);
      if (raw !== '' && !LOCAL_ID_REGEX.test(raw)) {
        this.report.warn(
          'ID_REMAPPED',
          `${path}.id`,
          `Id "${raw}" invalido para o contrato 2.0.0; novo id ${id}.`,
        );
      } else if (raw !== '') {
        this.report.warn(
          'DUPLICATE_ID_RENAMED',
          `${path}.id`,
          `Id "${raw}" duplicado; o registro recebeu ${id}.`,
        );
      }
    }
    this.usedIds.add(id);
    if (registry && raw !== '' && !registry.has(raw)) registry.set(raw, id);
    return id;
  }

  private meta(
    path: string,
    opts: {
      declared?: unknown;
      evidence?: unknown;
      resumeUse?: ResumeUse | null;
      notes?: string[];
      fieldStates?: Obj;
    } = {},
  ): Obj {
    const notes = opts.notes ?? [];
    const meta: Obj = { status: 'needs_review', source: 'profile_import' };
    if (typeof opts.declared === 'string' && opts.declared.trim() !== '') {
      const declared = opts.declared.trim();
      if ((FACT_STATUS_VALUES as readonly string[]).includes(declared)) {
        meta.declared_status = declared;
        this.declaredPreserved += 1;
      } else {
        this.c.reject(
          path,
          'fact_status',
          declared,
          'INVALID_ENUM_VALUE_DROPPED',
          notes,
          `status "${declared}" nao e aceito`,
        );
      }
    }
    const refs = this.evidenceRefs(opts.evidence, path, notes);
    if (refs.length > 0) meta.evidence_ids = refs;
    if (opts.resumeUse) meta.resume_use = opts.resumeUse;
    if (opts.fieldStates && Object.keys(opts.fieldStates).length > 0)
      meta.field_states = opts.fieldStates;
    if (notes.length > 0)
      meta.private_notes = this.c.fit(notes.join('\n'), 'long', `${path}.meta.private_notes`);
    return meta;
  }

  private evidenceRefs(raw: unknown, path: string, notes: string[]): string[] {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const item of raw) {
      if (typeof item !== 'string' || item.trim() === '') continue;
      const id = item.trim();
      if (this.evidenceIds.has(id)) {
        if (!out.includes(id)) out.push(id);
      } else {
        notes.push(`evidence_ids (1.0.0): ${id}`);
        this.report.warn(
          'REFERENCE_UNRESOLVED',
          `${path}.evidence_ids`,
          `Evidencia "${id}" nao existe em evidence_registry; referencia guardada em meta.private_notes.`,
        );
      }
    }
    return out;
  }

  private disclosure(raw: unknown, path: string, notes: string[]): ResumeUse | null {
    if (typeof raw !== 'string' || raw.trim() === '') return null;
    const value = raw.trim();
    const mapped = DISCLOSURE_TO_RESUME_USE[value];
    if (mapped) {
      this.usageMapCounts.set(
        `disclosure:${value}`,
        (this.usageMapCounts.get(`disclosure:${value}`) ?? 0) + 1,
      );
      return mapped;
    }
    this.c.reject(
      path,
      'disclosure',
      value,
      'INVALID_ENUM_VALUE_DROPPED',
      notes,
      `divulgacao "${value}" desconhecida`,
    );
    return 'requires_approval';
  }

  private resumeUseOf(raw: unknown, key: string, path: string, notes: string[]): ResumeUse | null {
    if (typeof raw !== 'string' || raw.trim() === '') return null;
    const mapped = INCLUDE_TO_RESUME_USE[raw.trim()];
    if (mapped) {
      this.usageMapCounts.set(
        `${key}:${raw.trim()}`,
        (this.usageMapCounts.get(`${key}:${raw.trim()}`) ?? 0) + 1,
      );
      return mapped;
    }
    this.c.reject(
      path,
      key,
      raw,
      'INVALID_ENUM_VALUE_DROPPED',
      notes,
      `valor "${raw}" desconhecido`,
    );
    return 'requires_approval';
  }

  // ---------------------------------------------------------------------------
  // competencias

  private skill(rawName: string, path: string, extra: Obj = {}): Obj {
    let name = rawName.trim().replace(/\s+/g, ' ');
    let overflow: string | null = null;
    if (name.length > 200) {
      overflow = name;
      const cut = name.slice(0, 120);
      name = cut.slice(0, Math.max(cut.lastIndexOf(' '), 60)).trim();
      this.report.warn(
        'SKILL_NAME_TRUNCATED',
        path,
        `Nome de competencia longo demais; mantido "${name}" e o texto completo em usage_description.`,
      );
    }
    const key = normalizeKey(name);
    const existing = this.skillByKey.get(key);
    const record =
      existing ??
      (() => {
        const created: Obj = {
          id: this.c.alloc('SKL'),
          name,
          meta: { status: 'needs_review', source: 'profile_import' },
          ...extra,
        };
        this.usedIds.add(created.id as string);
        this.skills.push(created);
        this.skillByKey.set(key, created);
        return created;
      })();
    if (overflow) record.__overflow = overflow;
    return record;
  }

  private addUsage(args: UsageArgs, path: string): Obj {
    const sourceKey = args.source ? `${args.source.field}:${args.source.id}` : '-';
    const key = `${args.skillId}|${args.context}|${sourceKey}|${args.facet ?? ''}`;
    const existing = this.usageKeys.get(key);
    if (existing) {
      if (args.tasks?.length) {
        existing.tasks = unionStrings(existing.tasks as string[] | undefined, args.tasks);
      }
      return existing;
    }
    const usage: Obj = compact({
      id: this.c.alloc('USG'),
      skill_id: args.skillId,
      usage_context: args.context,
      ...(args.source ? { [args.source.field]: args.source.id } : {}),
      facet: args.facet ?? null,
      usage_description: args.description ?? null,
      personal_implementation: args.personal ?? null,
      level_in_context: args.level ?? null,
      start_date: args.start ?? null,
      end_date: args.end ?? null,
      tasks: args.tasks?.length ? args.tasks : null,
      meta: this.meta(path, { resumeUse: args.resumeUse ?? null }),
    });
    this.usedIds.add(usage.id as string);
    this.usages.push(usage);
    this.usageKeys.set(key, usage);
    return usage;
  }

  /** Cria competencia + uso a partir de um nome solto de tecnologia/ferramenta. */
  private usageFromName(rawName: string, path: string, args: Omit<UsageArgs, 'skillId'>): void {
    const name = rawName.trim();
    if (name === '') return;
    const skill = this.skill(name, path);
    const overflow = skill.__overflow as string | undefined;
    delete skill.__overflow;
    this.addUsage(
      { ...args, skillId: skill.id as string, description: overflow ?? args.description ?? null },
      path,
    );
  }

  private readonly pendingKeys = new Set<string>();

  private pending(subject: string, targetId: string | null, detail: string, path: string): void {
    // registros fundidos (mesma competencia/uso vindos de varias origens) nao geram pendencias repetidas
    // mesmo registro-alvo + mesmo motivo = mesma pendencia (o assunto pode variar so na grafia do nome)
    const key = targetId ? [targetId, detail].join('|') : [subject, detail].join('|');
    if (this.pendingKeys.has(key)) return;
    this.pendingKeys.add(key);
    const item = compact({
      id: this.c.alloc('PND'),
      subject: this.c.fit(subject, 'short', `${path}.subject`),
      target: targetId ? { record_id: targetId } : null,
      reason: 'unclear',
      reason_detail: this.c.fit(detail, 'text', `${path}.reason_detail`),
      safe_statement_for_now: null,
      priority: 'medium',
      status: 'open',
    });
    this.usedIds.add(item.id as string);
    this.pendings.push(item);
    this.report.info(
      'PENDING_ITEM_CREATED',
      path,
      `Pendencia ${item.id as string} criada: ${subject}`,
    );
  }

  private unverifiedUsage(
    skillName: string,
    path: string,
    why: string,
    args: Omit<UsageArgs, 'skillId' | 'context'>,
    withPending: boolean,
  ): void {
    const skill = this.skill(skillName, path);
    delete skill.__overflow;
    const usage = this.addUsage(
      { ...args, skillId: skill.id as string, context: 'unverified' },
      path,
    );
    this.report.warn(
      'USAGE_CONTEXT_UNVERIFIED',
      path,
      `Contexto de uso de "${skillName}" nao pode ser verificado (${why}); registrado como unverified.`,
    );
    if (withPending) {
      this.pending(
        this.c.t(
          `Confirmar o contexto de uso de "${skillName}"`,
          `Confirm how "${skillName}" was used`,
        ),
        usage.id as string,
        this.c.t(
          `Migrado do 1.0.0 sem fonte verificavel: ${why}.`,
          `Migrated from 1.0.0 without a verifiable source: ${why}.`,
        ),
        path,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // blocos e declaracoes

  private identity(): Obj | null {
    const src = this.profile.identity;
    if (!isObj(src)) return null;
    const path = 'profile.identity';
    this.c.unknownKeys(src, Object.keys(LEGACY_IDENTITY), path);
    if (isUntouchedBlock(src, TEMPLATE_DEFAULTS.identity)) {
      this.c.countBlankStrings(src, path);
      return null;
    }
    const out = compact({
      full_name: this.c.text(src, 'full_name', path),
      preferred_name: this.c.text(src, 'preferred_name', path),
      pronunciation: this.c.text(src, 'pronunciation', path),
      pronouns: this.c.text(src, 'pronouns', path),
      country_of_residence: this.c.text(src, 'country_of_residence', path),
      city: this.c.text(src, 'city', path),
      region: this.c.text(src, 'region', path),
      countries_of_work_interest: this.c.list(src, 'country_of_work_interest', path),
      timezone: (() => {
        const tz = this.c.text(src, 'timezone', path);
        return tz === null ? null : this.c.timezone(tz, `${path}.timezone`);
      })(),
      interface_languages: this.c
        .list(src, 'interface_languages', path)
        .map((value, index) => this.c.locale(value, `${path}.interface_languages[${index}]`))
        .filter((value): value is string => value !== null),
    });
    return out;
  }

  private contacts(): Obj[] {
    const src = this.profile.contact;
    if (!isObj(src)) return [];
    const path = 'profile.contact';
    this.c.unknownKeys(src, ['professional_email', 'phone', 'links'], path);
    const out: Obj[] = [];
    const email = this.c.text(src, 'professional_email', path);
    if (email !== null) {
      const valid = this.c.email(email, `${path}.professional_email`);
      if (valid)
        out.push({ id: this.c.alloc('CTT'), kind: 'email', subtype: 'professional', value: valid });
    }
    const phone = this.c.text(src, 'phone', path);
    if (phone !== null) {
      const valid = this.c.phone(phone, `${path}.phone`);
      if (valid) out.push({ id: this.c.alloc('CTT'), kind: 'phone', value: valid });
    }
    for (const { src: link, path: linkPath } of this.subKept(src, 'links', path, 'link')) {
      this.c.unknownKeys(
        link,
        ['type', 'label', 'url', 'visibility', 'include_by_default', 'notes'],
        linkPath,
      );
      const valid = this.linkUrl(link, linkPath);
      if (valid === null) continue;
      const subtypes = [
        'linkedin',
        'github',
        'gitlab',
        'portfolio',
        'website',
        'behance',
        'dribbble',
      ];
      const type = typeof link.type === 'string' ? link.type.trim().toLowerCase() : '';
      out.push(
        compact({
          id: this.c.alloc('CTT'),
          kind: 'link',
          subtype: subtypes.includes(type) ? type : type === '' ? null : 'other',
          value: valid,
          label: this.c.text(link, 'label', linkPath),
          visibility: this.c.enumValue(link, 'visibility', linkPath, VISIBILITY_VALUES),
          include_by_default:
            typeof link.include_by_default === 'boolean' ? link.include_by_default : null,
          notes: this.c.text(link, 'notes', linkPath, 'text'),
        }),
      );
    }
    return out;
  }

  /** URL de um link 1.0.0; se invalida, o link INTEIRO (rotulo, notas, tipo) vai para `unmapped`. */
  private linkUrl(link: Obj, path: string): string | null {
    const raw = this.c.text(link, 'url', path);
    if (raw === null) return null;
    if (httpUrlSchema.safeParse(raw).success) return raw;
    this.report.addUnmapped(
      path,
      link,
      'Link com URL invalida descartado (registro 1.0.0 preservado).',
    );
    this.report.warn(
      'INVALID_VALUE_DROPPED',
      `${path}.url`,
      'URL do link invalida: o link nao foi migrado (registro original em unmapped).',
    );
    return null;
  }

  /** `positioning` -> `positioning` (bloco) + `statements[]` + dados que vao para `career_preferences`. */
  private positioning(): { block: Obj | null; careerExtra: Obj } {
    const src = this.profile.positioning;
    const careerExtra: Obj = {};
    if (!isObj(src)) return { block: null, careerExtra };
    const path = 'profile.positioning';
    this.c.unknownKeys(src, Object.keys(LEGACY_POSITIONING), path);

    const statement = (
      kind: string,
      text: string | null,
      fieldPath: string,
      visibility?: string,
    ): void => {
      if (text === null) return;
      const s: Obj = {
        id: this.c.alloc('STM'),
        kind,
        text,
        meta: { ...this.meta(fieldPath), ...(visibility ? { visibility } : {}) },
      };
      this.usedIds.add(s.id as string);
      this.statements.push(s);
    };
    statement(
      'one_sentence_intro',
      this.c.text(src, 'one_sentence_intro', path, 'long'),
      `${path}.one_sentence_intro`,
    );
    statement(
      'short_summary',
      this.c.text(src, 'short_summary', path, 'long'),
      `${path}.short_summary`,
    );
    statement(
      'full_summary',
      this.c.text(src, 'full_summary', path, 'long'),
      `${path}.full_summary`,
    );
    statement(
      'career_narrative',
      this.c.text(src, 'career_narrative', path, 'long'),
      `${path}.career_narrative`,
      'private',
    );
    this.c
      .list(src, 'demonstrable_differentiators', path, 'text')
      .forEach((text, i) =>
        statement('differentiator', text, `${path}.demonstrable_differentiators[${i}]`),
      );
    this.c
      .list(src, 'professional_values', path, 'text')
      .forEach((text, i) => statement('value', text, `${path}.professional_values[${i}]`));

    careerExtra.preferred_job_titles = this.c.list(src, 'preferred_job_titles', path);
    careerExtra.excluded_job_titles = this.c.list(src, 'excluded_job_titles', path);
    careerExtra.industries_of_interest = this.c.list(src, 'industries_of_interest', path);
    careerExtra.industries_to_avoid = this.c.list(src, 'industries_to_avoid', path);
    careerExtra.primary_fields = this.c.list(src, 'primary_fields', path);
    careerExtra.secondary_fields = this.c.list(src, 'secondary_fields', path);
    careerExtra.professional_interests = this.c.list(src, 'professional_interests', path);
    careerExtra.problems = this.c.list(src, 'preferred_problems_to_solve', path, 'text');
    careerExtra.short_term_goals = this.c.text(src, 'short_term_goals', path, 'text');
    careerExtra.long_term_goals = this.c.text(src, 'long_term_goals', path, 'text');

    const blockSrc: Obj = {
      current_profession: src.current_profession,
      current_job_title: src.current_job_title,
      current_seniority: src.current_seniority,
      professional_headline: src.professional_headline,
    };
    if (isUntouchedBlock(blockSrc, TEMPLATE_DEFAULTS.positioning)) {
      this.c.countBlankStrings(blockSrc, path);
      return { block: null, careerExtra };
    }
    const block = compact({
      current_profession: this.c.text(src, 'current_profession', path),
      current_job_title: this.c.text(src, 'current_job_title', path),
      current_seniority: this.c.enumValue(src, 'current_seniority', path, SENIORITY_VALUES),
      professional_headline: this.c.text(src, 'professional_headline', path),
    });
    return { block, careerExtra };
  }

  private career(extra: Obj): Obj | null {
    const src = isObj(this.profile.career_preferences) ? this.profile.career_preferences : {};
    const path = 'profile.career_preferences';
    this.c.unknownKeys(src, Object.keys(LEGACY_CAREER), path);
    const own = (key: string, size: 'short' | 'text' = 'short') =>
      this.c.list(src, key, path, size);
    const merge = (
      dest: string,
      fromPositioning: string[],
      fromCareer: string[],
      origins: string,
    ): string[] => {
      if (fromPositioning.length > 0 && fromCareer.length > 0) {
        this.report.info(
          'FIELD_MERGED',
          `${path}.${dest}`,
          `Campos duplicados do 1.0.0 unidos sem duplicatas: ${origins}.`,
        );
      }
      return unionStrings(fromPositioning, fromCareer);
    };
    const e = extra as Record<string, string[] | string | null>;
    const asList = (key: string): string[] => (Array.isArray(e[key]) ? e[key] : []);

    const interest = this.c.enumValue(src, 'interest_in_adjacent_fields', path, TRI_STATE_VALUES);
    const touched =
      !isUntouchedBlock(src, TEMPLATE_DEFAULTS.career) ||
      Object.values(extra).some((v) => !isBlankDeep(v));
    if (!touched) {
      this.c.countBlankStrings(src, path);
      return null;
    }
    const out = compact({
      priority_job_titles: merge(
        'priority_job_titles',
        asList('preferred_job_titles'),
        own('priority_job_titles'),
        'positioning.preferred_job_titles + career_preferences.priority_job_titles',
      ),
      secondary_job_titles: own('secondary_job_titles'),
      excluded_job_titles: asList('excluded_job_titles'),
      fields_of_interest: merge(
        'fields_of_interest',
        unionStrings(asList('primary_fields'), asList('secondary_fields')),
        own('fields_of_interest'),
        'positioning.primary_fields/secondary_fields + career_preferences.fields_of_interest',
      ),
      preferred_industries: merge(
        'preferred_industries',
        asList('industries_of_interest'),
        own('preferred_industries'),
        'positioning.industries_of_interest + career_preferences.preferred_industries',
      ),
      excluded_industries: merge(
        'excluded_industries',
        asList('industries_to_avoid'),
        own('excluded_industries'),
        'positioning.industries_to_avoid + career_preferences.excluded_industries',
      ),
      target_seniority_levels: this.c
        .list(src, 'target_seniority_levels', path)
        .map((value) => {
          const slug = value.toLowerCase();
          if ((SENIORITY_VALUES as readonly string[]).includes(slug)) return slug;
          this.c.reject(
            path,
            'target_seniority_levels',
            value,
            'INVALID_ENUM_VALUE_DROPPED',
            undefined,
            `senioridade "${value}" desconhecida`,
          );
          return null;
        })
        .filter((value): value is string => value !== null),
      accepted_equivalent_titles: own('accepted_equivalent_titles'),
      misleading_titles_to_avoid: own('misleading_titles_to_avoid'),
      preferred_responsibilities: own('preferred_responsibilities', 'text'),
      responsibilities_to_avoid: own('responsibilities_to_avoid', 'text'),
      professional_interests: asList('professional_interests'),
      problems_to_solve: asList('problems'),
      short_term_goals: typeof e.short_term_goals === 'string' ? e.short_term_goals : null,
      long_term_goals: typeof e.long_term_goals === 'string' ? e.long_term_goals : null,
      interest_in_adjacent_fields: interest,
    });
    return Object.keys(out).length > 0 ? out : null;
  }

  private competencyExamples(): Obj[] {
    const out: Obj[] = [];
    for (const { src, path } of this.kept('competency_examples', 'exemplo de competencia')) {
      this.c.unknownKeys(src, Object.keys(LEGACY_COMPETENCY), path);
      const notes: string[] = [];
      out.push(
        compact({
          id: this.idFor(src, 'CMP', path),
          competency: this.c.text(src, 'competency', path),
          situation: this.c.text(src, 'situation', path, 'text', notes),
          action: this.c.text(src, 'action', path, 'text', notes),
          outcome_or_learning: this.c.text(src, 'outcome_or_learning', path, 'text', notes),
          meta: this.meta(path, { evidence: src.evidence_ids, notes }),
        }),
      );
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // experiencias

  private technologyContext(raw: string | null): {
    context: UsageContext;
    verified: boolean;
    pending: boolean;
    label: string;
  } {
    switch ((raw ?? '').trim().toLowerCase()) {
      case 'professional':
        return {
          context: 'professional_experience',
          verified: true,
          pending: false,
          label: 'professional',
        };
      case 'internal_project':
        return {
          context: 'professional_experience',
          verified: true,
          pending: false,
          label: 'internal_project',
        };
      case 'study':
        return {
          context: 'self_declared_knowledge',
          verified: true,
          pending: false,
          label: 'study',
        };
      case 'training':
        return { context: 'unverified', verified: false, pending: true, label: 'training' };
      case 'other':
        return { context: 'unverified', verified: false, pending: false, label: 'other' };
      default:
        return {
          context: 'unverified',
          verified: false,
          pending: true,
          label: raw ? `desconhecido:${raw}` : 'vazio',
        };
    }
  }

  private parsePeriodText(text: string): { start: string | null; end: string | null } | null {
    const match =
      /^(\d{4}(?:-\d{2})?)\s*(?:-|a|ate|até|to)\s*(\d{4}(?:-\d{2})?|present|presente|atual)$/i.exec(
        text.trim(),
      );
    if (!match) return null;
    const end = /^(present|presente|atual)$/i.test(match[2] ?? '') ? 'present' : (match[2] ?? null);
    return { start: match[1] ?? null, end };
  }

  private experienceItems(experienceId: string, src: Obj, path: string): Obj[] {
    const items: Obj[] = [];
    const sourceRef = { field: 'experience_id' as const, id: experienceId };

    for (const { src: r, path: p } of this.subKept(
      src,
      'responsibilities',
      path,
      'responsabilidade',
    )) {
      this.c.unknownKeys(r, Object.keys(LEGACY_V1_SHAPES.responsibility), p);
      const notes: string[] = [];
      const description = this.c.text(r, 'description', p, 'text', notes);
      const outcome = this.c.text(r, 'outcome', p, 'text', notes);
      for (const tool of this.c.list(r, 'tools', p)) {
        this.usageFromName(tool, `${p}.tools`, {
          context: 'professional_experience',
          source: sourceRef,
        });
      }
      const text = description ?? outcome;
      if (text === null) continue;
      items.push(
        compact({
          id: this.c.alloc('ITM'),
          kind: 'responsibility',
          text,
          frequency: this.c.enumValue(r, 'frequency', p, FREQUENCY_VALUES, { notes }),
          autonomy: this.c.enumValue(r, 'autonomy', p, AUTONOMY_VALUES, { notes }),
          outcome: description !== null ? outcome : null,
          meta: this.meta(p, { notes }),
        }),
      );
    }

    for (const { src: a, path: p } of this.subKept(src, 'achievements', path, 'conquista')) {
      this.c.unknownKeys(a, Object.keys(LEGACY_V1_SHAPES.achievement), p);
      const notes: string[] = [];
      const metric = compact({
        name: this.c.text(a, 'metric_name', p),
        value: this.c.text(a, 'metric_value', p),
        baseline: this.c.text(a, 'baseline', p),
        period: this.c.text(a, 'period', p),
        method: this.c.text(a, 'calculation_method', p, 'text', notes),
      });
      const text =
        this.c.text(a, 'description', p, 'text', notes) ??
        (metric.name as string | undefined) ??
        (metric.value as string | undefined) ??
        null;
      if (text === null) continue;
      items.push(
        compact({
          id: this.c.alloc('ITM'),
          kind: 'achievement',
          text,
          metric: Object.keys(metric).length > 0 ? metric : null,
          personal_contribution: this.c.text(a, 'personal_contribution', p, 'text', notes),
          meta: this.meta(p, {
            evidence: a.evidence_ids,
            resumeUse: this.disclosure(a.public_disclosure, p, notes),
            notes,
          }),
        }),
      );
    }

    for (const { src: d, path: p } of this.subKept(
      src,
      'internal_deliveries',
      path,
      'entrega interna',
    )) {
      this.c.unknownKeys(d, Object.keys(LEGACY_V1_SHAPES.internal_delivery), p);
      const notes: string[] = [];
      for (const technology of this.c.list(d, 'technologies', p)) {
        this.usageFromName(technology, `${p}.technologies`, {
          context: 'professional_experience',
          source: sourceRef,
        });
      }
      const name = this.c.text(d, 'name', p, 'text', notes);
      const problem = this.c.text(d, 'problem', p, 'text', notes);
      const text = name ?? problem;
      if (text === null) continue;
      items.push(
        compact({
          id: this.c.alloc('ITM'),
          kind: 'delivery',
          text,
          problem: name !== null ? problem : null,
          personal_contribution: this.c.text(d, 'personal_contribution', p, 'text', notes),
          collaborators: this.c.list(d, 'collaborators', p),
          steps: this.c.list(d, 'steps', p, 'text'),
          outcome: this.c.text(d, 'outcome', p, 'text', notes),
          verification: this.c.text(d, 'verification', p, 'text', notes),
          meta: this.meta(p, { resumeUse: this.disclosure(d.disclosure, p, notes), notes }),
        }),
      );
    }
    for (const item of items) this.usedIds.add(item.id as string);
    return items;
  }

  private experiences(): Obj[] {
    const out: Obj[] = [];
    for (const { src, path } of this.kept('experiences', 'experiencia')) {
      this.c.unknownKeys(src, Object.keys(LEGACY_V1_SHAPES.experience), path);
      const notes: string[] = [];
      const initialNote = this.c.text(src, 'notes', path, 'long');
      if (initialNote) notes.push(initialNote);
      const id = this.idFor(src, 'EXP', path, this.expIds);

      let location: Obj | null = null;
      if (isObj(src.location)) {
        this.c.unknownKeys(src.location, ['city', 'region', 'country'], `${path}.location`);
        location = compact({
          city: this.c.text(src.location, 'city', `${path}.location`),
          region: this.c.text(src.location, 'region', `${path}.location`),
          country: this.c.text(src.location, 'country', `${path}.location`),
        });
      }

      const fieldStates: Obj = {};
      let endDate = this.c.date(src, 'end_date', path, notes);
      if (src.is_current === true) {
        if (endDate === null) {
          endDate = 'present';
        } else {
          this.report.warn(
            'IS_CURRENT_CONFLICT',
            `${path}.is_current`,
            `is_current=true conflita com end_date "${endDate}": a data de termino foi mantida e marcada como needs_confirmation.`,
          );
          fieldStates.end_date = 'needs_confirmation';
        }
      }

      const record = compact({
        id,
        organization_name: this.c.text(src, 'organization', path),
        organization_public_name: this.c.text(src, 'organization_public_name', path),
        industry: this.c.text(src, 'industry', path),
        location: location && Object.keys(location).length > 0 ? location : null,
        official_title: this.c.text(src, 'official_title', path),
        display_title: this.c.text(src, 'resume_display_title', path),
        employment_type: this.c.enumValue(src, 'employment_type', path, EMPLOYMENT_TYPE_VALUES, {
          aliases: { apprentice: 'apprenticeship' },
          notes,
        }),
        department: this.c.text(src, 'department', path),
        start_date: this.c.date(src, 'start_date', path, notes),
        end_date: endDate,
        work_mode: this.c.enumValue(src, 'work_mode', path, WORK_MODE_VALUES, {
          aliases: { not_specified: null },
          notes,
        }),
        company_context: this.c.text(src, 'company_context', path, 'text', notes),
        role_objective: this.c.text(src, 'role_objective', path, 'text', notes),
        products_services_users: this.c.text(src, 'products_services_users', path, 'text', notes),
        operational_scope: this.c.text(src, 'operational_scope', path, 'text', notes),
        team_interfaces: this.c.list(src, 'team_interfaces', path, 'text'),
        transferable_skills: this.c.list(src, 'transferable_skills', path, 'text'),
        lessons_learned: this.c.list(src, 'lessons_learned', path, 'text'),
        exit_reason: this.c.text(src, 'exit_reason_private', path, 'text', notes),
        reference_contact_permission: this.c.enumValue(
          src,
          'reference_contact_permission',
          path,
          ['allowed', 'not_allowed', 'ask_first'] as const,
          {
            aliases: {
              yes: 'allowed',
              sim: 'allowed',
              no: 'not_allowed',
              nao: 'not_allowed',
              not_applicable: null,
            },
            notes,
          },
        ),
      });
      const items = this.experienceItems(id, src, path);

      // technologies_used -> competencias + usos ligados a experiencia
      for (const { src: tech, path: techPath } of this.subKept(
        src,
        'technologies_used',
        path,
        'tecnologia',
      )) {
        this.c.unknownKeys(tech, Object.keys(LEGACY_V1_SHAPES.technology_used), techPath);
        const name = this.c.text(tech, 'name', techPath, 'text');
        if (name === null) continue;
        const rawContext = typeof tech.usage_context === 'string' ? tech.usage_context : null;
        const mapped = this.technologyContext(rawContext);
        this.usageMapCounts.set(
          `usage_context:${mapped.label}`,
          (this.usageMapCounts.get(`usage_context:${mapped.label}`) ?? 0) + 1,
        );
        const usageNotes: string[] = [];
        const period = this.c.text(tech, 'usage_period', techPath, 'short');
        const parsed = period ? this.parsePeriodText(period) : null;
        const args = {
          source: { field: 'experience_id' as const, id },
          tasks: this.c.list(tech, 'tasks', techPath, 'text'),
          level: this.c.enumValue(
            tech,
            'self_assessed_level',
            techPath,
            SELF_ASSESSED_LEVEL_VALUES,
            { notes: usageNotes },
          ),
          start: parsed?.start ?? null,
          end: parsed?.end ?? null,
          description: period && !parsed ? period : null,
        };
        if (mapped.verified) {
          this.usageFromName(name, techPath, { ...args, context: mapped.context });
        } else {
          this.unverifiedUsage(
            name,
            techPath,
            this.c.t(
              `contexto de uso "${mapped.label}" no 1.0.0`,
              `1.0.0 usage context "${mapped.label}"`,
            ),
            args,
            mapped.pending,
          );
        }
      }

      out.push({
        ...record,
        ...(items.length > 0 ? { items } : {}),
        meta: this.meta(path, {
          declared: src.fact_status,
          evidence: src.evidence_ids,
          notes,
          fieldStates,
        }),
      });
    }
    return out;
  }

  /** `freelance_and_business[]` -> `experiences[]` (employment_type freelance + business). */
  private freelanceExperiences(): Obj[] {
    const out: Obj[] = [];
    for (const { src, path } of this.kept('freelance_and_business', 'trabalho autonomo')) {
      this.c.unknownKeys(src, Object.keys(LEGACY_V1_SHAPES.freelance), path);
      const notes: string[] = [];
      const id = this.c.alloc('EXP');
      this.usedIds.add(id);
      const name = this.c.text(src, 'business_or_professional_name', path);

      const count = src.project_or_client_count;
      let clientCount: number | null = null;
      if (typeof count === 'number') {
        if (Number.isInteger(count) && count >= 0) clientCount = count;
        else
          this.c.reject(
            path,
            'project_or_client_count',
            count,
            'INVALID_VALUE_MOVED_TO_NOTES',
            notes,
            'quantidade invalida',
          );
      }
      const business = compact({
        activity: this.c.text(src, 'activity', path),
        client_market_description: this.c.text(
          src,
          'client_market_description',
          path,
          'text',
          notes,
        ),
        services_scope: this.c.list(src, 'services_scope', path, 'text'),
        client_count: clientCount,
        portfolio_url: this.c.url(src, 'portfolio_url', path, notes),
      });

      const items: Obj[] = [];
      const addItems = (key: string, kind: string): void => {
        this.c.list(src, key, path, 'text').forEach((text, i) => {
          const item = {
            id: this.c.alloc('ITM'),
            kind,
            text,
            meta: this.meta(`${path}.${key}[${i}]`),
          };
          this.usedIds.add(item.id);
          items.push(item);
        });
      };
      addItems('personal_responsibilities', 'responsibility');
      addItems('deliveries', 'delivery');
      addItems('verifiable_results', 'achievement');
      for (const tool of this.c.list(src, 'tools_technologies', path)) {
        this.usageFromName(tool, `${path}.tools_technologies`, {
          context: 'professional_experience',
          source: { field: 'experience_id', id },
        });
      }

      const disclosure =
        typeof src.client_names_disclosure === 'string' ? src.client_names_disclosure.trim() : '';
      if (disclosure === 'not_approved' || disclosure === 'not_confirmed') {
        const rule = disclosure === 'not_approved' ? 'never_include' : 'require_approval';
        const restriction: Obj = {
          id: this.c.alloc('RST'),
          target: { record_id: id, field: 'organization_name' },
          rule,
          reason: this.c.t(
            `Nomes de clientes: divulgacao ${disclosure} no 1.0.0. Preencha organization_public_name.`,
            `Client names: disclosure ${disclosure} in 1.0.0. Fill organization_public_name.`,
          ),
        };
        this.usedIds.add(restriction.id as string);
        this.restrictions.push(restriction);
        this.report.warn(
          'CLIENT_NAMES_RESTRICTION_ADDED',
          `${path}.client_names_disclosure`,
          `Divulgacao de nomes (${disclosure}): criada restricao ${rule} sobre organization_name; defina organization_public_name.`,
        );
      }
      this.report.info(
        'RECORD_RELOCATED',
        path,
        `freelance_and_business movido para experiences (${id}, employment_type freelance).`,
      );

      out.push({
        ...compact({
          id,
          organization_name: name,
          employment_type: 'freelance',
          start_date: this.c.date(src, 'start_date', path, notes),
          end_date: this.c.date(src, 'end_date', path, notes),
          business: Object.keys(business).length > 0 ? business : null,
        }),
        ...(items.length > 0 ? { items } : {}),
        meta: this.meta(path, { evidence: src.evidence_ids, notes }),
      });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // projetos

  private projects(): Obj[] {
    const out: Obj[] = [];
    const facetKeys = [
      'frontend',
      'backend',
      'databases',
      'apis_and_integrations',
      'infrastructure_deployment',
      'testing_quality',
      'security_privacy',
      'observability',
      'documentation',
      'methods_and_version_control',
    ] as const;
    const itemKinds: [string, string][] = [
      ['main_features', 'feature'],
      ['workflows', 'workflow'],
      ['business_rules', 'business_rule'],
      ['constraints_and_decisions', 'decision'],
      ['deliverables', 'deliverable'],
      ['outcomes', 'outcome'],
      ['tests_performed', 'test'],
    ];

    for (const { src, path } of this.kept('projects', 'projeto')) {
      this.c.unknownKeys(src, Object.keys(LEGACY_V1_SHAPES.project), path);
      const notes: string[] = [];
      const initialNote = this.c.text(src, 'notes', path, 'long');
      if (initialNote) notes.push(initialNote);
      const id = this.idFor(src, 'PRJ', path, this.projIds);
      const items: Obj[] = [];

      for (const [key, kind] of itemKinds) {
        this.c.list(src, key, path, 'text').forEach((text, i) => {
          const item = {
            id: this.c.alloc('ITM'),
            kind,
            text,
            meta: this.meta(`${path}.${key}[${i}]`),
          };
          this.usedIds.add(item.id);
          items.push(item);
        });
      }
      for (const { src: m, path: mp } of this.subKept(src, 'metrics', path, 'metrica')) {
        this.c.unknownKeys(m, ['name', 'value', 'method', 'evidence_ids', 'disclosure'], mp);
        const mNotes: string[] = [];
        const metric = compact({
          name: this.c.text(m, 'name', mp),
          value: this.c.text(m, 'value', mp),
          method: this.c.text(m, 'method', mp, 'text', mNotes),
        });
        const text = (metric.name as string | undefined) ?? (metric.value as string | undefined);
        if (!text) continue;
        const item = {
          id: this.c.alloc('ITM'),
          kind: 'metric',
          text,
          metric,
          meta: this.meta(mp, {
            evidence: m.evidence_ids,
            resumeUse: this.disclosure(m.disclosure, mp, mNotes),
            notes: mNotes,
          }),
        };
        this.usedIds.add(item.id);
        items.push(item);
      }

      const collaborators: Obj[] = [];
      for (const { src: col, path: cp } of this.subKept(
        src,
        'collaborators',
        path,
        'colaborador',
      )) {
        this.c.unknownKeys(col, ['name_or_role', 'contribution'], cp);
        const collaborator = compact({
          id: this.c.alloc('COL'),
          name_or_role: this.c.text(col, 'name_or_role', cp),
          contribution: this.c.text(col, 'contribution', cp, 'text'),
        });
        this.usedIds.add(collaborator.id as string);
        collaborators.push(collaborator);
      }

      // tecnologias do projeto -> competencias + usos (contexto project_experience)
      for (const key of facetKeys) {
        for (const name of this.c.list(src, key, path, 'text')) {
          this.usageFromName(name, `${path}.${key}`, {
            context: 'project_experience',
            source: { field: 'project_id', id },
            facet: key,
          });
        }
      }
      for (const { src: tech, path: tp } of this.subKept(src, 'technologies', path, 'tecnologia')) {
        this.c.unknownKeys(
          tech,
          ['name', 'usage', 'personal_implementation', 'context', 'self_assessed_level'],
          tp,
        );
        const name = this.c.text(tech, 'name', tp, 'text');
        if (name === null) continue;
        this.usageFromName(name, tp, {
          context: 'project_experience',
          source: { field: 'project_id', id },
          description: this.c.text(tech, 'usage', tp, 'text'),
          personal: this.c.text(tech, 'personal_implementation', tp, 'text'),
          level: this.c.enumValue(tech, 'self_assessed_level', tp, SELF_ASSESSED_LEVEL_VALUES),
        });
      }

      const isPublic = src.is_public === true ? 'public' : null;
      const record = compact({
        id,
        name: this.c.text(src, 'name', path),
        category: this.c.enumValue(src, 'category', path, PROJECT_CATEGORY_VALUES, { notes }),
        team_based: src.team_based === true ? true : null,
        status: this.c.enumValue(src, 'status', path, PROJECT_STATUS_VALUES, { notes }),
        start_date: this.c.date(src, 'start_date', path, notes),
        end_date: this.c.date(src, 'end_date', path, notes),
        last_updated: this.c.date(src, 'last_updated', path, notes),
        role: this.c.text(src, 'role', path),
        public_access: isPublic,
        license: this.c.text(src, 'license', path),
        public_url: this.c.url(src, 'public_url', path, notes),
        repository_url: this.c.url(src, 'repository_url', path, notes),
        documentation_url: this.c.url(src, 'documentation_url', path, notes),
        demo_url: this.c.url(src, 'demo_url', path, notes),
        collaborators,
        personal_contribution: this.c.text(src, 'personal_contribution', path, 'text', notes),
        contributions_by_others: this.c.text(src, 'contributions_by_others', path, 'text', notes),
        decision_ownership: this.c.text(src, 'decision_ownership', path, 'text', notes),
        problem: this.c.text(src, 'problem', path, 'text', notes),
        target_audience: this.c.text(src, 'target_audience', path, 'text', notes),
        need_addressed: this.c.text(src, 'need_addressed', path, 'text', notes),
        proposed_solution: this.c.text(src, 'proposed_solution', path, 'text', notes),
        architecture: this.c.text(src, 'architecture', path, 'text', notes),
        authentication_authorization: this.c.text(
          src,
          'authentication_authorization',
          path,
          'text',
          notes,
        ),
        known_limitations: this.c.list(src, 'known_limitations', path, 'text'),
        next_improvements: this.c.list(src, 'next_improvements', path, 'text'),
        learning: this.c.list(src, 'learning', path, 'text'),
        feedback: this.c.list(src, 'feedback', path, 'text'),
        one_line_description: this.c.text(src, 'one_line_description', path),
        short_description: this.c.text(src, 'short_description', path, 'text', notes),
        resume_keywords: this.c.list(src, 'resume_keywords', path),
      });
      out.push({
        ...record,
        ...(items.length > 0 ? { items } : {}),
        meta: this.meta(path, {
          declared: src.fact_status,
          evidence: src.evidence_ids,
          resumeUse: this.disclosure(src.disclosure, path, notes),
          notes,
        }),
      });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // formacao e cursos

  private education(): Obj[] {
    const out: Obj[] = [];
    for (const { src, path } of this.kept('education', 'formacao')) {
      this.c.unknownKeys(src, Object.keys(LEGACY_V1_SHAPES.education), path);
      const notes: string[] = [];
      const initialNote = this.c.text(src, 'notes', path, 'long');
      if (initialNote) notes.push(initialNote);
      out.push({
        ...compact({
          id: this.idFor(src, 'EDU', path, this.eduIds),
          institution: this.c.text(src, 'institution', path),
          course_name: this.c.text(src, 'course_name', path),
          degree_type: this.c.enumValue(src, 'degree_type', path, DEGREE_TYPE_VALUES, { notes }),
          field_of_study: this.c.text(src, 'field_of_study', path),
          status: this.c.enumValue(src, 'status', path, EDUCATION_STATUS_VALUES, { notes }),
          start_date: this.c.date(src, 'start_date', path, notes),
          completion_date: this.c.date(src, 'completion_date', path, notes),
          expected_completion_date: this.c.date(src, 'expected_completion_date', path, notes),
          modality: this.c.enumValue(src, 'modality', path, STUDY_MODALITY_VALUES, { notes }),
          location: this.c.text(src, 'location', path),
          qualification_awarded: this.c.text(src, 'qualification_awarded', path),
          thesis_title: this.c.text(src, 'thesis_title', path),
          thesis_description: this.c.text(src, 'thesis_description', path, 'text', notes),
          supervisor: this.c.text(src, 'supervisor', path),
          relevant_coursework: this.c.list(src, 'relevant_coursework', path),
          academic_projects: this.c.list(src, 'academic_projects', path),
          honors_scholarships_distinctions: this.c.list(
            src,
            'honors_scholarships_distinctions',
            path,
          ),
          verification_url: this.c.url(src, 'verification_url', path, notes),
        }),
        meta: this.meta(path, { declared: src.fact_status, evidence: src.evidence_ids, notes }),
      });
    }
    return out;
  }

  private courses(): Obj[] {
    const out: Obj[] = [];
    for (const { src, path } of this.kept('courses', 'curso')) {
      this.c.unknownKeys(src, Object.keys(LEGACY_V1_SHAPES.course), path);
      const notes: string[] = [];
      const topics = unionStrings(
        this.c.list(src, 'topics', path),
        this.c.list(src, 'main_topics', path),
      );
      if (
        this.c.list(src, 'topics', path).length > 0 &&
        this.c.list(src, 'main_topics', path).length > 0
      ) {
        this.report.info(
          'FIELD_MERGED',
          `${path}.topics`,
          'topics e main_topics do 1.0.0 unidos em topics.',
        );
      }
      let workload: number | null = null;
      if (typeof src.workload_hours === 'number') {
        if (src.workload_hours >= 0) workload = src.workload_hours;
        else
          this.c.reject(
            path,
            'workload_hours',
            src.workload_hours,
            'INVALID_VALUE_MOVED_TO_NOTES',
            notes,
            'carga horaria negativa',
          );
      }
      out.push({
        ...compact({
          id: this.idFor(src, 'CRS', path),
          name: this.c.text(src, 'name', path),
          provider: this.c.text(src, 'provider', path),
          topics,
          start_date: this.c.date(src, 'start_date', path, notes),
          completion_date: this.c.date(src, 'completion_date', path, notes),
          workload_hours: workload,
          status: this.c.enumValue(src, 'status', path, COURSE_STATUS_VALUES, { notes }),
          certificate_issued: src.certificate_issued === true ? true : null,
          verification_url: this.c.url(src, 'verification_url', path, notes),
          activities_projects: this.c.list(src, 'activities_projects', path, 'text'),
          skills_developed: this.c.list(src, 'skills_developed', path),
          relevant_job_families: this.c.list(src, 'relevant_job_families', path),
        }),
        meta: this.meta(path, { evidence: src.evidence_ids, notes }),
      });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // competencias (catalogo)

  private skillsCatalog(): void {
    for (const { src, path } of this.kept('skills', 'competencia')) {
      this.c.unknownKeys(src, Object.keys(LEGACY_V1_SHAPES.skill), path);
      const notes: string[] = [];
      const name = this.c.text(src, 'name', path, 'text');
      if (name === null) {
        this.recordsDropped += 1;
        this.report.warn(
          'EMPTY_RECORD_DROPPED',
          path,
          'Competencia sem nome descartada (o nome e a chave do catalogo).',
        );
        continue;
      }
      const existing = this.skillByKey.has(normalizeKey(name));
      const skill = this.skill(name, path);
      delete skill.__overflow;
      if (existing) {
        this.report.info(
          'SKILL_MERGED',
          path,
          `Competencia "${name}" duplicada no 1.0.0; unida a ${skill.id as string}.`,
        );
      }
      const resumeUse = this.resumeUseOf(src.resume_usage, 'resume_usage', path, notes);
      const fields = compact({
        category: this.c.enumValue(src, 'category', path, SKILL_CATEGORY_VALUES, { notes }),
        description: this.c.text(src, 'description', path, 'text', notes),
        self_assessed_level: this.c.enumValue(
          src,
          'self_assessed_level',
          path,
          SELF_ASSESSED_LEVEL_VALUES,
          { notes },
        ),
        tasks_can_perform: this.c.list(src, 'tasks_can_perform', path, 'text'),
        last_used: this.c.date(src, 'last_used', path, notes),
        duration_of_use: this.c.text(src, 'duration_of_use', path),
        limitations: this.c.text(src, 'limitations', path, 'text', notes),
      });
      for (const [key, value] of Object.entries(fields)) if (!(key in skill)) skill[key] = value;
      const meta = this.meta(path, {
        declared: src.fact_status,
        evidence: src.evidence_ids,
        resumeUse,
        notes,
      });
      skill.meta = existing ? mergeMeta(skill.meta as Obj, meta) : meta;

      // contextos de aquisicao x registros relacionados -> skill_usages
      const resolve = (key: string, registry: Map<string, string>, label: string): string[] => {
        const ids: string[] = [];
        const raw = src[key];
        if (!Array.isArray(raw)) return ids;
        raw.forEach((ref, index) => {
          if (typeof ref !== 'string' || ref.trim() === '') return;
          const id = registry.get(ref.trim());
          if (id) ids.push(id);
          else {
            this.report.warn(
              'REFERENCE_UNRESOLVED',
              `${path}.${key}[${index}]`,
              `${label} "${ref}" nao existe (ou foi descartado como registro-modelo); vinculo ignorado.`,
            );
          }
        });
        return ids;
      };
      const experienceIds = resolve('related_experience_ids', this.expIds, 'Experiencia');
      const projectIds = resolve('related_project_ids', this.projIds, 'Projeto');
      const educationIds = resolve('related_education_ids', this.eduIds, 'Formacao');
      const skillId = skill.id as string;
      for (const id of experienceIds) {
        this.addUsage(
          {
            skillId,
            context: 'professional_experience',
            source: { field: 'experience_id', id },
            resumeUse,
          },
          path,
        );
      }
      for (const id of projectIds) {
        this.addUsage(
          {
            skillId,
            context: 'project_experience',
            source: { field: 'project_id', id },
            resumeUse,
          },
          path,
        );
      }
      for (const id of educationIds) {
        this.addUsage(
          { skillId, context: 'coursework', source: { field: 'education_id', id }, resumeUse },
          path,
        );
      }

      const contexts = this.c
        .list(src, 'acquisition_contexts', path)
        .map((value) => value.toLowerCase());
      const label = name;
      for (const context of contexts) {
        switch (context) {
          case 'employment':
            if (experienceIds.length === 0)
              this.unverifiedUsage(
                label,
                path,
                this.c.t(
                  'contexto "employment" sem experiencia relacionada',
                  'context "employment" without a related experience',
                ),
                { resumeUse },
                true,
              );
            break;
          case 'project':
            if (projectIds.length === 0)
              this.unverifiedUsage(
                label,
                path,
                this.c.t(
                  'contexto "project" sem projeto relacionado',
                  'context "project" without a related project',
                ),
                { resumeUse },
                true,
              );
            break;
          case 'education':
          case 'course':
            if (educationIds.length === 0)
              this.unverifiedUsage(
                label,
                path,
                this.c.t(
                  `contexto "${context}" sem formacao ou curso cadastrado`,
                  `context "${context}" without a registered education or course`,
                ),
                { resumeUse },
                true,
              );
            break;
          case 'self_study':
            this.addUsage({ skillId, context: 'self_declared_knowledge', resumeUse }, path);
            break;
          case 'volunteer':
            this.unverifiedUsage(
              label,
              path,
              this.c.t(
                'contexto "volunteer" sem voluntariado relacionado',
                'context "volunteer" without a related volunteering record',
              ),
              { resumeUse },
              true,
            );
            break;
          case 'other':
            this.unverifiedUsage(
              label,
              path,
              this.c.t('contexto "other"', 'context "other"'),
              { resumeUse },
              false,
            );
            break;
          default:
            this.c.reject(
              path,
              'acquisition_contexts',
              context,
              'INVALID_ENUM_VALUE_DROPPED',
              undefined,
              `contexto "${context}" desconhecido`,
            );
        }
      }
    }
  }

  private developingKnowledge(): void {
    for (const { src, path } of this.kept(
      'developing_knowledge',
      'conhecimento em desenvolvimento',
    )) {
      this.c.unknownKeys(src, Object.keys(LEGACY_V1_SHAPES.developing_knowledge), path);
      const topic = this.c.text(src, 'topic', path, 'text');
      if (topic === null) {
        this.recordsDropped += 1;
        this.report.warn(
          'EMPTY_RECORD_DROPPED',
          path,
          'Conhecimento em desenvolvimento sem topico descartado.',
        );
        continue;
      }
      const existing = this.skillByKey.has(normalizeKey(topic));
      const skill = this.skill(topic, path);
      delete skill.__overflow;
      if (!existing) skill.meta = { ...(skill.meta as Obj), resume_use: 'requires_approval' };
      const plan = compact({
        scope: this.c.text(src, 'study_scope', path, 'text'),
        sources: this.c.list(src, 'learning_sources', path, 'text'),
        practical_project: this.c.text(src, 'practical_project', path, 'text'),
        perceived_level: this.c.text(src, 'perceived_level', path),
        next_goal: this.c.text(src, 'next_goal', path, 'text'),
      });
      if (Object.keys(plan).length > 0 && !skill.study_plan) skill.study_plan = plan;
      const practical = typeof plan.practical_project === 'string';
      this.addUsage(
        {
          skillId: skill.id as string,
          context: practical ? 'self_declared_knowledge' : 'conceptual_familiarity',
          resumeUse: 'requires_approval',
        },
        path,
      );
      this.report.info(
        'USAGE_CONTEXT_MAPPED',
        path,
        `developing_knowledge "${topic}" -> competencia + uso ${practical ? 'self_declared_knowledge' : 'conceptual_familiarity'} (requires_approval).`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // idiomas, certificacoes, premios, publicacoes, voluntariado

  private languages(): Obj[] {
    const out: Obj[] = [];
    for (const { src, path } of this.kept('languages', 'idioma')) {
      this.c.unknownKeys(src, Object.keys(LEGACY_V1_SHAPES.language), path);
      const notes: string[] = [];
      const language = this.c.text(src, 'language', path);
      if (language === null) {
        this.recordsDropped += 1;
        this.report.warn('EMPTY_RECORD_DROPPED', path, 'Idioma sem nome descartado.');
        continue;
      }
      const level = (key: string) =>
        this.c.enumValue(src, key, path, LANGUAGE_LEVEL_VALUES, {
          notes,
          aliases: LANGUAGE_LEVEL_ALIASES,
        });
      // Nivel geral que nao e CEFR/native ("advanced", "avancado", "intermediate"): vira
      // self_described_level com o texto original; NUNCA e convertido em CEFR.
      const overall = this.c.enumOrDescribed(
        src,
        'overall_level',
        path,
        LANGUAGE_LEVEL_VALUES,
        LANGUAGE_LEVEL_ALIASES,
      );
      const cert = compact({
        name: this.c.text(src, 'certification_name', path),
        score: this.c.text(src, 'certification_score', path),
        assessment_date: this.c.date(src, 'assessment_date', path, notes),
      });
      out.push({
        ...compact({
          id: this.c.alloc('LNG'),
          language,
          overall_level: overall.value,
          self_described_level: overall.described,
          reading: level('reading'),
          writing: level('writing'),
          listening: level('listening'),
          speaking: level('speaking'),
          professional_usage: this.c.text(src, 'professional_usage', path, 'text', notes),
          certification: Object.keys(cert).length > 0 ? cert : null,
        }),
        meta: this.meta(path, {
          evidence: src.evidence_ids,
          resumeUse: this.resumeUseOf(src.include_in_resume, 'include_in_resume', path, notes),
          notes,
        }),
      });
    }
    for (const language of out) this.usedIds.add(language.id as string);
    return out;
  }

  private certifications(): Obj[] {
    const out: Obj[] = [];
    for (const { src, path } of this.kept('certifications', 'certificacao')) {
      this.c.unknownKeys(src, Object.keys(LEGACY_V1_SHAPES.certification), path);
      const notes: string[] = [];
      const id = this.idFor(src, 'CERT', path);
      for (const skillName of this.c.list(src, 'related_skills', path)) {
        this.usageFromName(skillName, `${path}.related_skills`, {
          context: 'certification',
          source: { field: 'certification_id', id },
        });
      }
      out.push({
        ...compact({
          id,
          name: this.c.text(src, 'name', path),
          issuer: this.c.text(src, 'issuer', path),
          category: this.c.enumValue(src, 'category', path, CERTIFICATION_CATEGORY_VALUES, {
            notes,
          }),
          issue_date: this.c.date(src, 'issue_date', path, notes),
          expiration_date: this.c.date(src, 'expiration_date', path, notes),
          public_identifier: this.c.text(src, 'public_identifier', path),
          verification_url: this.c.url(src, 'verification_url', path, notes),
          status: this.c.enumValue(src, 'status', path, CERTIFICATION_STATUS_VALUES, { notes }),
        }),
        meta: this.meta(path, { evidence: src.evidence_ids, notes }),
      });
    }
    return out;
  }

  private awards(): Obj[] {
    const out: Obj[] = [];
    for (const { src, path } of this.kept('awards', 'premio')) {
      this.c.unknownKeys(src, Object.keys(LEGACY_V1_SHAPES.award), path);
      const notes: string[] = [];
      out.push({
        ...compact({
          id: this.c.alloc('AWD'),
          name: this.c.text(src, 'name', path),
          organization: this.c.text(src, 'organization', path),
          date: this.c.date(src, 'date', path, notes),
          context_and_criteria: this.c.text(src, 'context_and_criteria', path, 'text', notes),
          personal_contribution: this.c.text(src, 'personal_contribution', path, 'text', notes),
          scope: this.c.enumValue(src, 'scope', path, AWARD_SCOPE_VALUES, { notes }),
        }),
        meta: this.meta(path, {
          evidence: src.evidence_ids,
          resumeUse: this.disclosure(src.disclosure, path, notes),
          notes,
        }),
      });
    }
    for (const award of out) this.usedIds.add(award.id as string);
    return out;
  }

  private publications(): Obj[] {
    const out: Obj[] = [];
    for (const { src, path } of this.kept('publications_research_talks', 'publicacao')) {
      this.c.unknownKeys(src, Object.keys(LEGACY_V1_SHAPES.publication), path);
      const notes: string[] = [];
      let doi: string | null = null;
      let url: string | null = null;
      const raw = this.c.text(src, 'url_or_doi', path, 'short');
      if (raw !== null) {
        const bare = raw.replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/i, '');
        if (DOI.test(bare)) doi = bare;
        else if (/^https?:\/\//i.test(raw) && this.c.url(src, 'url_or_doi', path, notes)) url = raw;
        else
          this.c.reject(
            path,
            'url_or_doi',
            raw,
            'INVALID_VALUE_MOVED_TO_NOTES',
            notes,
            'nao e URL nem DOI validos',
          );
      }
      out.push({
        ...compact({
          id: this.c.alloc('PUB'),
          title: this.c.text(src, 'title', path),
          type: this.c.enumValue(src, 'type', path, PUBLICATION_TYPE_VALUES, { notes }),
          date: this.c.date(src, 'date', path, notes),
          venue_or_institution: this.c.text(src, 'venue_or_institution', path),
          authorship: this.c.text(src, 'authorship', path),
          summary: this.c.text(src, 'summary', path, 'text', notes),
          personal_contribution: this.c.text(src, 'personal_contribution', path, 'text', notes),
          topics_methods: this.c.list(src, 'topics_methods', path),
          url,
          doi,
          status: this.c.enumValue(src, 'status', path, PUBLICATION_STATUS_VALUES, { notes }),
        }),
        meta: this.meta(path, { evidence: src.evidence_ids, notes }),
      });
    }
    for (const publication of out) this.usedIds.add(publication.id as string);
    return out;
  }

  private volunteering(): Obj[] {
    const out: Obj[] = [];
    for (const { src, path } of this.kept('volunteering_and_leadership', 'voluntariado')) {
      this.c.unknownKeys(src, Object.keys(LEGACY_V1_SHAPES.volunteering), path);
      const notes: string[] = [];
      const id = this.c.alloc('VOL');
      this.usedIds.add(id);
      for (const skillName of this.c.list(src, 'skills_demonstrated', path)) {
        this.usageFromName(skillName, `${path}.skills_demonstrated`, {
          context: 'volunteer_experience',
          source: { field: 'volunteering_id', id },
        });
      }
      out.push({
        ...compact({
          id,
          organization: this.c.text(src, 'organization', path),
          role: this.c.text(src, 'role', path),
          participation_type: this.c.enumValue(
            src,
            'participation_type',
            path,
            PARTICIPATION_TYPE_VALUES,
            { notes },
          ),
          start_date: this.c.date(src, 'start_date', path, notes),
          end_date: this.c.date(src, 'end_date', path, notes),
          responsibilities: this.c.list(src, 'responsibilities', path, 'text'),
          audience: this.c.text(src, 'audience', path, 'text', notes),
          outcomes: this.c.list(src, 'outcomes', path, 'text'),
        }),
        meta: this.meta(path, {
          evidence: src.evidence_ids,
          resumeUse: this.disclosure(src.disclosure, path, notes),
          notes,
        }),
      });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // evidencias, pendencias, regras

  private evidence(): Obj[] {
    const out: Obj[] = [];
    for (const { src, path } of this.kept('evidence_registry', 'evidencia')) {
      this.c.unknownKeys(src, Object.keys(LEGACY_V1_SHAPES.evidence), path);
      const notes: string[] = [];
      const id = this.idFor(src, 'EVD', path);
      const claims = this.c.list(src, 'supported_claims', path, 'text');
      const baseNotes = this.c.text(src, 'notes', path, 'text', notes);
      const noteText = [
        baseNotes,
        claims.length > 0
          ? `${this.c.t('Afirmacoes sustentadas', 'Supported claims')}: ${claims.join('; ')}`
          : null,
      ]
        .filter((part): part is string => part !== null)
        .join('\n');
      const sharing = src.approved_for_recruiter_sharing;
      out.push(
        compact({
          id,
          type: this.c.enumValue(src, 'type', path, EVIDENCE_TYPE_VALUES, { notes }),
          title: this.c.text(src, 'title', path),
          url_or_location: this.c.text(src, 'url_or_location', path, 'text', notes),
          evidence_date: this.c.date(src, 'evidence_date', path, notes),
          is_public: typeof src.is_public === 'boolean' ? src.is_public : null,
          recruiter_sharing:
            typeof sharing === 'boolean' ? (sharing ? 'allowed' : 'not_allowed') : null,
          notes: noteText === '' ? null : this.c.fit(noteText, 'text', `${path}.notes`),
        }),
      );
    }
    return out;
  }

  private pendingItems(): void {
    for (const { src, path } of this.kept('pending_items', 'pendencia')) {
      this.c.unknownKeys(src, Object.keys(LEGACY_V1_SHAPES.pending_item), path);
      const subject = this.c.text(src, 'subject', path);
      if (subject === null) {
        this.recordsDropped += 1;
        this.report.warn('EMPTY_RECORD_DROPPED', path, 'Pendencia sem assunto descartada.');
        continue;
      }
      const status = this.c.enumValue(
        src,
        'status',
        path,
        ['open', 'resolved', 'dismissed'] as const,
        {
          aliases: { ignored: 'dismissed' },
        },
      );
      const item = compact({
        id: this.idFor(src, 'PND', path),
        subject,
        current_information: this.c.text(src, 'current_information', path, 'text'),
        reason: 'unclear',
        reason_detail: this.c.text(src, 'uncertainty_reason', path, 'text'),
        known_variants: this.c.list(src, 'known_variants', path, 'text'),
        safe_statement_for_now: this.c.text(src, 'safe_statement_for_now', path, 'text'),
        confirmation_method: this.c.text(src, 'confirmation_method', path, 'text'),
        priority: this.c.enumValue(src, 'priority', path, PRIORITY_VALUES),
        status,
      });
      this.usedIds.add(item.id as string);
      this.pendings.push(item);
    }
  }

  private usageRules(): void {
    const src = this.profile.usage_rules;
    if (!isObj(src)) return;
    const path = 'profile.usage_rules';
    const lists: [string, string][] = [
      ['never_include_in_resume', 'never_include'],
      ['require_approval_before_inclusion', 'require_approval'],
      ['confidential_employers_or_projects', 'never_include'],
      ['links_not_to_share', 'never_include'],
      ['private_career_guidance_only', 'private_guidance_only'],
      ['additional_restrictions', 'require_approval'],
    ];
    this.c.unknownKeys(
      src,
      lists.map(([key]) => key),
      path,
    );
    for (const [key, rule] of lists) {
      for (const term of this.c.list(src, key, path)) {
        const restriction: Obj = {
          id: this.c.alloc('RST'),
          target: { term },
          rule,
          reason: this.c.t(`Origem 1.0.0: ${key}`, `1.0.0 source: ${key}`),
        };
        this.usedIds.add(restriction.id as string);
        this.restrictions.push(restriction);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // preferencias

  private availability(): Obj | null {
    const src = this.profile.availability_preferences;
    if (!isObj(src)) return null;
    const path = 'profile.availability_preferences';
    this.c.unknownKeys(src, Object.keys(LEGACY_AVAILABILITY), path);
    if (
      typeof src.privacy === 'string' &&
      src.privacy.trim() !== '' &&
      src.privacy.trim() !== 'private'
    ) {
      this.report.warn(
        'PRIVACY_FORCED_PRIVATE',
        `${path}.privacy`,
        `privacy "${src.privacy}" ignorado: disponibilidade e preferencias sao privadas por construcao no 2.0.0.`,
      );
    }
    if (isUntouchedBlock(src, TEMPLATE_DEFAULTS.availability)) {
      this.c.countBlankStrings(src, path);
      return null;
    }
    const modes = (key: string) =>
      this.c
        .list(src, key, path)
        .map((value) => {
          const slug = value.toLowerCase();
          if ((WORK_MODE_VALUES as readonly string[]).includes(slug)) return slug;
          this.c.reject(
            path,
            key,
            value,
            'INVALID_ENUM_VALUE_DROPPED',
            undefined,
            `modalidade "${value}" desconhecida`,
          );
          return null;
        })
        .filter((value): value is string => value !== null);
    const contracts = this.c
      .list(src, 'preferred_contract_types', path)
      .map((value) => {
        const slug = value.toLowerCase().replace(/[\s-]+/g, '_');
        const aliases: Record<string, string> = {
          apprentice: 'apprenticeship',
          clt: 'employee',
          pj: 'contractor',
          servidor: 'public_service',
        };
        const mapped = (EMPLOYMENT_TYPE_VALUES as readonly string[]).includes(slug)
          ? slug
          : aliases[slug];
        if (mapped) return mapped;
        this.c.reject(
          path,
          'preferred_contract_types',
          value,
          'INVALID_ENUM_VALUE_DROPPED',
          undefined,
          `tipo de contrato "${value}" desconhecido`,
        );
        return null;
      })
      .filter((value): value is string => value !== null);

    let salary: Obj | null = null;
    if (isObj(src.salary_expectation)) {
      const s = src.salary_expectation;
      const sp = `${path}.salary_expectation`;
      this.c.unknownKeys(s, ['amount', 'currency', 'period', 'notes'], sp);
      let amount: number | null = null;
      if (typeof s.amount === 'number') {
        if (nonNegativeNumber.safeParse(s.amount).success) amount = s.amount;
        else
          this.c.reject(
            sp,
            'amount',
            s.amount,
            'INVALID_VALUE_DROPPED',
            undefined,
            'valor negativo ou invalido',
          );
      }
      let currency = this.c.text(s, 'currency', sp);
      if (currency !== null) {
        const upper = currency.toUpperCase();
        if (currencySchema.safeParse(upper).success) currency = upper;
        else {
          this.c.reject(
            sp,
            'currency',
            currency,
            'INVALID_VALUE_DROPPED',
            undefined,
            'moeda fora do padrao ISO 4217',
          );
          currency = null;
        }
      }
      salary = compact({
        amount,
        currency,
        period: this.c.enumValue(s, 'period', sp, SALARY_PERIOD_VALUES),
        notes: this.c.text(s, 'notes', sp, 'text'),
      });
      if (Object.keys(salary).length === 0) salary = null;
    }
    const travelRaw = this.c.text(src, 'travel_availability', path);
    let travel: string | null = null;
    let travelNotes: string | null = null;
    if (travelRaw !== null && travelRaw !== 'not_specified') {
      if ((TRI_STATE_VALUES as readonly string[]).includes(travelRaw.toLowerCase()))
        travel = travelRaw.toLowerCase();
      else travelNotes = travelRaw;
    }
    return compact({
      preferred_work_modes: modes('preferred_work_modes'),
      accepted_work_modes: modes('accepted_work_modes'),
      target_regions_countries: this.c.list(src, 'target_regions_countries', path),
      willing_to_relocate: this.c.enumValue(src, 'willing_to_relocate', path, TRI_STATE_VALUES, {
        aliases: { not_specified: null },
      }),
      travel_availability: travel,
      travel_notes: travelNotes,
      start_availability: this.c.text(src, 'start_availability', path),
      preferred_contract_types: contracts,
      preferred_workload: this.c.text(src, 'preferred_workload', path),
      compatible_timezones_hours: this.c.text(src, 'compatible_timezones_hours', path),
      salary_expectation: salary,
      desired_benefits: this.c.list(src, 'desired_benefits', path),
      work_environment_preferences: this.c.list(src, 'work_environment_preferences', path, 'text'),
      work_conditions: this.c.list(src, 'work_conditions', path, 'text'),
      deal_breakers: this.c.list(src, 'deal_breakers', path, 'text'),
    });
  }

  private resumePreferences(): Obj | null {
    const src = this.profile.resume_preferences;
    if (!isObj(src)) return null;
    const path = 'profile.resume_preferences';
    this.c.unknownKeys(src, Object.keys(LEGACY_RESUME), path);
    if (isUntouchedBlock(src, TEMPLATE_DEFAULTS.resume)) {
      this.c.countBlankStrings(src, path);
      return null;
    }
    const styleNotes: string[] = [];
    const base = this.c.text(src, 'additional_style_notes', path, 'long');
    if (base) styleNotes.push(base);

    const sections = (key: string): string[] =>
      this.c
        .list(src, key, path)
        .map((value) => {
          const slug = value.toLowerCase();
          if ((RESUME_SECTION_VALUES as readonly string[]).includes(slug)) return slug;
          this.c.reject(
            path,
            key,
            value,
            'INVALID_ENUM_VALUE_DROPPED',
            undefined,
            `secao "${value}" desconhecida`,
          );
          return null;
        })
        .filter((value): value is string => value !== null);

    const refs = (key: string, label: string): { experiences: string[]; both: string[] } => {
      const experiences: string[] = [];
      const both: string[] = [];
      for (const value of this.c.list(src, key, path)) {
        const exp = this.expIds.get(value) ?? [...this.expIds.values()].find((id) => id === value);
        const proj = this.projIds.get(value);
        if (exp) {
          experiences.push(exp);
          both.push(exp);
        } else if (proj) {
          both.push(proj);
        } else {
          styleNotes.push(`${label}: ${value}`);
          this.report.warn(
            'REFERENCE_UNRESOLVED',
            `${path}.${key}`,
            `"${value}" nao corresponde a um id de experiencia/projeto; texto movido para additional_style_notes.`,
          );
        }
      }
      return { experiences, both };
    };
    const older = refs('older_experiences_to_summarize', 'older_experiences_to_summarize');
    const highlight = refs('highlight_when_relevant', 'highlight_when_relevant');

    const photoRaw = src.include_photo;
    const out = compact({
      default_language: this.localeOf(src, 'default_language', path),
      regional_variant: this.localeOf(src, 'regional_variant', path),
      tone: this.c.enumValue(src, 'tone', path, TONE_VALUES),
      preferred_length: this.c.enumValue(src, 'preferred_length', path, PREFERRED_LENGTH_VALUES),
      output_formats: this.c
        .list(src, 'output_formats', path)
        .map((value) => value.toLowerCase())
        .filter((value) => {
          const ok = (OUTPUT_FORMAT_VALUES as readonly string[]).includes(value);
          if (!ok)
            this.c.reject(
              path,
              'output_formats',
              value,
              'INVALID_ENUM_VALUE_DROPPED',
              undefined,
              `formato "${value}" desconhecido`,
            );
          return ok;
        }),
      visual_style: this.c.enumValue(src, 'visual_style', path, VISUAL_STYLE_VALUES),
      photo_preference:
        typeof photoRaw === 'boolean' ? (photoRaw ? 'when_appropriate' : 'never') : null,
      default_headline: this.c.text(src, 'default_headline', path),
      preferred_sections: sections('preferred_sections'),
      sections_to_omit: sections('sections_to_omit'),
      older_experience_ids: older.experiences,
      highlight_record_ids: highlight.both,
      preferred_vocabulary: this.c.list(src, 'preferred_vocabulary', path),
      expressions_to_avoid: this.c.list(src, 'expressions_to_avoid', path),
      additional_style_notes:
        styleNotes.length > 0
          ? this.c.fit(styleNotes.join('\n'), 'long', `${path}.additional_style_notes`)
          : null,
    });
    return Object.keys(out).length > 0 ? out : null;
  }

  private localeOf(src: Obj, key: string, path: string): string | null {
    const value = this.c.text(src, key, path);
    return value === null ? null : this.c.locale(value, `${path}.${key}`);
  }

  private additionalContext(): Obj | null {
    const src = this.profile.additional_professional_context;
    if (!isObj(src)) return null;
    const path = 'profile.additional_professional_context';
    this.c.unknownKeys(src, Object.keys(LEGACY_ADDITIONAL), path);
    const out = compact({
      industry_knowledge: this.c.list(src, 'industry_knowledge', path, 'text'),
      standards_regulations: this.c.list(src, 'standards_regulations', path, 'text'),
      specialized_equipment: this.c.list(src, 'specialized_equipment', path, 'text'),
      methods_processes_frameworks: this.c.list(src, 'methods_processes_frameworks', path, 'text'),
      international_experience: this.c.text(src, 'international_experience', path, 'text'),
      distributed_team_experience: this.c.text(src, 'distributed_team_experience', path, 'text'),
      stakeholder_experience: this.c.text(src, 'stakeholder_experience', path, 'text'),
      other: this.c.text(src, 'other', path, 'text'),
    });
    return Object.keys(out).length > 0 ? out : null;
  }

  private review(): Obj | null {
    const src = this.profile.review;
    if (!isObj(src)) return null;
    const path = 'profile.review';
    this.c.unknownKeys(src, Object.keys(LEGACY_REVIEW), path);
    const consent = typeof src.processing_consent === 'string' ? src.processing_consent.trim() : '';
    const consentNotes = typeof src.consent_notes === 'string' ? src.consent_notes.trim() : '';
    if ((consent !== '' && consent !== 'not_recorded') || consentNotes !== '') {
      this.report.warn(
        'CONSENT_IN_FILE_NOT_RECORDED',
        `${path}.processing_consent`,
        `processing_consent "${consent || '(vazio)'}" no arquivo NAO conta como consentimento: o consentimento e registrado na aplicacao (ADR-0014).`,
      );
    }
    if (isUntouchedBlock(src, TEMPLATE_DEFAULTS.review, ['processing_consent', 'consent_notes'])) {
      this.c.countBlankStrings(src, path);
      return null;
    }
    const out = compact({
      profile_created_date: this.c.date(src, 'profile_created_date', path),
      last_reviewed_date: this.c.date(src, 'last_reviewed_date', path),
      reviewed_by: this.c.enumValue(src, 'reviewed_by', path, REVIEWED_BY_VALUES),
      reviewed_sections: this.c.list(src, 'reviewed_sections', path),
      items_to_update: this.c.list(src, 'items_to_update', path, 'text'),
    });
    return Object.keys(out).length > 0 ? out : null;
  }

  // ---------------------------------------------------------------------------

  run(): Obj {
    const profile = this.profile;
    const knownSections = [
      'identity',
      'contact',
      'positioning',
      'competency_examples',
      'experiences',
      'projects',
      'education',
      'courses',
      'skills',
      'developing_knowledge',
      'languages',
      'certifications',
      'awards',
      'publications_research_talks',
      'volunteering_and_leadership',
      'freelance_and_business',
      'availability_preferences',
      'career_preferences',
      'resume_preferences',
      'additional_professional_context',
      'evidence_registry',
      'pending_items',
      'usage_rules',
      'review',
    ];
    this.c.unknownKeys(profile, knownSections, 'profile');

    // evidencias primeiro: os ids sao necessarios para validar as referencias dos demais registros
    const evidence = this.evidence();
    for (const item of evidence) this.evidenceIds.add(item.id as string);

    // registros referenciaveis recebem ids antes das competencias (que os referenciam)
    const experiences = this.experiences();
    const freelance = this.freelanceExperiences();
    const projects = this.projects();
    const education = this.education();
    const courses = this.courses();
    // competencias dependem dos mapas de ids de experiencias/projetos/formacao
    this.skillsCatalog();
    this.developingKnowledge();
    const certifications = this.certifications();
    const languages = this.languages();
    const awards = this.awards();
    const publications = this.publications();
    const volunteering = this.volunteering();
    const competencyExamples = this.competencyExamples();
    this.pendingItems();
    this.usageRules();
    const contactPoints = this.contacts();
    const positioning = this.positioning();
    const identity = this.identity();
    const career = this.career(positioning.careerExtra);
    const availability = this.availability();
    const resumePreferences = this.resumePreferences();
    const additional = this.additionalContext();
    const review = this.review();

    this.c.flushBlankStrings();

    // as competencias criadas a partir de experiencias precisam existir antes dos usos: ja ordenados
    const skillsOut = this.skills.map(stripInternal);
    const profileOut = compact({
      identity,
      contact_points: contactPoints,
      positioning: positioning.block,
      statements: this.statements,
      competency_examples: competencyExamples,
      experiences: [...experiences, ...freelance],
      projects,
      education,
      courses,
      skills: skillsOut,
      skill_usages: this.usages,
      languages,
      certifications,
      awards,
      publications,
      volunteering,
      evidence,
      pending_items: this.pendings,
      availability_preferences: availability,
      career_preferences: career,
      resume_preferences: resumePreferences,
      additional_professional_context: additional,
      usage_rules: this.restrictions.length > 0 ? { restrictions: this.restrictions } : null,
      review,
    });

    // avisos agregados de mapeamento
    for (const [key, count] of [...this.usageMapCounts].sort(([a], [b]) => a.localeCompare(b))) {
      if (key.startsWith('usage_context:')) {
        this.report.info(
          'USAGE_CONTEXT_MAPPED',
          'profile',
          `${count} uso(s) de tecnologia com contexto 1.0.0 "${key.slice(14)}" mapeado(s) para o vocabulario do ADR-0007.`,
        );
      } else if (key.startsWith('disclosure:')) {
        this.report.info(
          'DISCLOSURE_MAPPED',
          'profile',
          `${count} registro(s) com divulgacao "${key.slice(11)}" mapeada(s) para meta.resume_use.`,
        );
      } else {
        this.report.info(
          'RESUME_USAGE_MAPPED',
          'profile',
          `${count} registro(s) com ${key.replace(':', ' = ')} mapeado(s) para meta.resume_use.`,
        );
      }
    }
    if (this.declaredPreserved > 0) {
      this.report.info(
        'DECLARED_STATUS_PRESERVED',
        null,
        `${this.declaredPreserved} fact_status declarado(s) preservado(s) em meta.declared_status; status = needs_review.`,
      );
    }
    this.report.info(
      'STATUS_SET_NEEDS_REVIEW',
      null,
      'Todo fato migrado recebe status needs_review (plano 7.1).',
    );

    const recordCount = countRecords(profileOut);
    this.report.step(
      'v1_0_0_to_v2_1_0',
      FROM,
      TO,
      `Migracao do contrato 1.0.0 para ${TO} (domain-model.md secao 4).`,
      recordCount + this.recordsDropped,
    );

    const locale = typeof this.legacy.locale === 'string' ? this.legacy.locale.trim() : '';
    return compact({
      schema_version: TO,
      locale: locale === '' ? null : this.c.locale(locale, 'locale'),
      profile: profileOut,
    });
  }
}

function stripInternal(record: Obj): Obj {
  const { __overflow: _ignored, ...rest } = record;
  return rest;
}

const RESUME_USE_RANK: Record<string, number> = { allowed: 0, requires_approval: 1, never: 2 };

/** Une os `meta` de competencias duplicadas: o primeiro valor vence, exceto `resume_use` (vence o mais restritivo). */
function mergeMeta(base: Obj, extra: Obj): Obj {
  const notes = [base.private_notes, extra.private_notes].filter(
    (v): v is string => typeof v === 'string',
  );
  const evidence = unionStrings(
    base.evidence_ids as string[] | undefined,
    extra.evidence_ids as string[] | undefined,
  );
  const uses = [base.resume_use, extra.resume_use].filter(
    (v): v is string => typeof v === 'string',
  );
  const resumeUse =
    uses.sort((a, b) => (RESUME_USE_RANK[b] ?? 0) - (RESUME_USE_RANK[a] ?? 0))[0] ?? null;
  return compact({
    ...extra,
    ...base,
    declared_status: base.declared_status ?? extra.declared_status ?? null,
    resume_use: resumeUse,
    evidence_ids: evidence,
    private_notes: notes.length > 0 ? notes.join('\n') : null,
  });
}

function countRecords(profile: Obj): number {
  let total = 0;
  for (const value of Object.values(profile)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      total += 1;
      if (isObj(item)) {
        for (const child of Object.values(item)) if (Array.isArray(child)) total += child.length;
      }
    }
  }
  return total;
}

/** Ids 1.0.0 validos presentes no documento (reservados para o alocador nao colidir). */
function collectLegacyIds(profile: Obj): string[] {
  const ids: string[] = [];
  for (const value of Object.values(profile)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (isObj(item) && typeof item.id === 'string' && LOCAL_ID_REGEX.test(item.id.trim()))
        ids.push(item.id.trim());
    }
  }
  return ids;
}

const LEGACY_IDENTITY = {
  full_name: 1,
  preferred_name: 1,
  pronunciation: 1,
  pronouns: 1,
  country_of_residence: 1,
  city: 1,
  region: 1,
  country_of_work_interest: 1,
  timezone: 1,
  interface_languages: 1,
};
const LEGACY_POSITIONING = {
  current_profession: 1,
  current_job_title: 1,
  current_seniority: 1,
  professional_headline: 1,
  one_sentence_intro: 1,
  short_summary: 1,
  full_summary: 1,
  career_narrative: 1,
  primary_fields: 1,
  secondary_fields: 1,
  preferred_job_titles: 1,
  excluded_job_titles: 1,
  industries_of_interest: 1,
  industries_to_avoid: 1,
  professional_interests: 1,
  preferred_problems_to_solve: 1,
  short_term_goals: 1,
  long_term_goals: 1,
  demonstrable_differentiators: 1,
  professional_values: 1,
};
const LEGACY_COMPETENCY = {
  competency: 1,
  situation: 1,
  action: 1,
  outcome_or_learning: 1,
  evidence_ids: 1,
};
const LEGACY_CAREER = {
  priority_job_titles: 1,
  secondary_job_titles: 1,
  fields_of_interest: 1,
  preferred_industries: 1,
  excluded_industries: 1,
  target_seniority_levels: 1,
  accepted_equivalent_titles: 1,
  misleading_titles_to_avoid: 1,
  preferred_responsibilities: 1,
  responsibilities_to_avoid: 1,
  interest_in_adjacent_fields: 1,
};
const LEGACY_AVAILABILITY = {
  privacy: 1,
  preferred_work_modes: 1,
  accepted_work_modes: 1,
  target_regions_countries: 1,
  willing_to_relocate: 1,
  travel_availability: 1,
  start_availability: 1,
  preferred_contract_types: 1,
  preferred_workload: 1,
  compatible_timezones_hours: 1,
  salary_expectation: 1,
  desired_benefits: 1,
  work_environment_preferences: 1,
  work_conditions: 1,
  deal_breakers: 1,
};
const LEGACY_RESUME = {
  default_language: 1,
  regional_variant: 1,
  tone: 1,
  preferred_length: 1,
  output_formats: 1,
  visual_style: 1,
  include_photo: 1,
  default_headline: 1,
  preferred_sections: 1,
  sections_to_omit: 1,
  older_experiences_to_summarize: 1,
  highlight_when_relevant: 1,
  preferred_vocabulary: 1,
  expressions_to_avoid: 1,
  additional_style_notes: 1,
};
const LEGACY_ADDITIONAL = {
  industry_knowledge: 1,
  standards_regulations: 1,
  specialized_equipment: 1,
  methods_processes_frameworks: 1,
  international_experience: 1,
  distributed_team_experience: 1,
  stakeholder_experience: 1,
  other: 1,
};
const LEGACY_REVIEW = {
  profile_created_date: 1,
  last_reviewed_date: 1,
  reviewed_by: 1,
  reviewed_sections: 1,
  items_to_update: 1,
  processing_consent: 1,
  consent_notes: 1,
};

/** Passo puro `1.0.0 -> 2.0.0`. Devolve o documento 2.0.0 (nao validado) e registra no relatorio. */
export function migrateV1ToV2(legacy: LegacyProfileV1, report: ReportBuilder): Obj {
  return new V1Migrator(legacy, report).run();
}

export { formatPath };
