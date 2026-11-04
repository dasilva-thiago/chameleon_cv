import { z } from 'zod';
import type { RecordKind } from '../../common/enums';
import {
  autonomySchema,
  awardScopeSchema,
  certificationCategorySchema,
  certificationStatusSchema,
  contactKindSchema,
  contactSubtypeSchema,
  courseStatusSchema,
  degreeTypeSchema,
  educationStatusSchema,
  employmentTypeSchema,
  evidenceTypeSchema,
  experienceItemKindSchema,
  frequencySchema,
  languageLevelSchema,
  participationTypeSchema,
  pendingReasonSchema,
  pendingStatusSchema,
  prioritySchema,
  projectCategorySchema,
  projectItemKindSchema,
  projectStatusSchema,
  publicAccessSchema,
  publicationStatusSchema,
  publicationTypeSchema,
  recruiterSharingSchema,
  referencePermissionSchema,
  restrictionRuleSchema,
  selfAssessedLevelSchema,
  skillCategorySchema,
  statementKindSchema,
  studyModalitySchema,
  usageContextSchema,
  visibilitySchema,
  workModeSchema,
} from '../../common/enums';
import {
  emailSchema,
  httpUrlSchema,
  idList,
  LIMITS,
  localeSchema,
  localIdSchema,
  longText,
  partialDateSchema,
  periodEndSchema,
  shortText,
  shortTextList,
  text,
  textList,
} from '../../common/primitives';
import { phoneSchema } from '../../common/phone';
import { factRecord, nested, periodRule, plainRecord } from './factories';

/**
 * Chaves que apenas classificam um registro e NAO contam como conteudo (um registro so com
 * `kind`/`type`/`status` e "fantasma"). Usado pelo contrato e pelo normalizador do importador.
 */
export const RECORD_DISCRIMINATORS = {
  contact_point: ['kind', 'subtype'],
  statement: ['kind', 'locale'],
  experience_item: ['kind'],
  project_item: ['kind'],
  evidence: ['type'],
  pending_item: ['priority', 'status', 'reason'],
  restriction: ['rule'],
} as const satisfies Partial<Record<RecordKind, readonly string[]>>;

/** Metrica de uma entrega, conquista ou resultado. Valores sao texto: o formato varia (35%, 2h, R$ 10 mil). */
const metricSchema = nested({
  name: shortText.nullish(),
  value: shortText.nullish(),
  baseline: shortText.nullish(),
  period: shortText.nullish(),
  method: text.nullish(),
});

const optionalArray = <T extends z.ZodType>(item: T, max: number = LIMITS.subRecords) =>
  z.array(item).max(max).nullish();

// ---------------------------------------------------------------------------
// Contatos

const CONTACT_SUBTYPES: Record<string, readonly string[]> = {
  email: ['professional', 'personal', 'other'],
  phone: ['professional', 'personal', 'mobile', 'landline', 'whatsapp', 'other'],
  link: [
    'linkedin',
    'github',
    'gitlab',
    'bitbucket',
    'portfolio',
    'website',
    'behance',
    'dribbble',
    'artstation',
    'professional',
    'personal',
    'other',
  ],
};

export const contactPointSchema = plainRecord(
  {
    kind: contactKindSchema,
    subtype: contactSubtypeSchema.nullish(),
    value: z.string().max(LIMITS.url).min(1),
    label: shortText.nullish(),
    visibility: visibilitySchema.nullish(),
    include_by_default: z.boolean().nullish(),
    is_primary: z.boolean().nullish(),
    notes: text.nullish(),
  },
  { discriminators: RECORD_DISCRIMINATORS.contact_point },
).superRefine((contact, ctx) => {
  const validator =
    contact.kind === 'email' ? emailSchema : contact.kind === 'phone' ? phoneSchema : httpUrlSchema;
  const result = validator.safeParse(contact.value);
  if (!result.success) {
    ctx.addIssue({
      code: 'custom',
      message: `Valor invalido para contato do tipo "${contact.kind}": ${result.error.issues[0]?.message ?? 'formato invalido'}`,
      path: ['value'],
    });
  }
  if (contact.subtype && !CONTACT_SUBTYPES[contact.kind]?.includes(contact.subtype)) {
    ctx.addIssue({
      code: 'custom',
      message: `Subtipo "${contact.subtype}" nao se aplica a contato do tipo "${contact.kind}".`,
      path: ['subtype'],
    });
  }
});

