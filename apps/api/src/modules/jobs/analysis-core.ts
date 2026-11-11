import { AiUnavailableError, EVALUATION_ENGINE_VERSION, evaluateJob } from '@chameleon/ai';
import {
  analysisResultSchema,
  type AnalysisResult,
  type JobExtraction,
} from '@chameleon/contracts';
import { resumeLanguage } from '@chameleon/domain';
import type { Request } from 'express';
import type { AiAccessReason, AiService } from '../../ai/service';
import type { AuthContext } from '../../auth/context';
import { HttpError } from '../../http/errors';

export interface AnalysisJob {
  id: string;
  status: string;
  description: string;
  descriptionHash: string;
}

export interface AnalysisBase {
  cvMarkdown: string;
  profileMarkdown: string;
  contentHash: string;
}

export interface AnalysisRowCore {
  id: string;
  jobId: string;
  descriptionHash: string;
  profileHash: string;
  result: unknown;
  createdAt: Date;
}

const NO_AI_MESSAGES: Record<Exclude<AiAccessReason, 'ok'>, string> = {
  off: 'A IA esta desligada nesta instalacao (AI_PROVIDER=deterministic): a avaliacao precisa dela.',
  unconfigured:
    'Nenhum provedor de IA esta configurado: adicione uma chave (GEMINI_API_KEY, GROQ_API_KEY...) no .env.',
  no_consent: 'Ative o uso de IA na sua conta para avaliar vagas e gerar curriculos.',
};

/** Throws the 409 that explains why there is no AI for this owner. */
export function noAiError(reason: AiAccessReason): HttpError {
  return new HttpError(
    409,
    'AI_REQUIRED',
    reason === 'ok' ? 'IA indisponivel.' : NO_AI_MESSAGES[reason],
  );
}

export const unavailableError = (): HttpError =>
  new HttpError(
    503,
    'AI_UNAVAILABLE',
    'Nenhum provedor de IA respondeu agora (limite diario ou instabilidade). Tente de novo em alguns minutos.',
  );

export const profileRequiredError = (): HttpError =>
  new HttpError(
    409,
    'PROFILE_REQUIRED',
    'Preencha a sua base profissional (CV e perfil) antes de avaliar uma vaga ou gerar um curriculo.',
  );

/** A stored result in the current format, or null (old formats are simply not reused). */
export function parseStoredResult(value: unknown): AnalysisResult | null {
  const parsed = analysisResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Cache key = (job, text hash, base hash, engine version). Same key and no `force` -> the stored evaluation is
 * returned untouched (`reused`), with no AI call. When only the base changed, the posting is not read again: the
 * extraction of an earlier evaluation of the same text is reused (career-ops pass 1 depends on the posting alone).
 * Shared by the evaluation routes and by resume generation.
 */
export async function evaluateOrReuse(
  auth: AuthContext,
  req: Request,
  job: AnalysisJob,
  base: AnalysisBase,
  force: boolean,
  ai: AiService,
): Promise<{ row: AnalysisRowCore; reused: boolean; created: boolean; result: AnalysisResult }> {
  const key = {
    jobId: job.id,
    descriptionHash: job.descriptionHash,
    profileHash: base.contentHash,
    engineVersion: EVALUATION_ENGINE_VERSION,
  };
  const existing = await auth.db.jobAnalysis.findFirst({ where: key });
  const existingResult = existing ? parseStoredResult(existing.result) : null;
  if (existing && existingResult && !force) {
    return { row: existing, reused: true, created: false, result: existingResult };
  }

  const { router, reason } = await ai.access(auth);
  if (!router) throw noAiError(reason);

  let previousExtraction: JobExtraction | null = null;
  if (!force) {
    const sameText = await auth.db.jobAnalysis.findMany({
      where: { jobId: job.id, descriptionHash: job.descriptionHash },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 3,
      select: { result: true },
    });
    for (const row of sameText) {
      const parsed = parseStoredResult(row.result);
      if (parsed) {
        previousExtraction = parsed.extraction;
        break;
      }
    }
  }

  let outcome: Awaited<ReturnType<typeof evaluateJob>>;
  try {
    outcome = await evaluateJob(router, {
      jobText: job.description,
      cvMarkdown: base.cvMarkdown,
      profileMarkdown: base.profileMarkdown,
      language: resumeLanguage(base.profileMarkdown),
      previousExtraction,
    });
  } catch (error) {
    if (error instanceof AiUnavailableError) throw unavailableError();
    throw error;
  }
  const result = analysisResultSchema.parse(outcome.result);

  const row = existing
    ? await auth.db.jobAnalysis.update({ where: { id: existing.id }, data: { result } })
    : await auth.db.jobAnalysis.create({
        data: { ownerId: auth.ownerId, ...key, engine: 'ai', result },
      });
  if (job.status === 'saved') {
    await auth.db.jobPosting.update({ where: { id: job.id }, data: { status: 'analyzed' } });
  }
  await auth.db.auditEvent.create({
    data: {
      ownerId: auth.ownerId,
      action: 'job.evaluate',
      entityType: 'JobAnalysis',
      entityId: row.id,
      correlationId: req.correlationId,
      metadata: {
        engineVersion: key.engineVersion,
        forced: force,
        score: result.score,
        recommendation: result.verdict.recommendation,
        requirements: result.extraction.requirements.length,
        extractionReused: previousExtraction !== null,
        providers: outcome.runs.map((run) => `${run.provider}:${run.model}`).join(','),
        tokens: outcome.runs.reduce((sum, run) => sum + run.usage.totalTokens, 0),
      },
    },
  });
  return { row, reused: false, created: existing === null, result };
}
