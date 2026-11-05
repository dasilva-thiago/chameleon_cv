import { z } from 'zod';

/**
 * DTOs das vagas salvas (P1). O texto da vaga e DADO nao confiavel: guardado exatamente como colado
 * (sem normalizar) e nunca interpretado como instrucao. Requisicoes sao estritas.
 */

export const JOB_STATUSES = [
  'saved',
  'analyzed',
  'application_prepared',
  'application_sent',
  'interview',
  'closed',
  'archived',
] as const;
export const jobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof jobStatusSchema>;

/** Vagas "em andamento": tudo que nao foi encerrado nem arquivado. */
export const ACTIVE_JOB_STATUSES = [
  'saved',
  'analyzed',
  'application_prepared',
  'application_sent',
  'interview',
] as const satisfies readonly JobStatus[];

export const JOB_WORK_MODES = ['remote', 'hybrid', 'onsite'] as const;
export const jobWorkModeSchema = z.enum(JOB_WORK_MODES);
export type JobWorkMode = z.infer<typeof jobWorkModeSchema>;

export const JOB_LIMITS = {
  shortText: 200,
  url: 2_048,
  description: 30_000,
  notes: 5_000,
  query: 100,
  listMax: 200,
  excerpt: 240,
} as const;

const NOT_BLANK = /\S/;
// eslint-disable-next-line no-control-regex -- rejeitar NUL e controles (exceto \t \n \r) e o objetivo
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Texto opcional de uma linha: aparado; vazio vira `null` (campo "nao informado"). */
const optionalLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !CONTROL_CHARS.test(value), { message: 'Caractere inválido.' })
    .nullable()
    .transform((value) => (value === '' ? null : value));

/** http(s) com host, sem usuário/senha (nada antes de um `@` na autoridade) e sem espaços. */
const HTTP_URL = /^https?:\/\/[^\s/?#@]+(?:[/?#]\S*)?$/i;

const optionalUrl = z
  .string()
  .trim()
  .max(JOB_LIMITS.url)
  .nullable()
  .transform((value) => (value === '' ? null : value))
  .refine((value) => value === null || HTTP_URL.test(value), {
    message: 'Informe um endereço http:// ou https:// válido, sem usuário nem senha.',
  });

/** Data civil `AAAA-MM-DD` valida. */
export const jobDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Data inválida.');

/** Descricao integral: obrigatoria, preservada como colada (so limites de tamanho e caracteres). */
export const jobDescriptionSchema = z
  .string()
  .max(JOB_LIMITS.description, `A descrição aceita até ${JOB_LIMITS.description} caracteres.`)
  .regex(NOT_BLANK, 'Cole a descrição da vaga.')
  .refine((value) => !CONTROL_CHARS.test(value), { message: 'Caractere inválido.' });

const notesSchema = z
  .string()
  .max(JOB_LIMITS.notes)
  .refine((value) => !CONTROL_CHARS.test(value), { message: 'Caractere inválido.' })
  .nullable()
  .transform((value) => (value === null || !NOT_BLANK.test(value) ? null : value));

const jobFieldShape = {
  title: optionalLine(JOB_LIMITS.shortText),
  company: optionalLine(JOB_LIMITS.shortText),
  url: optionalUrl,
  location: optionalLine(JOB_LIMITS.shortText),
  workMode: jobWorkModeSchema.nullable(),
  postedOn: jobDateSchema.nullable(),
  notes: notesSchema,
  status: jobStatusSchema,
} as const;

/** `POST /api/jobs`. So a descricao e obrigatoria. */
export const createJobRequestSchema = z.strictObject({
  description: jobDescriptionSchema,
  title: jobFieldShape.title.optional(),
  company: jobFieldShape.company.optional(),
  url: jobFieldShape.url.optional(),
  location: jobFieldShape.location.optional(),
  workMode: jobFieldShape.workMode.optional(),
  postedOn: jobFieldShape.postedOn.optional(),
  notes: jobFieldShape.notes.optional(),
  status: jobFieldShape.status.optional(),
});
export type CreateJobRequest = z.input<typeof createJobRequestSchema>;

/** `PATCH /api/jobs/:jobId`: so os campos enviados mudam; `null` limpa um campo opcional. */
export const patchJobRequestSchema = z
  .strictObject({
    description: jobDescriptionSchema.optional(),
    title: jobFieldShape.title.optional(),
    company: jobFieldShape.company.optional(),
    url: jobFieldShape.url.optional(),
    location: jobFieldShape.location.optional(),
    workMode: jobFieldShape.workMode.optional(),
    postedOn: jobFieldShape.postedOn.optional(),
    notes: jobFieldShape.notes.optional(),
    status: jobFieldShape.status.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Informe ao menos um campo para alterar.',
  });
export type PatchJobRequest = z.input<typeof patchJobRequestSchema>;

export const JOB_STATUS_FILTERS = ['active', 'all', ...JOB_STATUSES] as const;

/** `GET /api/jobs?status=&q=&limit=` (padrao: vagas em andamento). */
export const listJobsQuerySchema = z.strictObject({
  status: z.enum(JOB_STATUS_FILTERS).default('active'),
  q: z
    .string()
    .trim()
    .max(JOB_LIMITS.query)
    .optional()
    .transform((value) => (value === undefined || value === '' ? undefined : value)),
  limit: z.coerce.number().int().min(1).max(JOB_LIMITS.listMax).default(100),
});
export type ListJobsQuery = z.input<typeof listJobsQuerySchema>;

const countSchema = z.number().int().nonnegative();

export const jobSummarySchema = z.strictObject({
  id: z.uuid(),
  title: z.string().nullable(),
  company: z.string().nullable(),
  url: z.string().nullable(),
  location: z.string().nullable(),
  workMode: jobWorkModeSchema.nullable(),
  postedOn: z.string().nullable(),
  status: jobStatusSchema,
  /** Inicio do texto da vaga, em uma linha, para a listagem. */
  excerpt: z.string(),
  descriptionLength: countSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type JobSummary = z.infer<typeof jobSummarySchema>;

export const jobDetailSchema = jobSummarySchema.extend({
  /** Texto original, exatamente como foi salvo. */
  description: z.string(),
  /** SHA-256 hex do texto original (chave de cache das analises, P2). */
  descriptionHash: z.string().regex(/^[0-9a-f]{64}$/),
  notes: z.string().nullable(),
});
export type JobDetail = z.infer<typeof jobDetailSchema>;

export const listJobsResponseSchema = z.strictObject({
  jobs: z.array(jobSummarySchema),
  /** Contagem por status sobre TODAS as vagas (nao so as listadas), para os filtros. */
  counts: z.strictObject({
    total: countSchema,
    active: countSchema,
    byStatus: z.record(jobStatusSchema, countSchema),
  }),
});
export type ListJobsResponse = z.infer<typeof listJobsResponseSchema>;

export const jobResponseSchema = z.strictObject({ job: jobDetailSchema });
export type JobResponse = z.infer<typeof jobResponseSchema>;

export const deleteJobResponseSchema = z.strictObject({ deleted: z.literal(true), id: z.uuid() });
export type DeleteJobResponse = z.infer<typeof deleteJobResponseSchema>;