// ---------------------------------------------------------------------------
// Declaracoes e exemplos de competencia (citaveis)

export const statementSchema = factRecord(
  {
    kind: statementKindSchema,
    text: longText,
    locale: localeSchema.nullish(),
  },
  { discriminators: RECORD_DISCRIMINATORS.statement },
);

export const competencyExampleSchema = factRecord({
  competency: shortText.nullish(),
  situation: text.nullish(),
  action: text.nullish(),
  outcome_or_learning: text.nullish(),
  related_skill_ids: idList.nullish(),
});

// ---------------------------------------------------------------------------
// Experiencias

export const experienceItemSchema = factRecord(
  {
    kind: experienceItemKindSchema,
    text,
    frequency: frequencySchema.nullish(),
    autonomy: autonomySchema.nullish(),
    outcome: text.nullish(),
    metric: metricSchema.nullish(),
    personal_contribution: text.nullish(),
    problem: text.nullish(),
    collaborators: shortTextList.nullish(),
    steps: textList.nullish(),
    verification: text.nullish(),
  },
  { discriminators: RECORD_DISCRIMINATORS.experience_item },
);

const locationSchema = nested({
  city: shortText.nullish(),
  region: shortText.nullish(),
  country: shortText.nullish(),
});

const businessSchema = nested({
  activity: shortText.nullish(),
  client_market_description: text.nullish(),
  services_scope: textList.nullish(),
  client_count: z.number().int().min(0).max(1_000_000).nullish(),
  portfolio_url: httpUrlSchema.nullish(),
});

export const experienceSchema = factRecord({
  organization_name: shortText.nullish(),
  organization_public_name: shortText.nullish(),
  /** Agrupa varios cargos no mesmo empregador (promocoes): mesmo valor = mesmo grupo. */
  organization_group: shortText.nullish(),
  industry: shortText.nullish(),
  location: locationSchema.nullish(),
  official_title: shortText.nullish(),
  display_title: shortText.nullish(),
  employment_type: employmentTypeSchema.nullish(),
  department: shortText.nullish(),
  manager_or_team: shortText.nullish(),
  workload: shortText.nullish(),
  start_date: partialDateSchema.nullish(),
  end_date: periodEndSchema.nullish(),
  work_mode: workModeSchema.nullish(),
  company_context: text.nullish(),
  role_objective: text.nullish(),
  products_services_users: text.nullish(),
  operational_scope: text.nullish(),
  team_interfaces: textList.nullish(),
  transferable_skills: textList.nullish(),
  lessons_learned: textList.nullish(),
  /** Privado por construcao: nunca entra no contexto de geracao. */
  exit_reason: text.nullish(),
  reference_contact_permission: referencePermissionSchema.nullish(),
  business: businessSchema.nullish(),
  items: optionalArray(experienceItemSchema),
}).superRefine(periodRule('start_date', 'end_date'));

// ---------------------------------------------------------------------------
// Projetos

export const projectItemSchema = factRecord(
  {
    kind: projectItemKindSchema,
    text,
    metric: metricSchema.nullish(),
  },
  { discriminators: RECORD_DISCRIMINATORS.project_item },
);

export const collaboratorSchema = plainRecord({
  name_or_role: shortText.nullish(),
  contribution: text.nullish(),
});

