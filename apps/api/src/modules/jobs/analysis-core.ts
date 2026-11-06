import { ANALYSIS_PROMPT_VERSION, analyzeJobWithAi, type AiRunInfo } from '@chameleon/ai';
import {
  EMPTY_REVIEW,
  analysisResultSchema,
  type AnalysisResult,
  type ProfileDocument,
} from '@chameleon/contracts';
import { MATCHER_VERSION, analyzeJob } from '@chameleon/domain';
import type { Request } from 'express';
import type { AiService } from '../../ai/service';
import type { AuthContext } from '../../auth/context';

export interface AnalysisJob {
  id: string;
  status: string;
  description: string;
  descriptionHash: string;
}

export interface AnalysisRowCore {
  id: string;
  jobId: string;
  descriptionHash: string;
  profileHash: string;
  result: unknown;
  review: unknown;
  reviewedAt: Date | null;
  createdAt: Date;
}

const LOCAL_FALLBACK_WARNING =
  'A IA não respondeu agora; esta é a análise local, mais simples. Use "Refazer análise" para tentar a IA de novo.';

/**
 * Cache key = (job, text hash, profile hash, engine version). The engine version is the AI prompt version for an
 * AI analysis and the matcher version for the local one, so the two never overwrite each other and a provider
 * change does not invalidate a stored analysis. Same key -> the stored analysis is returned untouched (`reused`).
 *
 * With AI available (configured + consented) a missing AI analysis is requested; when no provider answers (limits,
 * outages, bad keys) the local, deterministic analysis is used instead and the user sees no error. `force`
 * recomputes in place (the review is kept). Shared by the analysis routes and by resume generation, which always
 * works from an analysis of the current inputs.
 */
export async function analyzeOrReuse(
  auth: AuthContext,
  req: Request,
  job: AnalysisJob,
  document: ProfileDocument,
  profileHash: string,
  force: boolean,
  ai: AiService,
): Promise<{ row: AnalysisRowCore; reused: boolean; created: boolean; result: AnalysisResult }> {
  const base = { jobId: job.id, descriptionHash: job.descriptionHash, profileHash };
  const aiKey = { ...base, engineVersion: ANALYSIS_PROMPT_VERSION };
  const localKey = { ...base, engineVersion: MATCHER_VERSION };

  const reuse = (row: AnalysisRowCore) => ({
    row,
    reused: true,
    created: false,
    result: analysisResultSchema.parse(row.result),
  });

  const existingAi = await auth.db.jobAnalysis.findFirst({ where: aiKey });
  if (existingAi && !force) return reuse(existingAi);
  const { router, reason } = await ai.access(auth);
  const existingLocal = await auth.db.jobAnalysis.findFirst({ where: localKey });
  if (!router && existingLocal && !force) return reuse(existingLocal);

  let result: AnalysisResult | undefined;
  let aiRun: AiRunInfo | undefined;
  let aiFailed = false;
  if (router) {
    try {
      const out = await analyzeJobWithAi(router, { jobText: job.description, document });
      result = analysisResultSchema.parse(out.result);
      aiRun = out.run;
    } catch {
      aiFailed = true; // any failure of the AI path keeps the local analysis (never an error for the user)
    }
  }
  if (result === undefined && aiFailed && existingLocal && !force) return reuse(existingLocal);

  const usedAi = result !== undefined;
  if (result === undefined) {
    const local = analyzeJob(job.description, document);
    if (aiFailed) local.warnings = [...local.warnings, LOCAL_FALLBACK_WARNING].slice(0, 10);
    result = analysisResultSchema.parse(local);
  }
  const key = usedAi ? aiKey : localKey;
  const existing = usedAi ? existingAi : existingLocal;

  const row = existing
    ? await auth.db.jobAnalysis.update({ where: { id: existing.id }, data: { result } })
    : await auth.db.jobAnalysis.create({
        data: {
          ownerId: auth.ownerId,
          ...key,
          engine: result.engine,
          result,
          review: EMPTY_REVIEW,
        },
      });
  if (job.status === 'saved') {
    await auth.db.jobPosting.update({ where: { id: job.id }, data: { status: 'analyzed' } });
  }
  await auth.db.auditEvent.create({
    data: {
      ownerId: auth.ownerId,
      action: 'job.analyze',
      entityType: 'JobAnalysis',
      entityId: row.id,
      correlationId: req.correlationId,
      metadata: {
        engineVersion: key.engineVersion,
        requirements: result.summary.requirements,
        forced: force,
        ai: usedAi
          ? {
              provider: aiRun?.provider,
              model: aiRun?.model,
              tokens: aiRun?.usage.totalTokens,
              attempts: aiRun?.attempts.map((attempt) => `${attempt.provider}:${attempt.outcome}`),
            }
          : { used: false, reason: aiFailed ? 'unavailable' : reason },
      },
    },
  });
  return { row, reused: false, created: existing === null, result };
}
