import { z } from 'zod';

/**
 * Currículos por vaga. O conteúdo é um documento estruturado (cabeçalho + seções) escrito pela IA a partir da base
 * profissional e da avaliação da vaga, e conferido pelo programa contra a base (números, tecnologias, cargos, ordem,
 * expressões proibidas), como no career-ops. Uma versão `approved` é imutável: editar gera uma nova versão `draft`.
 * O arquivo exportado (DOCX/PDF) é sempre renderizado do conteúdo aprovado.
 */

export const RESUME_LIMITS = {
  name: 120,
  line: 200,
  period: 60,
  bulletText: 600,
  bulletsPerEntry: 24,
  entriesPerSection: 30,
  sections: 10,
  contacts: 8,
  id: 40,
} as const;

const NO_CONTROL =
  // eslint-disable-next-line no-control-regex -- rejeitar NUL e controles (exceto \t \n \r)
  /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;

const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(NO_CONTROL, 'Caractere inválido.')
    .refine((value) => !value.includes('\n'), { message: 'Use uma única linha.' });

const nullableLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .regex(NO_CONTROL, 'Caractere inválido.')
    .nullable()
    .transform((value) => (value === '' ? null : value));

const itemId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Id inválido.');

export const RESUME_BULLET_ORIGINS = ['generated', 'edited', 'added'] as const;

export const resumeBulletSchema = z.strictObject({
  id: itemId,
  text: z
    .string()
    .trim()
    .min(1, 'O texto não pode ficar vazio.')
    .max(RESUME_LIMITS.bulletText, `Use até ${RESUME_LIMITS.bulletText} caracteres.`)
    .regex(NO_CONTROL, 'Caractere inválido.'),
  origin: z.enum(RESUME_BULLET_ORIGINS),
});
export type ResumeBullet = z.infer<typeof resumeBulletSchema>;

export const resumeEntrySchema = z.strictObject({
  id: itemId,
  heading: line(RESUME_LIMITS.line),
  subheading: nullableLine(RESUME_LIMITS.line),
  period: nullableLine(RESUME_LIMITS.period),
  /** Linha de apoio sob o cabeçalho: local (experiência e formação) ou tecnologias (projeto). */
  detail: nullableLine(RESUME_LIMITS.line).optional(),
  /** Link público da entrada (projeto publicado, repositório). Só http(s). */
  url: nullableLine(2048)
    .refine((value) => value === null || /^https?:\/\/\S+$/i.test(value), {
      message: 'Use uma URL http(s) válida.',
    })
    .optional(),
  bullets: z.array(resumeBulletSchema).max(RESUME_LIMITS.bulletsPerEntry),
});
export type ResumeEntry = z.infer<typeof resumeEntrySchema>;

export const RESUME_SECTION_KINDS = [
  'summary',
  'competencies',
  'skills',
  'experience',
  'projects',
  'education',
  'certifications',
  'languages',
] as const;
export const resumeSectionKindSchema = z.enum(RESUME_SECTION_KINDS);
export type ResumeSectionKind = z.infer<typeof resumeSectionKindSchema>;

export const resumeBodySectionSchema = z.strictObject({
  id: itemId,
  kind: resumeSectionKindSchema,
  title: line(RESUME_LIMITS.line),
  entries: z.array(resumeEntrySchema).max(RESUME_LIMITS.entriesPerSection),
});
export type ResumeBodySection = z.infer<typeof resumeBodySectionSchema>;

export const resumeContactSchema = z.strictObject({
  kind: z.enum(['email', 'phone', 'link']),
  value: line(2048),
  label: nullableLine(RESUME_LIMITS.line),
});
export type ResumeContact = z.infer<typeof resumeContactSchema>;

export const resumeHeaderSchema = z.strictObject({
  name: line(RESUME_LIMITS.line),
  /** Título descritivo adaptado à vaga (sem senioridade nem tecnologia que a base não sustente). */
  headline: nullableLine(RESUME_LIMITS.line),
  location: nullableLine(RESUME_LIMITS.line),
  contacts: z.array(resumeContactSchema).max(RESUME_LIMITS.contacts),
});
export type ResumeHeader = z.infer<typeof resumeHeaderSchema>;

