import { z } from 'zod';

/**
 * Avaliacao de uma vaga contra a base profissional (fluxo do career-ops, modo `oferta`). Duas etapas de IA:
 *
 * 1. **Leitura da vaga** (`extraction`), so com o texto da vaga: resumo da vaga, requisitos com importancia e
 *    nivel de evidencia, palavras-chave. A importancia nunca e decidida olhando o candidato.
 * 2. **Avaliacao** contra a base (CV + perfil e regras): tipo de vaga, regras que barram a vaga, match por
 *    requisito com evidencia citada da base, lacunas com mitigacao, notas por dimensao, nota global 1-5,
 *    veredito, pretensao salarial e plano de adaptacao do curriculo.
 *
 * O codigo confere o que a IA afirma: citacoes da vaga precisam existir na vaga, evidencias precisam existir na
 * base, `inferred` nunca vira `critical`/`high`, e a recomendacao sai da nota (regra do career-ops).
 */

export const ANALYSIS_LIMITS = {
  requirements: 40,
  requirementText: 300,
  quote: 400,
  keywords: 25,
  keyword: 60,
  gaps: 20,
  text: 600,
  shortText: 200,
  list: 12,
  warnings: 10,
} as const;

const text = (max: number) => z.string().trim().min(1).max(max);
const nullableText = (max: number) => z.string().trim().max(max).nullable();
const requirementId = z.string().regex(/^r[0-9]{1,3}$/);

// --- Etapa 1: leitura da vaga -----------------------------------------------------------------------------

/** Faixas de importancia (career-ops, Block B). */
export const REQUIREMENT_IMPORTANCES = [
  'critical',
  'high',
  'meaningful',
  'preferred',
  'low_signal',
] as const;
export const requirementImportanceSchema = z.enum(REQUIREMENT_IMPORTANCES);
export type RequirementImportance = z.infer<typeof requirementImportanceSchema>;

/** De onde vem a importancia: a vaga diz (`stated`), a estrutura da vaga mostra (`structural`) ou e inferida. */
export const EVIDENCE_TIERS = ['stated', 'structural', 'inferred'] as const;
export const evidenceTierSchema = z.enum(EVIDENCE_TIERS);
export type EvidenceTier = z.infer<typeof evidenceTierSchema>;

export const WORK_MODES = ['remote', 'hybrid', 'onsite', 'unknown'] as const;
export const CONTRACT_TYPES = ['clt', 'pj', 'internship', 'temporary', 'other', 'unknown'] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];
export const SALARY_PERIODS = ['monthly', 'yearly', 'hourly'] as const;

export const salaryInfoSchema = z.strictObject({
  min: z.number().nonnegative().nullable(),
  max: z.number().nonnegative().nullable(),
  currency: z.string().trim().max(8).nullable(),
  period: z.enum(SALARY_PERIODS).nullable(),
  /** Trecho da vaga que traz o valor (verbatim). */
  quote: nullableText(ANALYSIS_LIMITS.quote),
});
export type SalaryInfo = z.infer<typeof salaryInfoSchema>;

export const roleSummarySchema = z.strictObject({
  title: nullableText(ANALYSIS_LIMITS.shortText),
  company: nullableText(ANALYSIS_LIMITS.shortText),
  seniority: nullableText(80),
  workMode: z.enum(WORK_MODES),
  location: nullableText(ANALYSIS_LIMITS.shortText),
  contract: z.enum(CONTRACT_TYPES),
  salary: salaryInfoSchema.nullable(),
  /** Resumo da vaga em uma frase. */
  tldr: nullableText(ANALYSIS_LIMITS.text),
});
export type RoleSummary = z.infer<typeof roleSummarySchema>;

export const extractedRequirementSchema = z.strictObject({
  id: requirementId,
  text: text(ANALYSIS_LIMITS.requirementText),
  importance: requirementImportanceSchema,
  tier: evidenceTierSchema,
  /** Trecho verbatim da vaga que sustenta a importancia (`stated`), ou a secao (`structural`); null em `inferred`. */
  jdSignal: nullableText(ANALYSIS_LIMITS.quote),
});
export type ExtractedRequirement = z.infer<typeof extractedRequirementSchema>;

