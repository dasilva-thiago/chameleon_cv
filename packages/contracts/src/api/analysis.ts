import { z } from 'zod';
import { RECORD_KIND_VALUES, factStatusSchema, usageContextSchema } from '../common/enums';

const recordKindSchema = z.enum(RECORD_KIND_VALUES);

/**
 * Analise de uma vaga contra o perfil (P2): requisitos extraidos do texto, correspondencia
 * requisito -> evidencia -> forca -> origem -> lacuna, e plano de adaptacao revisavel. O resultado e
 * DERIVADO: nada aqui afirma algo que nao esteja em um registro do perfil, e cada evidencia aponta para o id do
 * registro que a sustenta. Com IA (`engine: "ai"`), ela so extrai requisitos e PROPOE vinculos; o codigo confere que o
 * registro existe e pode sustentar, e a forca da evidencia continua sendo decidida pelas regras locais.
 */

export const MATCHER_ENGINES = ['deterministic', 'ai'] as const;

export const REQUIREMENT_IMPORTANCES = ['mandatory', 'desirable', 'responsibility'] as const;
export const requirementImportanceSchema = z.enum(REQUIREMENT_IMPORTANCES);
export type RequirementImportance = z.infer<typeof requirementImportanceSchema>;

/**
 * Forca da correspondencia, da mais forte para a mais fraca:
 * - `direct`: fato confirmado de experiencia profissional;
 * - `partial`: fato confirmado, mas de projeto, estudo, curso, certificacao ou so declarado;
 * - `transferable`: habilidade confirmada de uma tecnologia relacionada (heuristica; exige revisao);
 * - `pending`: existe no perfil, mas aguarda confirmacao (ainda nao pode sustentar o curriculo);
 * - `absent`: nada no perfil sustenta o requisito.
 */
export const MATCH_STRENGTHS = ['direct', 'partial', 'transferable', 'pending', 'absent'] as const;
export const matchStrengthSchema = z.enum(MATCH_STRENGTHS);
export type MatchStrength = z.infer<typeof matchStrengthSchema>;

export const ANALYSIS_LIMITS = {
  requirements: 60,
  requirementText: 300,
  evidencePerRequirement: 8,
  prioritized: 25,
  keywordsPerRequirement: 12,
  reviewIds: 200,
  reviewNote: 500,
} as const;

export const jobRequirementSchema = z.strictObject({
  /** `r1`, `r2`... estavel dentro da analise. */
  id: z.string().regex(/^r\d{1,3}$/),
  importance: requirementImportanceSchema,
  /** Trecho do texto da vaga (aparado), nunca interpretado como instrucao. */
  text: z.string().max(ANALYSIS_LIMITS.requirementText),
  /** Termos que parecem tecnologias/ferramentas/siglas no texto do requisito (informativo). */
  keywords: z.array(z.string().max(60)).max(ANALYSIS_LIMITS.keywordsPerRequirement),
  /** "5 anos" no requisito, se houver. */
  yearsRequired: z.number().int().positive().max(50).nullable(),
});
export type JobRequirement = z.infer<typeof jobRequirementSchema>;

export const EVIDENCE_VIAS = ['skill', 'record_text'] as const;

export const evidenceRefSchema = z.strictObject({
  recordId: z.uuid(),
  kind: recordKindSchema,
  /** Rotulo curto do registro (nome, cargo, titulo), para a tela. */
  label: z.string().max(200),
  via: z.enum(EVIDENCE_VIAS),
  /** Contexto de uso que sustenta (so para habilidades com uso registrado). */
  context: usageContextSchema.nullable(),
  /** Registro de uso/experiencia que sustenta, quando existe. */
  supportingRecordId: z.uuid().nullable(),
  status: factStatusSchema,
  /** Termos do requisito encontrados neste registro. */
  matchedTerms: z.array(z.string().max(60)).max(ANALYSIS_LIMITS.keywordsPerRequirement),
});
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

export const requirementMatchSchema = z.strictObject({
  requirementId: z.string().regex(/^r\d{1,3}$/),
  strength: matchStrengthSchema,
  evidence: z.array(evidenceRefSchema).max(ANALYSIS_LIMITS.evidencePerRequirement),
  /** Por que esta forca (texto fixo, em portugues, sem conteudo do perfil alem de rotulos). */
  rationale: z.string().max(500),
  /** O que falta, quando `absent`/`pending`/`transferable`. */
  gap: z.string().max(500).nullable(),
  /** Cuidados ao usar a evidencia (ex.: so estudo, exige N anos). */
  cautions: z.array(z.string().max(300)).max(5),
  /** Aviso discreto sobre "experiencia" (a vaga pede tempo/experiencia, ou a evidencia e de projeto); a tela o recolhe. */
  experienceNote: z.string().max(700).optional(),
});
export type RequirementMatch = z.infer<typeof requirementMatchSchema>;

