import { z } from 'zod';

/**
 * Currículos por vaga (P3/P4). O conteúdo é um documento estruturado em que TODA afirmação (item/bullet) aponta
 * para os ids dos registros do perfil que a sustentam (`sourceIds`). Uma versão `approved` é imutável: editar
 * gera uma nova versão `draft`. O arquivo exportado (DOCX/PDF) é sempre renderizado do conteúdo aprovado.
 */

export const RESUME_LIMITS = {
  name: 120,
  line: 200,
  period: 60,
  bulletText: 600,
  bulletsPerEntry: 12,
  entriesPerSection: 30,
  sections: 10,
  sourcesPerItem: 12,
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
const sourceIds = z.array(z.uuid()).max(RESUME_LIMITS.sourcesPerItem);

export const RESUME_BULLET_ORIGINS = ['generated', 'edited', 'added'] as const;

export const resumeBulletSchema = z.strictObject({
  id: itemId,
  text: z
    .string()
    .trim()
    .min(1, 'O texto não pode ficar vazio.')
    .max(RESUME_LIMITS.bulletText, `Use até ${RESUME_LIMITS.bulletText} caracteres.`)
    .regex(NO_CONTROL, 'Caractere inválido.'),
  /** Registros do perfil que sustentam a afirmação. */
  sourceIds,
  origin: z.enum(RESUME_BULLET_ORIGINS),
});
export type ResumeBullet = z.infer<typeof resumeBulletSchema>;

export const resumeEntrySchema = z.strictObject({
  id: itemId,
  heading: line(RESUME_LIMITS.line),
  subheading: nullableLine(RESUME_LIMITS.line),
  period: nullableLine(RESUME_LIMITS.period),
  bullets: z.array(resumeBulletSchema).max(RESUME_LIMITS.bulletsPerEntry),
  /** Registros que sustentam o cabeçalho da entrada (cargo, empresa, curso...). */
  sourceIds,
});
export type ResumeEntry = z.infer<typeof resumeEntrySchema>;

export const RESUME_SECTION_KINDS = [
  'summary',
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
  /** `contact_point` do perfil de onde veio (só contatos públicos/permitidos entram). */
  sourceId: z.uuid(),
});
export type ResumeContact = z.infer<typeof resumeContactSchema>;

export const resumeHeaderSchema = z.strictObject({
  name: line(RESUME_LIMITS.line),
  /** Título descritivo escolhido pela própria pessoa (`professional_headline`); nunca sintetizado. */
  headline: nullableLine(RESUME_LIMITS.line),
  location: nullableLine(RESUME_LIMITS.line),
  contacts: z.array(resumeContactSchema).max(RESUME_LIMITS.contacts),
});
export type ResumeHeader = z.infer<typeof resumeHeaderSchema>;

export const resumeContentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/),
  header: resumeHeaderSchema,
  sections: z.array(resumeBodySectionSchema).max(RESUME_LIMITS.sections),
});
export type ResumeContent = z.infer<typeof resumeContentSchema>;

// --- Validação de factualidade --------------------------------------------------------------

export const RESUME_ISSUE_CODES = [
  'NO_SOURCE',
  'UNKNOWN_SOURCE',
  'SOURCE_NOT_USABLE',
  'UNSUPPORTED_TERM',
  'EMPTY_CONTENT',
  'DUPLICATE_ID',
] as const;

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

export const resumeVersionDetailSchema = resumeVersionSummarySchema.extend({
  content: resumeContentSchema,
  issues: z.array(resumeIssueSchema).max(200),
  /** Revisão imutável do perfil usada na geração (reprodutibilidade da proveniência). */
  profileRevisionId: z.uuid().nullable(),
  /** Análise da vaga que orientou a geração. */
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

export const RESUME_EXPORT_FORMATS = ['docx', 'pdf'] as const;
export const resumeExportFormatSchema = z.enum(RESUME_EXPORT_FORMATS);
export type ResumeExportFormat = z.infer<typeof resumeExportFormatSchema>;

/** `GET /api/resumes/:resumeId/versions/:versionId/export?format=docx|pdf`: só versões aprovadas (409 caso contrário). */
export const exportResumeQuerySchema = z.strictObject({ format: resumeExportFormatSchema });
export type ExportResumeQuery = z.input<typeof exportResumeQuerySchema>;

export const RESUME_EXPORT_CONTENT_TYPES = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
} as const;