export const jobExtractionSchema = z.strictObject({
  promptVersion: z.string().max(40),
  role: roleSummarySchema,
  requirements: z.array(extractedRequirementSchema).max(ANALYSIS_LIMITS.requirements),
  /** 15 a 20 palavras-chave da vaga (tecnologias, ferramentas, conceitos), na grafia da vaga. */
  keywords: z.array(text(ANALYSIS_LIMITS.keyword)).max(ANALYSIS_LIMITS.keywords),
});
export type JobExtraction = z.infer<typeof jobExtractionSchema>;

// --- Etapa 2: avaliacao contra a base ---------------------------------------------------------------------

export const MATCH_LEVELS = ['strong', 'partial', 'missing', 'na'] as const;
export const matchLevelSchema = z.enum(MATCH_LEVELS);
export type MatchLevel = z.infer<typeof matchLevelSchema>;

export const requirementMatchSchema = z.strictObject({
  requirementId,
  match: matchLevelSchema,
  /** Trecho verbatim da base (CV ou perfil) que sustenta o match. */
  evidence: nullableText(ANALYSIS_LIMITS.quote),
  /** O programa achou a evidencia na base? Se nao, um `strong` cai para `partial`. */
  evidenceVerified: z.boolean(),
  /** O que falta, quando o match nao e `strong`. */
  gap: nullableText(ANALYSIS_LIMITS.text),
});
export type RequirementMatch = z.infer<typeof requirementMatchSchema>;

export const gapSchema = z.strictObject({
  requirementId,
  /** Bloqueia a candidatura (requisito eliminatorio) ou e contornavel. */
  blocker: z.boolean(),
  risk: text(ANALYSIS_LIMITS.text),
  mitigation: text(ANALYSIS_LIMITS.text),
});
export type Gap = z.infer<typeof gapSchema>;

export const ARCHETYPE_FITS = ['primary', 'secondary', 'adjacent', 'none'] as const;
export type ArchetypeFit = (typeof ARCHETYPE_FITS)[number];

export const archetypeSchema = z.strictObject({
  /** Tipo de vaga, nos termos dos alvos do perfil ("Nenhum dos alvos" e um resultado valido). */
  label: text(ANALYSIS_LIMITS.shortText),
  fit: z.enum(ARCHETYPE_FITS),
  note: nullableText(ANALYSIS_LIMITS.text),
});
export type Archetype = z.infer<typeof archetypeSchema>;

export const dealbreakerSchema = z.strictObject({
  /** A regra do perfil que a vaga quebra. */
  rule: text(ANALYSIS_LIMITS.shortText),
  /** Trecho verbatim da vaga que quebra a regra (conferido pelo programa). */
  jdQuote: text(ANALYSIS_LIMITS.quote),
});
export type Dealbreaker = z.infer<typeof dealbreakerSchema>;

const dimension = z.number().min(1).max(5);

export const dimensionScoresSchema = z.strictObject({
  /** Match com o CV: competencias, experiencia, provas. */
  cvMatch: dimension,
  /** Alinhamento com os alvos do perfil. */
  northStar: dimension,
  /** Remuneracao frente as faixas do perfil; null quando a vaga nao informa. */
  comp: dimension.nullable(),
  /** Modalidade, local e sinais da empresa frente a politica do perfil. */
  conditions: dimension,
  /** Sinais de alerta (5 = nenhum). */
  redFlags: dimension,
});
export type DimensionScores = z.infer<typeof dimensionScoresSchema>;

export const RECOMMENDATIONS = ['apply', 'consider', 'skip'] as const;
export const recommendationSchema = z.enum(RECOMMENDATIONS);
export type Recommendation = z.infer<typeof recommendationSchema>;