export const projectSchema = factRecord({
  name: shortText.nullish(),
  category: projectCategorySchema.nullish(),
  team_based: z.boolean().nullish(),
  status: projectStatusSchema.nullish(),
  start_date: partialDateSchema.nullish(),
  end_date: periodEndSchema.nullish(),
  last_updated: partialDateSchema.nullish(),
  role: shortText.nullish(),
  public_access: publicAccessSchema.nullish(),
  license: shortText.nullish(),
  public_url: httpUrlSchema.nullish(),
  repository_url: httpUrlSchema.nullish(),
  documentation_url: httpUrlSchema.nullish(),
  demo_url: httpUrlSchema.nullish(),
  related_experience_id: localIdSchema.nullish(),
  related_education_id: localIdSchema.nullish(),
  collaborators: optionalArray(collaboratorSchema),
  personal_contribution: text.nullish(),
  contributions_by_others: text.nullish(),
  decision_ownership: text.nullish(),
  problem: text.nullish(),
  target_audience: text.nullish(),
  need_addressed: text.nullish(),
  proposed_solution: text.nullish(),
  architecture: text.nullish(),
  authentication_authorization: text.nullish(),
  known_limitations: textList.nullish(),
  next_improvements: textList.nullish(),
  learning: textList.nullish(),
  feedback: textList.nullish(),
  one_line_description: shortText.nullish(),
  short_description: text.nullish(),
  resume_keywords: shortTextList.nullish(),
  items: optionalArray(projectItemSchema),
}).superRefine(periodRule('start_date', 'end_date'));

// ---------------------------------------------------------------------------
// Formacao e cursos

export const educationSchema = factRecord({
  institution: shortText.nullish(),
  course_name: shortText.nullish(),
  degree_type: degreeTypeSchema.nullish(),
  field_of_study: shortText.nullish(),
  status: educationStatusSchema.nullish(),
  start_date: partialDateSchema.nullish(),
  completion_date: partialDateSchema.nullish(),
  expected_completion_date: partialDateSchema.nullish(),
  modality: studyModalitySchema.nullish(),
  location: shortText.nullish(),
  qualification_awarded: shortText.nullish(),
  thesis_title: shortText.nullish(),
  thesis_description: text.nullish(),
  supervisor: shortText.nullish(),
  relevant_coursework: shortTextList.nullish(),
  academic_projects: shortTextList.nullish(),
  honors_scholarships_distinctions: shortTextList.nullish(),
  verification_url: httpUrlSchema.nullish(),
}).superRefine(periodRule('start_date', 'completion_date'));

export const courseSchema = factRecord({
  name: shortText.nullish(),
  provider: shortText.nullish(),
  topics: shortTextList.nullish(),
  start_date: partialDateSchema.nullish(),
  completion_date: partialDateSchema.nullish(),
  workload_hours: z.number().min(0).max(100_000).nullish(),
  status: courseStatusSchema.nullish(),
  certificate_issued: z.boolean().nullish(),
  verification_url: httpUrlSchema.nullish(),
  activities_projects: textList.nullish(),
  skills_developed: shortTextList.nullish(),
  relevant_job_families: shortTextList.nullish(),
}).superRefine(periodRule('start_date', 'completion_date'));

// ---------------------------------------------------------------------------
// Competencias e contexto de uso (ADR-0007)

const studyPlanSchema = nested({
  scope: text.nullish(),
  sources: textList.nullish(),
  practical_project: text.nullish(),
  perceived_level: shortText.nullish(),
  next_goal: text.nullish(),
});

export const skillSchema = factRecord({
  name: shortText,
  category: skillCategorySchema.nullish(),
  aliases: shortTextList.nullish(),
  description: text.nullish(),
  self_assessed_level: selfAssessedLevelSchema.nullish(),
  tasks_can_perform: textList.nullish(),
  last_used: partialDateSchema.nullish(),
  duration_of_use: shortText.nullish(),
  limitations: text.nullish(),
  study_plan: studyPlanSchema.nullish(),
});

export const SKILL_USAGE_SOURCE_FIELDS = [
  'experience_id',
  'project_id',
  'education_id',
  'course_id',
  'certification_id',
  'volunteering_id',
] as const;