export const resumeContentSchema = z.strictObject({
  schemaVersion: z.literal(2),
  language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/),
  header: resumeHeaderSchema,
  sections: z.array(resumeBodySectionSchema).max(RESUME_LIMITS.sections),
});
export type ResumeContent = z.infer<typeof resumeContentSchema>;

// --- Validação de factualidade --------------------------------------------------------------

/**
 * Checagens do career-ops portadas para o currículo gerado:
 * - `UNSUPPORTED_NUMBER` (erro): número/métrica que não aparece na base;
 * - `TITLE_MISMATCH` (erro): cargo diferente do cargo da base para a mesma empresa;
 * - `SENIORITY_CLAIM` (erro): termo de senioridade (Sênior, Pleno, Líder...) que a base não sustenta;
 * - `FORBIDDEN_PHRASE` (erro): expressão que o perfil manda evitar;
 * - `UNSUPPORTED_TERM` (aviso): palavra-chave da vaga que não aparece na base;
 * - `EXPERIENCE_ORDER` (aviso): experiências fora da ordem da base;
 * - `UNKNOWN_EXPERIENCE` (aviso): empresa que não está na base;
 * - `EMPTY_CONTENT` / `DUPLICATE_ID` (erro): estrutura.
 */
export const RESUME_ISSUE_CODES = [
  'UNSUPPORTED_NUMBER',
  'TITLE_MISMATCH',
  'SENIORITY_CLAIM',
  'FORBIDDEN_PHRASE',
  'UNSUPPORTED_TERM',
  'EXPERIENCE_ORDER',
  'UNKNOWN_EXPERIENCE',
  'EMPTY_CONTENT',
  'DUPLICATE_ID',
] as const;
export type ResumeIssueCode = (typeof RESUME_ISSUE_CODES)[number];

export const resumeIssueSchema = z.strictObject({
  /** `error` impede a aprovação; `warning` pede conferência. */
  severity: z.enum(['error', 'warning']),
  code: z.enum(RESUME_ISSUE_CODES),
  /** Caminho no conteúdo, ex.: `sections.1.entries.0.bullets.2`. */
  path: z.string().max(200),
  message: z.string().max(400),
});
export type ResumeIssue = z.infer<typeof resumeIssueSchema>;

// --- Versões e currículos -------------------------------------------------------------------

export const RESUME_VERSION_STATUSES = ['draft', 'approved'] as const;
export const resumeVersionStatusSchema = z.enum(RESUME_VERSION_STATUSES);
export type ResumeVersionStatus = z.infer<typeof resumeVersionStatusSchema>;

const countSchema = z.number().int().nonnegative();

export const resumeVersionSummarySchema = z.strictObject({
  id: z.uuid(),
  resumeId: z.uuid(),
  versionNumber: z.number().int().positive(),
  status: resumeVersionStatusSchema,
  language: z.string(),
  /** Versão de origem (cópia/recuperação), se houver. */
  sourceVersionId: z.uuid().nullable(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  issueCounts: z.strictObject({ errors: countSchema, warnings: countSchema }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  approvedAt: z.iso.datetime().nullable(),
});
export type ResumeVersionSummary = z.infer<typeof resumeVersionSummarySchema>;

/** Cobertura das palavras-chave da vaga no currículo (career-ops, keyword-match). */
export const keywordCoverageSchema = z.strictObject({
  percent: z.number().int().min(0).max(100),
  present: z.array(z.string().max(80)).max(40),
  missing: z.array(z.string().max(80)).max(40),
});
export type KeywordCoverage = z.infer<typeof keywordCoverageSchema>;

export const resumeVersionDetailSchema = resumeVersionSummarySchema.extend({
  content: resumeContentSchema,
  issues: z.array(resumeIssueSchema).max(200),
  /** Cobertura das palavras-chave da avaliação; null sem avaliação. */
  coverage: keywordCoverageSchema.nullable(),
  /** Revisão da base usada na geração (a checagem de uma versão aprovada usa esta). */
  profileRevisionId: z.uuid().nullable(),
  /** Avaliação da vaga que orientou a geração. */
  analysisId: z.uuid().nullable(),
});
export type ResumeVersionDetail = z.infer<typeof resumeVersionDetailSchema>;

export const resumeSummarySchema = z.strictObject({
  id: z.uuid(),
  jobId: z.uuid(),
  name: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** Mais nova primeiro. */
  versions: z.array(resumeVersionSummarySchema),
});
export type ResumeSummary = z.infer<typeof resumeSummarySchema>;

/** `POST /api/jobs/:jobId/resumes`: gera a versão 1 (rascunho) a partir do perfil e da análise da vaga. */
export const createResumeRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(RESUME_LIMITS.name).optional(),
});
export type CreateResumeRequest = z.input<typeof createResumeRequestSchema>;