export const verdictSchema = z.strictObject({
  recommendation: recommendationSchema,
  /** O veredito em uma frase. */
  headline: text(ANALYSIS_LIMITS.text),
  reasons: z.array(text(ANALYSIS_LIMITS.text)).max(6),
});
export type Verdict = z.infer<typeof verdictSchema>;

export const salarySuggestionSchema = z.strictObject({
  min: z.number().nonnegative(),
  max: z.number().nonnegative(),
  currency: z.string().trim().min(1).max(8),
  period: z.enum(SALARY_PERIODS),
  contract: z.enum(CONTRACT_TYPES),
  /** Como responder no formulario. */
  text: text(ANALYSIS_LIMITS.text),
  sources: z.array(text(ANALYSIS_LIMITS.shortText)).max(6),
  /** Ex.: a empresa nao informou salario. */
  warning: nullableText(ANALYSIS_LIMITS.text),
});
export type SalarySuggestion = z.infer<typeof salarySuggestionSchema>;

export const analysisAiSchema = z.strictObject({
  provider: z.string().max(40),
  model: z.string().max(120),
  promptVersion: z.string().max(40),
});
export type AnalysisAi = z.infer<typeof analysisAiSchema>;

export const analysisResultSchema = z.strictObject({
  schemaVersion: z.literal(2),
  extraction: jobExtractionSchema,
  archetype: archetypeSchema,
  dealbreakers: z.array(dealbreakerSchema).max(ANALYSIS_LIMITS.list),
  matches: z.array(requirementMatchSchema).max(ANALYSIS_LIMITS.requirements),
  gaps: z.array(gapSchema).max(ANALYSIS_LIMITS.gaps),
  scores: dimensionScoresSchema,
  /** Nota global 1-5, uma casa decimal. */
  score: z.number().min(1).max(5),
  verdict: verdictSchema,
  salary: salarySuggestionSchema.nullable(),
  /** O que enfatizar no curriculo desta vaga (plano de adaptacao). */
  customization: z.array(text(ANALYSIS_LIMITS.text)).max(ANALYSIS_LIMITS.list),
  /** Requisitos na ordem de exibicao: importancia desc, nao atendidos antes dos atendidos. */
  order: z.array(requirementId).max(ANALYSIS_LIMITS.requirements),
  ai: analysisAiSchema,
  warnings: z.array(text(ANALYSIS_LIMITS.text)).max(ANALYSIS_LIMITS.warnings),
});
export type AnalysisResult = z.infer<typeof analysisResultSchema>;

// --- Rotas ------------------------------------------------------------------------------------------------

export const jobAnalysisSchema = z.strictObject({
  id: z.uuid(),
  jobId: z.uuid(),
  result: analysisResultSchema,
  createdAt: z.iso.datetime(),
  /** Hash do texto da vaga e da base no momento da avaliacao. */
  descriptionHash: z.string().regex(/^[0-9a-f]{64}$/),
  profileHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type JobAnalysis = z.infer<typeof jobAnalysisSchema>;

export const runAnalysisRequestSchema = z.strictObject({
  /** Refaz mesmo sem mudanca (nova chamada de IA). */
  force: z.boolean().default(false),
});
export type RunAnalysisRequest = z.input<typeof runAnalysisRequestSchema>;

export const STALE_REASONS = ['job_text', 'profile'] as const;

export const analysisStateResponseSchema = z.strictObject({
  analysis: jobAnalysisSchema.nullable(),
  /** O texto da vaga ou a base mudou desde a avaliacao. */
  stale: z.boolean(),
  staleBecause: z.array(z.enum(STALE_REASONS)),
});
export type AnalysisStateResponse = z.infer<typeof analysisStateResponseSchema>;

export const runAnalysisResponseSchema = analysisStateResponseSchema.extend({
  /** A avaliacao guardada foi devolvida sem nova chamada. */
  reused: z.boolean(),
});
export type RunAnalysisResponse = z.infer<typeof runAnalysisResponseSchema>;