export const skillUsageSchema = factRecord({
  skill_id: localIdSchema,
  usage_context: usageContextSchema,
  experience_id: localIdSchema.nullish(),
  project_id: localIdSchema.nullish(),
  education_id: localIdSchema.nullish(),
  course_id: localIdSchema.nullish(),
  certification_id: localIdSchema.nullish(),
  volunteering_id: localIdSchema.nullish(),
  /** Faceta livre (ex.: "frontend", "gestao de estoque"): nao e enum para nao prender a uma profissao. */
  facet: shortText.nullish(),
  usage_description: text.nullish(),
  personal_implementation: text.nullish(),
  level_in_context: selfAssessedLevelSchema.nullish(),
  start_date: partialDateSchema.nullish(),
  end_date: periodEndSchema.nullish(),
  tasks: textList.nullish(),
}).superRefine(periodRule('start_date', 'end_date'));

/** Fontes aceitas por contexto (ADR-0007; "required" = ao menos uma das listadas). */
export const USAGE_CONTEXT_SOURCES: Record<
  string,
  { required: boolean; allowed: readonly (typeof SKILL_USAGE_SOURCE_FIELDS)[number][] }
> = {
  professional_experience: { required: true, allowed: ['experience_id'] },
  project_experience: { required: true, allowed: ['project_id'] },
  volunteer_experience: { required: true, allowed: ['volunteering_id', 'experience_id'] },
  coursework: { required: true, allowed: ['education_id', 'course_id'] },
  certification: { required: true, allowed: ['certification_id'] },
  self_declared_knowledge: { required: false, allowed: SKILL_USAGE_SOURCE_FIELDS },
  conceptual_familiarity: { required: false, allowed: SKILL_USAGE_SOURCE_FIELDS },
  unverified: { required: false, allowed: SKILL_USAGE_SOURCE_FIELDS },
};

// ---------------------------------------------------------------------------
// Idiomas, certificacoes, premios, publicacoes, voluntariado

export const languageSchema = factRecord({
  language: shortText,
  language_code: localeSchema.nullish(),
  overall_level: languageLevelSchema.nullish(),
  /**
   * Nivel descritivo declarado pela propria pessoa, em texto livre ("avancado", "nivel medio",
   * "fluente"). Contrato 2.1.0 (aditivo). NUNCA e convertido em CEFR automaticamente: quando o
   * nivel e conhecido na escala CEFR use `overall_level`; os dois podem coexistir.
   */
  self_described_level: shortText.nullish(),
  reading: languageLevelSchema.nullish(),
  writing: languageLevelSchema.nullish(),
  listening: languageLevelSchema.nullish(),
  speaking: languageLevelSchema.nullish(),
  professional_usage: text.nullish(),
  certification: nested({
    name: shortText.nullish(),
    issuer: shortText.nullish(),
    score: shortText.nullish(),
    assessment_date: partialDateSchema.nullish(),
    valid_until: partialDateSchema.nullish(),
  }).nullish(),
  certification_id: localIdSchema.nullish(),
});

export const certificationSchema = factRecord({
  name: shortText.nullish(),
  issuer: shortText.nullish(),
  category: certificationCategorySchema.nullish(),
  issue_date: partialDateSchema.nullish(),
  expiration_date: partialDateSchema.nullish(),
  public_identifier: shortText.nullish(),
  verification_url: httpUrlSchema.nullish(),
  status: certificationStatusSchema.nullish(),
}).superRefine(periodRule('issue_date', 'expiration_date'));

export const awardSchema = factRecord({
  name: shortText.nullish(),
  organization: shortText.nullish(),
  date: partialDateSchema.nullish(),
  context_and_criteria: text.nullish(),
  personal_contribution: text.nullish(),
  scope: awardScopeSchema.nullish(),
});

const DOI_REGEX = /^10\.\d{4,9}\/\S+$/;