export const prioritizedRecordSchema = z.strictObject({
  recordId: z.uuid(),
  kind: recordKindSchema,
  label: z.string().max(200),
  strength: matchStrengthSchema,
  /** Peso: soma da importancia dos requisitos que o registro sustenta. */
  score: z.number().int().nonnegative(),
  requirementIds: z.array(z.string().regex(/^r\d{1,3}$/)).max(ANALYSIS_LIMITS.requirements),
});
export type PrioritizedRecord = z.infer<typeof prioritizedRecordSchema>;

const countSchema = z.number().int().nonnegative();
const strengthCountsSchema = z.strictObject({
  direct: countSchema,
  partial: countSchema,
  transferable: countSchema,
  pending: countSchema,
  absent: countSchema,
});

export const analysisResultSchema = z.strictObject({
  engine: z.enum(MATCHER_ENGINES),
  engineVersion: z.string().max(40),
  /** Quem gerou (so com `engine: "ai"`): provedor, modelo e versao do prompt. Sem conteudo da vaga ou do perfil. */
  ai: z
    .strictObject({
      provider: z.string().max(40),
      model: z.string().max(120),
      promptVersion: z.string().max(40),
    })
    .nullish(),
  requirements: z.array(jobRequirementSchema).max(ANALYSIS_LIMITS.requirements),
  matches: z.array(requirementMatchSchema).max(ANALYSIS_LIMITS.requirements),
  summary: z.strictObject({
    requirements: countSchema,
    byStrength: strengthCountsSchema,
    mandatoryByStrength: strengthCountsSchema,
  }),
  /** Registros do perfil a priorizar no curriculo (so fatos confirmados e permitidos), do mais ao menos relevante. */
  prioritized: z.array(prioritizedRecordSchema).max(ANALYSIS_LIMITS.prioritized),
  warnings: z.array(z.string().max(300)).max(10),
});
export type AnalysisResult = z.infer<typeof analysisResultSchema>;

/** Revisao da pessoa sobre o plano: nada aqui altera o perfil. */
export const analysisReviewSchema = z.strictObject({
  excludedRecordIds: z.array(z.uuid()).max(ANALYSIS_LIMITS.reviewIds),
  pinnedRecordIds: z.array(z.uuid()).max(ANALYSIS_LIMITS.reviewIds),
  /** Anotacoes por requisito (`r1`: "tenho experiencia, falta registrar"). */
  notes: z.record(z.string().regex(/^r\d{1,3}$/), z.string().max(ANALYSIS_LIMITS.reviewNote)),
});
export type AnalysisReview = z.infer<typeof analysisReviewSchema>;

export const EMPTY_REVIEW: AnalysisReview = {
  excludedRecordIds: [],
  pinnedRecordIds: [],
  notes: {},
};

export const jobAnalysisSchema = z.strictObject({
  id: z.uuid(),
  jobId: z.uuid(),
  result: analysisResultSchema,
  review: analysisReviewSchema,
  reviewedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  /** Hashes que identificam a entrada: texto da vaga e documento do perfil na hora da analise. */
  descriptionHash: z.string().regex(/^[0-9a-f]{64}$/),
  profileHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type JobAnalysis = z.infer<typeof jobAnalysisSchema>;

/** `POST /api/jobs/:jobId/analysis`. `force` refaz mesmo com entrada inalterada. */
export const runAnalysisRequestSchema = z.strictObject({
  force: z.boolean().default(false),
});
export type RunAnalysisRequest = z.input<typeof runAnalysisRequestSchema>;

export const analysisStateResponseSchema = z.strictObject({
  analysis: jobAnalysisSchema.nullable(),
  /** O texto da vaga ou o perfil mudaram desde a analise exibida. */
  stale: z.boolean(),
  /** Qual dos dois mudou (vazio se nao esta desatualizada). */
  staleBecause: z.array(z.enum(['job_text', 'profile'])),
});
export type AnalysisStateResponse = z.infer<typeof analysisStateResponseSchema>;

export const runAnalysisResponseSchema = analysisStateResponseSchema.extend({
  /** `true` se a analise anterior valia para a mesma entrada e foi reaproveitada (nada recalculado). */
  reused: z.boolean(),
});
export type RunAnalysisResponse = z.infer<typeof runAnalysisResponseSchema>;

/** `PATCH /api/jobs/:jobId/analysis/review`: substitui a revisao. */
export const patchAnalysisReviewRequestSchema = z.strictObject({
  review: analysisReviewSchema,
});
export type PatchAnalysisReviewRequest = z.input<typeof patchAnalysisReviewRequestSchema>;