/** Resposta de `POST /api/jobs/:jobId/resumes`: o currículo, a versão 1 e o que ficou de fora (e por quê). */
export const createResumeResponseSchema = z.strictObject({
  resume: resumeSummarySchema,
  version: resumeVersionDetailSchema,
  notes: z.array(z.string().max(300)).max(20),
});
export type CreateResumeResponse = z.infer<typeof createResumeResponseSchema>;

export const listResumesResponseSchema = z.strictObject({ resumes: z.array(resumeSummarySchema) });
export type ListResumesResponse = z.infer<typeof listResumesResponseSchema>;

export const resumeResponseSchema = z.strictObject({ resume: resumeSummarySchema });
export type ResumeResponse = z.infer<typeof resumeResponseSchema>;

export const resumeVersionResponseSchema = z.strictObject({ version: resumeVersionDetailSchema });
export type ResumeVersionResponse = z.infer<typeof resumeVersionResponseSchema>;

/** `PUT /api/resumes/:resumeId/versions/:versionId`: substitui o conteúdo de um RASCUNHO. */
export const updateResumeVersionRequestSchema = z.strictObject({ content: resumeContentSchema });
export type UpdateResumeVersionRequest = z.input<typeof updateResumeVersionRequestSchema>;

/** `POST /api/resumes/:resumeId/versions`: nova versão rascunho copiada de uma versão existente. */
export const newResumeVersionRequestSchema = z.strictObject({ fromVersionId: z.uuid() });
export type NewResumeVersionRequest = z.input<typeof newResumeVersionRequestSchema>;

export const renameResumeRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(RESUME_LIMITS.name),
});
export type RenameResumeRequest = z.input<typeof renameResumeRequestSchema>;

export const deleteResumeResponseSchema = z.strictObject({
  deleted: z.literal(true),
  id: z.uuid(),
});
export type DeleteResumeResponse = z.infer<typeof deleteResumeResponseSchema>;

// --- Exportação (P4) ------------------------------------------------------------------------

export const RESUME_EXPORT_FORMATS = ['pdf', 'docx', 'html'] as const;
export const resumeExportFormatSchema = z.enum(RESUME_EXPORT_FORMATS);
export type ResumeExportFormat = z.infer<typeof resumeExportFormatSchema>;

/** `modern` (padrão): cabeçalho com destaque, competências e seções em cor. `classic`: o modelo original, simples. */
export const RESUME_EXPORT_TEMPLATES = ['modern', 'classic'] as const;
export const resumeExportTemplateSchema = z.enum(RESUME_EXPORT_TEMPLATES);
export type ResumeExportTemplate = z.infer<typeof resumeExportTemplateSchema>;
export const DEFAULT_RESUME_EXPORT_TEMPLATE: ResumeExportTemplate = 'modern';

/** `GET /api/resumes/:resumeId/versions/:versionId/export?format=pdf|docx|html&template=modern|classic`: só versões aprovadas (409 caso contrário). */
export const exportResumeQuerySchema = z.strictObject({
  format: resumeExportFormatSchema,
  template: resumeExportTemplateSchema.default(DEFAULT_RESUME_EXPORT_TEMPLATE),
});
export type ExportResumeQuery = z.input<typeof exportResumeQuerySchema>;

export const RESUME_EXPORT_CONTENT_TYPES = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  html: 'text/html; charset=utf-8',
} as const;