export const publicationSchema = factRecord({
  title: shortText.nullish(),
  type: publicationTypeSchema.nullish(),
  date: partialDateSchema.nullish(),
  venue_or_institution: shortText.nullish(),
  authorship: shortText.nullish(),
  summary: text.nullish(),
  personal_contribution: text.nullish(),
  topics_methods: shortTextList.nullish(),
  url: httpUrlSchema.nullish(),
  doi: z
    .string()
    .max(200)
    .regex(DOI_REGEX, 'DOI invalido: use o formato 10.xxxx/sufixo.')
    .nullish(),
  status: publicationStatusSchema.nullish(),
});

export const volunteeringSchema = factRecord({
  organization: shortText.nullish(),
  role: shortText.nullish(),
  participation_type: participationTypeSchema.nullish(),
  start_date: partialDateSchema.nullish(),
  end_date: periodEndSchema.nullish(),
  responsibilities: textList.nullish(),
  audience: text.nullish(),
  outcomes: textList.nullish(),
}).superRefine(periodRule('start_date', 'end_date'));

// ---------------------------------------------------------------------------
// Evidencias, pendencias, restricoes

const URL_WITH_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export const evidenceSchema = plainRecord(
  {
    type: evidenceTypeSchema,
    title: shortText.nullish(),
    /** URL http(s) ou descricao textual da localizacao (ex.: "pasta fisica"). */
    url_or_location: text.nullish(),
    /** Ids dos registros sustentados por esta evidencia (a direcao inversa e `meta.evidence_ids`). */
    supports: idList.nullish(),
    evidence_date: partialDateSchema.nullish(),
    is_public: z.boolean().nullish(),
    recruiter_sharing: recruiterSharingSchema.nullish(),
    notes: text.nullish(),
  },
  { discriminators: RECORD_DISCRIMINATORS.evidence },
).superRefine((evidence, ctx) => {
  const location = evidence.url_or_location;
  if (typeof location === 'string' && URL_WITH_SCHEME.test(location.trim())) {
    if (!httpUrlSchema.safeParse(location.trim()).success) {
      ctx.addIssue({
        code: 'custom',
        message: 'url_or_location com esquema deve ser uma URL http(s) valida.',
        path: ['url_or_location'],
      });
    }
  }
});

const targetSchema = nested({
  record_id: localIdSchema.nullish(),
  /** Caminho do campo: relativo ao registro (com `record_id`) ou absoluto (ex.: identity.pronouns). */
  field: z
    .string()
    .max(128)
    .regex(/^[A-Za-z][A-Za-z0-9_.[\]]*$/)
    .nullish(),
});

export const pendingItemSchema = plainRecord(
  {
    subject: shortText,
    target: targetSchema.nullish(),
    current_information: text.nullish(),
    reason: pendingReasonSchema.nullish(),
    reason_detail: text.nullish(),
    known_variants: textList.nullish(),
    safe_statement_for_now: text.nullish(),
    confirmation_method: text.nullish(),
    priority: prioritySchema.nullish(),
    status: pendingStatusSchema.nullish(),
  },
  { discriminators: RECORD_DISCRIMINATORS.pending_item },
);

export const restrictionSchema = plainRecord(
  {
    target: nested({
      record_id: localIdSchema.nullish(),
      field: z
        .string()
        .max(128)
        .regex(/^[A-Za-z][A-Za-z0-9_.[\]]*$/)
        .nullish(),
      /** Termo a filtrar (texto livre) quando a restricao nao aponta para um registro. */
      term: shortText.nullish(),
    }),
    rule: restrictionRuleSchema,
    reason: text.nullish(),
  },
  { discriminators: RECORD_DISCRIMINATORS.restriction },
).superRefine((restriction, ctx) => {
  const target = restriction.target;
  if (!target.record_id && !target.field && !target.term) {
    ctx.addIssue({
      code: 'custom',
      message: 'A restricao precisa de um alvo: record_id, field ou term.',
      path: ['target'],
    });
  }
  if (target.field && !target.record_id && target.term) {
    ctx.addIssue({
      code: 'custom',
      message: 'Use term OU field, nao os dois sem record_id.',
      path: ['target'],
    });
  }
});
