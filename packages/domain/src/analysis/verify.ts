import {
  ANALYSIS_LIMITS,
  REQUIREMENT_IMPORTANCES,
  type AnalysisAi,
  type AnalysisResult,
  type Archetype,
  type Dealbreaker,
  type DimensionScores,
  type Gap,
  type JobExtraction,
  type MatchLevel,
  type Recommendation,
  type RequirementImportance,
  type SalarySuggestion,
} from '@chameleon/contracts';
import { containsQuote, fold, tidy } from '../text/fold';

/**
 * Deterministic rules applied to what the AI returns, ported from career-ops (`modes/oferta.md`, Block B and the
 * scoring system). The AI reads and judges; the program enforces the parts that must not depend on the model.
 */

// --- Stage 1: the job extraction ---------------------------------------------------------------------------

/**
 * - `stated` needs a verbatim quote from the posting; without one it becomes `inferred`.
 * - `inferred` can never be `critical` or `high` (the gate: a market guess must not create obligations).
 * - a salary must be quoted from the posting, or it is dropped.
 * - keywords are de-duplicated (case/accents) and capped at 20.
 */
export function verifyExtraction(
  extraction: JobExtraction,
  jobText: string,
): { extraction: JobExtraction; warnings: string[] } {
  const job = fold(jobText);
  const warnings: string[] = [];
  let unquoted = 0;
  const requirements = extraction.requirements
    .slice(0, ANALYSIS_LIMITS.requirements)
    .map((req, index) => {
      let { tier, jdSignal, importance } = req;
      if (tier === 'stated' && (jdSignal === null || !containsQuote(job, jdSignal))) {
        tier = 'inferred';
        unquoted += 1;
      }
      if (tier === 'inferred') {
        jdSignal = null;
        if (importance === 'critical' || importance === 'high') importance = 'meaningful';
      }
      return { ...req, id: `r${String(index + 1)}`, tier, jdSignal, importance };
    });
  if (unquoted > 0) {
    warnings.push(
      `${String(unquoted)} requisito(s) sem citação literal da vaga foram tratados como inferidos (importância limitada).`,
    );
  }

  let salary = extraction.role.salary;
  if (salary !== null && (salary.quote === null || !containsQuote(job, salary.quote))) {
    salary = null;
    warnings.push('O salário extraído não foi encontrado no texto da vaga e foi descartado.');
  }

  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const keyword of extraction.keywords) {
    const key = fold(keyword);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    keywords.push(tidy(keyword, ANALYSIS_LIMITS.keyword));
  }

  return {
    extraction: {
      ...extraction,
      role: { ...extraction.role, salary },
      requirements,
      keywords: keywords.slice(0, 20),
    },
    warnings,
  };
}

// --- Stage 2: the evaluation ------------------------------------------------------------------------------

export interface DraftEvaluation {
  archetype: Archetype;
  dealbreakers: Dealbreaker[];
  matches: {
    requirementId: string;
    match: MatchLevel;
    evidence: string | null;
    gap: string | null;
  }[];
  gaps: Gap[];
  scores: DimensionScores;
  score: number;
  verdict: { headline: string; reasons: string[] };
  salary: SalarySuggestion | null;
  customization: string[];
}

export interface FinalizeInput {
  extraction: JobExtraction;
  draft: DraftEvaluation;
  jobText: string;
  /** CV + profile Markdown: where every evidence quote must be found. */
  baseText: string;
  ai: AnalysisAi;
  warnings?: string[];
}

/** career-ops score interpretation: 4.0+ apply, 3.5-3.9 only with a reason, below 3.5 do not apply. */
export function recommendationFor(score: number, dealbreakers: number): Recommendation {
  if (dealbreakers > 0) return 'skip';
  if (score >= 4) return 'apply';
  if (score >= 3.5) return 'consider';
  return 'skip';
}

const clampScore = (value: number): number => Math.min(5, Math.max(1, Math.round(value * 10) / 10));

const IMPORTANCE_RANK: Record<RequirementImportance, number> = Object.fromEntries(
  REQUIREMENT_IMPORTANCES.map((value, index) => [value, index]),
) as Record<RequirementImportance, number>;

const MET_RANK: Record<MatchLevel, number> = { missing: 0, partial: 1, na: 2, strong: 3 };

