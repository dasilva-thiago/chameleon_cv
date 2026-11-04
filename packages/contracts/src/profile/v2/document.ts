import { z } from 'zod';
import { LIMITS, localeSchema } from '../../common/primitives';
import {
  additionalProfessionalContextSchema,
  availabilityPreferencesSchema,
  careerPreferencesSchema,
  identitySchema,
  positioningSchema,
  resumePreferencesSchema,
  reviewSchema,
  usageRulesSchema,
} from './blocks';
import { checkProfileIntegrity } from './integrity';
import {
  awardSchema,
  certificationSchema,
  competencyExampleSchema,
  contactPointSchema,
  courseSchema,
  educationSchema,
  evidenceSchema,
  experienceSchema,
  languageSchema,
  pendingItemSchema,
  projectSchema,
  publicationSchema,
  skillSchema,
  skillUsageSchema,
  statementSchema,
  volunteeringSchema,
} from './records';

export const PROFILE_SCHEMA_VERSION = '2.1.0' as const;

/** `$id` estavel do JSON Schema gerado (nao e uma URL publicada; identifica o contrato). */
export const PROFILE_JSON_SCHEMA_ID =
  'https://chameleon-cv.local/schemas/profile-document.v2.schema.json' as const;

const collection = <T extends z.ZodType>(item: T) => z.array(item).max(LIMITS.records).nullish();

/**
 * `profile`: todas as secoes sao opcionais (perfil parcial e perfil vazio sao validos).
 * Ausencia ou `null` = not_provided; `[]` = nenhum item fornecido.
 */
export const profileSchema = z.strictObject({
  identity: identitySchema.nullish(),
  contact_points: collection(contactPointSchema),
  positioning: positioningSchema.nullish(),
  statements: collection(statementSchema),
  competency_examples: collection(competencyExampleSchema),
  experiences: collection(experienceSchema),
  projects: collection(projectSchema),
  education: collection(educationSchema),
  courses: collection(courseSchema),
  skills: collection(skillSchema),
  skill_usages: collection(skillUsageSchema),
  languages: collection(languageSchema),
  certifications: collection(certificationSchema),
  awards: collection(awardSchema),
  publications: collection(publicationSchema),
  volunteering: collection(volunteeringSchema),
  evidence: collection(evidenceSchema),
  pending_items: collection(pendingItemSchema),
  availability_preferences: availabilityPreferencesSchema.nullish(),
  career_preferences: careerPreferencesSchema.nullish(),
  resume_preferences: resumePreferencesSchema.nullish(),
  additional_professional_context: additionalProfessionalContextSchema.nullish(),
  usage_rules: usageRulesSchema.nullish(),
  review: reviewSchema.nullish(),
});

/**
 * Contrato canonico 2.1.0 do documento de perfil (2.0.0 congelado na S0.2; 2.1.0 = MINOR aditivo da S0.2b; ver ADR-0004).
 * Fonte unica: tipos TypeScript, JSON Schema e templates derivam ou sao testados contra ele.
 */
export const profileDocumentSchema = z
  .strictObject({
    schema_version: z.literal(PROFILE_SCHEMA_VERSION),
    locale: localeSchema.nullish(),
    profile: profileSchema,
  })
  .superRefine((document, ctx) => {
    checkProfileIntegrity(document, ctx);
  });

export type Profile = z.infer<typeof profileSchema>;
export type ProfileDocument = z.infer<typeof profileDocumentSchema>;
/** Entrada aceita pelo contrato (igual a saida: nao ha transformacoes). */
export type ProfileDocumentInput = z.input<typeof profileDocumentSchema>;

export type Experience = z.infer<typeof experienceSchema>;
export type ExperienceItem = NonNullable<Experience['items']>[number];
export type Project = z.infer<typeof projectSchema>;
export type ProjectItem = NonNullable<Project['items']>[number];
export type Education = z.infer<typeof educationSchema>;
export type Course = z.infer<typeof courseSchema>;
export type Skill = z.infer<typeof skillSchema>;
export type SkillUsage = z.infer<typeof skillUsageSchema>;
export type Language = z.infer<typeof languageSchema>;
export type Certification = z.infer<typeof certificationSchema>;
export type Award = z.infer<typeof awardSchema>;
export type Publication = z.infer<typeof publicationSchema>;
export type Volunteering = z.infer<typeof volunteeringSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type PendingItem = z.infer<typeof pendingItemSchema>;
export type Statement = z.infer<typeof statementSchema>;
export type CompetencyExample = z.infer<typeof competencyExampleSchema>;
export type ContactPoint = z.infer<typeof contactPointSchema>;

// ---------------------------------------------------------------------------
// API de validacao

export interface ProfileIssue {
  /** Caminho no documento, ex.: `profile.experiences[0].start_date`. */
  path: string;
  /** Codigo do Zod (invalid_value, unrecognized_keys, custom, ...). */
  code: string;
  message: string;
  /** Chaves desconhecidas, quando `code === 'unrecognized_keys'`. */
  keys?: string[];
}

export function formatIssuePath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`;
    const key = String(segment);
    return acc ? `${acc}.${key}` : key;
  }, '');
}

export function toProfileIssues(error: z.ZodError): ProfileIssue[] {
  return error.issues.map((issue) => ({
    path: formatIssuePath(issue.path),
    code: issue.code,
    message: issue.message,
    ...(issue.code === 'unrecognized_keys' ? { keys: [...issue.keys] } : {}),
  }));
}

export type SafeParseProfileResult =
  { success: true; data: ProfileDocument } | { success: false; issues: ProfileIssue[] };

/** Valida sem lancar. Nao altera o documento (nao ha defaults nem transformacoes). */
export function safeParseProfileDocument(input: unknown): SafeParseProfileResult {
  const result = profileDocumentSchema.safeParse(input);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, issues: toProfileIssues(result.error) };
}

export class ProfileValidationError extends Error {
  readonly issues: ProfileIssue[];
  constructor(issues: ProfileIssue[]) {
    const head = issues
      .slice(0, 5)
      .map((issue) => `${issue.path || '(raiz)'}: ${issue.message}`)
      .join('; ');
    super(`Documento de perfil invalido (${issues.length} problema(s)): ${head}`);
    this.name = 'ProfileValidationError';
    this.issues = issues;
  }
}

/** Valida e devolve o documento; lanca `ProfileValidationError` com todos os problemas. */
export function parseProfileDocument(input: unknown): ProfileDocument {
  const result = safeParseProfileDocument(input);
  if (!result.success) throw new ProfileValidationError(result.issues);
  return result.data;
}

/** JSON Schema (draft 2020-12) do contrato. Subconjunto: a validacao semantica fica no Zod. */
export function buildProfileJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(profileDocumentSchema, {
    target: 'draft-2020-12',
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: PROFILE_JSON_SCHEMA_ID,
    title: 'Universal Professional Profile 2.1.0',
    description:
      'Contrato canonico 2.1.0 do perfil profissional. Subconjunto estrutural do contrato Zod: a validacao semantica (ids unicos, referencias, datas, contexto de competencias) so existe no Zod. Ausencia = omitido/null; texto vazio nao e permitido.',
    ...Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$schema')),
  };
}