export function finalizeAnalysis(input: FinalizeInput): AnalysisResult {
  const { extraction, draft } = input;
  const job = fold(input.jobText);
  const base = fold(input.baseText);
  const warnings = [...(input.warnings ?? [])];
  const known = new Map(extraction.requirements.map((req) => [req.id, req]));

  // Matches: one per requirement; a strong match needs evidence found in the base.
  const byId = new Map<string, AnalysisResult['matches'][number]>();
  let unverified = 0;
  for (const item of draft.matches) {
    if (!known.has(item.requirementId) || byId.has(item.requirementId)) continue;
    const evidence = item.evidence === null ? null : tidy(item.evidence, ANALYSIS_LIMITS.quote);
    const verified = evidence !== null && containsQuote(base, evidence);
    let match = item.match;
    if (match === 'strong' && !verified) {
      match = 'partial';
      unverified += 1;
    }
    byId.set(item.requirementId, {
      requirementId: item.requirementId,
      match,
      evidence,
      evidenceVerified: verified,
      gap: item.gap === null ? null : tidy(item.gap, ANALYSIS_LIMITS.text),
    });
  }
  for (const req of extraction.requirements) {
    if (!byId.has(req.id)) {
      byId.set(req.id, {
        requirementId: req.id,
        match: 'missing',
        evidence: null,
        evidenceVerified: false,
        gap: 'A IA não avaliou este requisito.',
      });
    }
  }
  if (unverified > 0) {
    warnings.push(
      `${String(unverified)} evidência(s) citada(s) pela IA não foram encontradas na sua base; o match caiu para parcial.`,
    );
  }
  const matches = extraction.requirements.map((req) => byId.get(req.id)!);

  // Dealbreakers: only with a quote that really is in the posting.
  const dealbreakers = draft.dealbreakers.filter((item) => containsQuote(job, item.jdQuote));
  if (dealbreakers.length < draft.dealbreakers.length) {
    warnings.push(
      'Uma regra eliminatória apontada pela IA não tinha citação literal da vaga e foi ignorada.',
    );
  }

  const gaps = draft.gaps
    .filter((gap) => known.has(gap.requirementId))
    .slice(0, ANALYSIS_LIMITS.gaps);
  const uncovered = extraction.requirements.filter((req) => {
    const level = byId.get(req.id)?.match;
    return (
      (req.importance === 'critical' || req.importance === 'high') &&
      (level === 'missing' || level === 'partial') &&
      !gaps.some((gap) => gap.requirementId === req.id)
    );
  });
  if (uncovered.length > 0) {
    warnings.push(
      `${String(uncovered.length)} lacuna(s) importante(s) ficaram sem plano de mitigação.`,
    );
  }

  // Display order: importance desc, unmet before met, then the posting order.
  const order = [...extraction.requirements]
    .map((req, index) => ({ req, index }))
    .sort(
      (a, b) =>
        IMPORTANCE_RANK[a.req.importance] - IMPORTANCE_RANK[b.req.importance] ||
        MET_RANK[byId.get(a.req.id)!.match] - MET_RANK[byId.get(b.req.id)!.match] ||
        a.index - b.index,
    )
    .map(({ req }) => req.id);

  const score = clampScore(draft.score);
  const recommendation = recommendationFor(score, dealbreakers.length);

  return {
    schemaVersion: 2,
    extraction,
    archetype: draft.archetype,
    dealbreakers,
    matches,
    gaps,
    scores: {
      cvMatch: clampScore(draft.scores.cvMatch),
      northStar: clampScore(draft.scores.northStar),
      comp: draft.scores.comp === null ? null : clampScore(draft.scores.comp),
      conditions: clampScore(draft.scores.conditions),
      redFlags: clampScore(draft.scores.redFlags),
    },
    score,
    verdict: {
      recommendation,
      headline: tidy(draft.verdict.headline, ANALYSIS_LIMITS.text),
      reasons: draft.verdict.reasons
        .map((reason) => tidy(reason, ANALYSIS_LIMITS.text))
        .slice(0, 6),
    },
    salary: draft.salary,
    customization: draft.customization
      .map((item) => tidy(item, ANALYSIS_LIMITS.text))
      .slice(0, ANALYSIS_LIMITS.list),
    order,
    ai: input.ai,
    warnings: warnings.map((w) => tidy(w, ANALYSIS_LIMITS.text)).slice(0, ANALYSIS_LIMITS.warnings),
  };
}
